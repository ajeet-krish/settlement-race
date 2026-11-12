/**
 * Race source: the bridge between the React race view and the settlement
 * stack behind it. One state machine (loading, missing-accounts, error,
 * ready) serves two modes selected by options.mode.
 *
 * Live (the default) loads and validates app/public/demo-accounts.json (via
 * fetchDemoAccounts, or a caller supplied loader so node scripts can read
 * the same file from disk), builds one devnet Connection, and returns a
 * ready source with:
 *
 * - accounts: the validated demo accounts. Memory only: the source never
 *   writes them to localStorage or sessionStorage and never logs them.
 * - createClient(): a fresh AnchorClient built exactly the way runs build
 *   theirs, for callers that need the client itself.
 * - runScenario(spec, onEvent): one full ScenarioEngine run with
 *   anchor_head enabled and a fresh scenario id base per call, the
 *   caller's onEvent fed in stream order, then verifyAgainstChainHead
 *   reported as chain_ok (true or false), or null when verification
 *   could not run.
 *
 * Offline ({ mode: "offline" }) skips the accounts file, the Connection,
 * and the on chain probe, so no network can fail. The ready source carries
 * three keypairs and two mints generated in memory for the session (see
 * offlineDemoAccounts) and runs the same ScenarioEngine with anchor_head
 * enabled against a fresh MockProgramClient per call, then verifies the
 * provenance chain against that mock's anchored ChainHead through
 * mockClient.fetchChainHead: chain_ok keeps its contract with mock state
 * behind it. Scenario ids stay on the fixed default base 1n, because mock
 * state lives per client instance, so runs cannot collide and no Date.now
 * based id is needed.
 *
 * scenario_id_base formula (live): `(Date.now() mod 1_000_000) * 2 + 1`, forced
 * strictly above the previous run's base in this session by a step of 2.
 * The sequential lane uses base and the atomic lane base + 1, so a pair
 * never overlaps itself, odd bases stay clear of the engine defaults 1
 * and 2, and two runs in one session can never collide. Before each run
 * the base is probed on chain: while either lane PDA already exists the
 * base steps forward, so a page reload inside the same 16.7 minute
 * window cannot reuse an earlier session's accounts either.
 *
 * Failure mapping: DemoAccountsError surfaces its typed message (the
 * missing file case already carries the setup command), rate limit shaped
 * failures (429, 410, "too many requests") become retry aware guidance,
 * and runScenario never rejects: every failure arrives as
 * { chain_ok: null, error }, so the UI always has a state to render.
 * Offline has no loader and no RPC, so only an engine or verification
 * throw can reach that mapping, with the same contract.
 *
 * Pacing: stepDelayMs (default 0) yields between engine steps for
 * callers that need to stay under a strict RPC rate limit. The default
 * relies on the client's polling confirmation spacing alone.
 */

import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { verifyAgainstChainHead } from "../engine/anchorFlow";
import type { ChainHeadVerification } from "../engine/anchorFlow";
import { ScenarioEngine } from "../engine/scenarioEngine";
import type { RaceEvent } from "../engine/scenarioEngine";
import type { ScenarioSpec } from "../engine/scenarios";
import { AnchorClient, keypairWallet } from "./anchorClient";
import {
    DemoAccountsError,
    base58Encode,
    demoKeypair,
    fetchDemoAccounts,
} from "./demoAccounts";
import type { DemoAccountEntry, DemoAccounts } from "./demoAccounts";
import { MockProgramClient } from "./mockClient";
import { PROGRAM_ID, scenarioPda } from "./pda";
import type { ProgramClient } from "./programClient";
import type { ProvenanceChain } from "./provenance";

/** Phase of a run, used only to phrase a failure message. */
type RunPhase = "setup" | "run" | "verify";

/**
 * Which settlement backend a race source drives. Live sends real devnet
 * transactions; offline runs the same engine against an in-memory mock.
 */
export type RaceMode = "live" | "offline";

/** Result of one runScenario call; never rejects for an ordinary failure. */
export interface RaceRunOutcome {
    /**
     * True when the anchored head verified, false when verification ran
     * and did not match, null when no verification happened (the run
     * itself failed, or the anchor read threw).
     */
    chain_ok: boolean | null;
    /** Friendly failure text for the UI, absent on success. */
    error?: string;
}

/** Construction inputs handed to the program client factory. */
export interface RaceClientContext {
    accounts: DemoAccounts;
    connection: Connection;
    driver: Keypair;
    partyA: Keypair;
    partyB: Keypair;
}

/** Construction inputs handed to the chain head verification. */
export interface RaceChainVerifyContext {
    connection: Connection;
    scenario: PublicKey;
    chain: ProvenanceChain;
}

/** Construction inputs handed to the offline chain head verification. */
export interface RaceOfflineVerifyContext {
    /** The mock the run wrote its anchor into; reads back through it. */
    client: MockProgramClient;
    /** Sequential lane scenario PDA the engine anchors on. */
    scenario: PublicKey;
    /** Local provenance chain the run just produced. */
    chain: ProvenanceChain;
}

/** Copy that names the current mode and states what it does. */
export interface RaceModeCopy {
    /** Header badge label for the mode. */
    badge: string;
    /** Loading line while the source restarts under this mode. */
    loading: string;
    /**
     * Tradeoff note shown under the mode switch; null when the mode
     * needs no caveat (live names its evidence in the chain pill).
     */
    note: string | null;
}

/** Test seams and endpoint parameters for createRaceSource. */
export interface RaceSourceOptions {
    /**
     * Which backend to drive: "live" (the default) loads demo accounts
     * and drives devnet; "offline" skips the accounts file, the
     * Connection, and every RPC probe. The live seams below are ignored
     * offline, the offline seams ignored live.
     */
    mode?: RaceMode;
    /** Base URL for the demo accounts fetch; "" reads the app origin. */
    baseUrl?: string;
    /** Devnet RPC endpoint; ignored when connection is supplied. */
    rpcUrl?: string;
    /** Pre-built connection, so scripts share one transport with checks. */
    connection?: Connection;
    /** Test seam: demo accounts loader. Defaults to fetchDemoAccounts. */
    loadAccounts?: (baseUrl?: string) => Promise<DemoAccounts>;
    /** Test seam: program client factory. Defaults to AnchorClient. */
    buildClient?: (ctx: RaceClientContext) => ProgramClient;
    /** Test seam: anchor verification. Defaults to verifyAgainstChainHead. */
    verifyChain?: (ctx: RaceChainVerifyContext) => Promise<ChainHeadVerification>;
    /**
     * Test seam: offline program client factory. Defaults to a fresh
     * MockProgramClient on every call, so runs never share state.
     */
    buildOfflineClient?: () => MockProgramClient;
    /**
     * Test seam: offline chain head verification. Defaults to comparing
     * the local chain with the anchor the mock stored for the scenario.
     */
    verifyOfflineChain?: (
        ctx: RaceOfflineVerifyContext,
    ) => Promise<ChainHeadVerification>;
    /** Wall milliseconds yielded between engine steps; default 0. */
    stepDelayMs?: number;
}

/** The source is loading its demo accounts; Run stays disabled. */
export interface RaceSourceLoading {
    status: "loading";
}

/** Demo accounts file is absent; guidance carries the setup command. */
export interface RaceSourceMissing {
    status: "missing-accounts";
    guidance: string;
}

/** Accounts loaded but unusable, or the source could not start. */
export interface RaceSourceFailed {
    status: "error";
    message: string;
}

/** Everything needed to run scenarios against devnet. */
export interface RaceSourceReady {
    status: "ready";
    /** Validated accounts, held in memory only. Never persisted. */
    accounts: DemoAccounts;
    /** Fresh AnchorClient, built the way runScenario builds its own. */
    createClient(): ProgramClient;
    /** Run one scenario end to end, feeding onEvent in stream order. */
    runScenario(
        spec: ScenarioSpec,
        onEvent?: (event: RaceEvent) => void,
    ): Promise<RaceRunOutcome>;
}

/** State the race tab renders: loading, guidance, ready, or error. */
export type RaceSourceState =
    | RaceSourceLoading
    | RaceSourceMissing
    | RaceSourceFailed
    | RaceSourceReady;

/** Last scenario id base handed out in this session (module scoped). */
let lastScenarioIdBase = 0n;

/** Lane PDA probe attempts before giving up and using the base anyway. */
const BASE_PROBE_ATTEMPTS = 50;

/** Default wall yield between engine steps; 0 means no added pacing. */
const DEFAULT_STEP_DELAY_MS = 0;

/**
 * Scenario id base for every offline run: the engine default 1n. Mock
 * state lives per client instance and each run builds a fresh one, so the
 * fixed base can never collide and no Date.now based id is needed.
 */
const OFFLINE_SCENARIO_ID_BASE = 1n;

/** Typed failures the loader throws; every other throw is generic. */
const RATE_LIMIT_RE = /\b429\b|\b410\b|too many requests|rate limit/i;

/** Token program shortfall: demo balances only cover one lane. */
const TOKEN_SHORTFALL_RE = /insufficient funds|insufficientfunds/i;

/** System program shortfall: a signer wallet ran out of SOL. */
const SOL_SHORTFALL_RE = /insufficient lamports|insufficient funds for/i;

/**
 * Fresh scenario id base for one run: `(now mod 1_000_000) * 2 + 1`,
 * then forced strictly above the previous base in this session (step 2).
 * Odd, session unique, and clear of the engine defaults 1 and 2.
 */
export function nextScenarioIdBase(nowMs: number = Date.now()): bigint {
    let base = (BigInt(Math.trunc(nowMs)) % 1_000_000n) * 2n + 1n;
    if (base <= lastScenarioIdBase) {
        base = lastScenarioIdBase + 2n;
    }
    lastScenarioIdBase = base;
    return base;
}

/**
 * Walk the candidate base upward while either lane PDA is already
 * occupied on chain, so a run never lands on an account from an earlier
 * session. Probe failures fall back to the computed base: a flaky RPC
 * read must not block a run the engine can still attempt.
 */
async function reserveScenarioIdBase(
    connection: Connection,
    driver: PublicKey,
    start: bigint,
): Promise<bigint> {
    let base = start;
    for (let attempt = 0; attempt < BASE_PROBE_ATTEMPTS; attempt++) {
        let sequentialOccupied: boolean;
        let atomicOccupied: boolean;
        try {
            const [sequential] = scenarioPda(driver, base);
            const [atomic] = scenarioPda(driver, base + 1n);
            const [sequentialInfo, atomicInfo] = await Promise.all([
                connection.getAccountInfo(sequential, "confirmed"),
                connection.getAccountInfo(atomic, "confirmed"),
            ]);
            sequentialOccupied = sequentialInfo !== null;
            atomicOccupied = atomicInfo !== null;
        } catch {
            return base;
        }
        if (!sequentialOccupied && !atomicOccupied) {
            return base;
        }
        base += 2n;
    }
    return base;
}

/** Default client factory: the Anchor devnet client the UI ships with. */
function defaultBuildClient(ctx: RaceClientContext): ProgramClient {
    return new AnchorClient({
        connection: ctx.connection,
        programId: PROGRAM_ID,
        usdMint: new PublicKey(ctx.accounts.usd_mint),
        cadMint: new PublicKey(ctx.accounts.cad_mint),
        driver: ctx.driver,
        partyB: ctx.partyB,
        wallet: keypairWallet(ctx.partyA),
    });
}

/** Default verification: compare the local chain with the ChainHead PDA. */
async function defaultVerifyChain(
    ctx: RaceChainVerifyContext,
): Promise<ChainHeadVerification> {
    return verifyAgainstChainHead(
        ctx.connection,
        ctx.scenario,
        ctx.chain,
        PROGRAM_ID,
    );
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Single source of truth for mode copy: the header badge, the loading
 * line while a source restarts, and the tradeoff note. The offline note
 * must keep saying that runs use the same engine and provenance logic
 * against an in-memory ledger with no transactions and no on-chain
 * evidence, so nobody reads a mock verdict as devnet proof. Pure: no
 * state, no clock, no network, so tests can pin the wording directly.
 */
export function raceModeCopy(mode: RaceMode): RaceModeCopy {
    if (mode === "offline") {
        return {
            badge: "Offline demo",
            loading: "Starting offline demo...",
            note:
                "Offline demo runs the same engine and provenance logic against " +
                "an in-memory ledger: no transactions, no on-chain evidence. " +
                "Chain results reflect mock state.",
        };
    }
    return {
        badge: "Devnet live",
        loading: "Loading demo accounts...",
        note: null,
    };
}

/**
 * Phrase a run failure for the UI: rate limits become retry guidance,
 * the anchor read names its phase, token and SOL shortfalls point at the
 * command that tops them up, and everything else keeps its typed code.
 */
function describeFailure(err: unknown, phase: RunPhase): string {
    const message = err instanceof Error ? err.message : String(err);
    if (RATE_LIMIT_RE.test(message)) {
        return (
            "Devnet RPC rate limited this run (429 or 410). " +
            "Wait a few seconds and run again."
        );
    }
    if (phase === "verify") {
        return `Chain verification could not read the anchor: ${message}`;
    }
    if (SOL_SHORTFALL_RE.test(message)) {
        return (
            `${message} A signer wallet is low on SOL; ` +
            "run npx tsx scripts/setup-devnet.ts to top up, then run again."
        );
    }
    if (TOKEN_SHORTFALL_RE.test(message)) {
        return (
            `${message} Demo token balances cover one lane only; ` +
            "run npx tsx scripts/smoke-race-ui.ts --topup to mint the " +
            "shortfall, then run again."
        );
    }
    return `Run failed: ${message}`;
}

/**
 * Build a race source for the requested mode. Live loads accounts and
 * builds the devnet stack; offline resolves straight to a mock backed
 * ready state. Both resolve to a state object for every outcome,
 * including a missing or invalid accounts file (live only).
 */
export async function createRaceSource(
    options: RaceSourceOptions = {},
): Promise<RaceSourceState> {
    if ((options.mode ?? "live") === "offline") {
        return createOfflineRaceSource(options);
    }
    return createLiveRaceSource(options);
}

/**
 * Build the live race source: load accounts, then expose the client
 * factory and the run entry point.
 */
async function createLiveRaceSource(
    options: RaceSourceOptions = {},
): Promise<RaceSourceState> {
    let accounts: DemoAccounts;
    try {
        const load = options.loadAccounts ?? fetchDemoAccounts;
        accounts = await load(options.baseUrl);
    } catch (err) {
        if (err instanceof DemoAccountsError) {
            if (err.code === "missing") {
                return { status: "missing-accounts", guidance: err.message };
            }
            return { status: "error", message: err.message };
        }
        return { status: "error", message: "Demo accounts could not be loaded." };
    }

    let connection: Connection;
    try {
        connection =
            options.connection ??
            new Connection(
                options.rpcUrl ?? clusterApiUrl("devnet"),
                "confirmed",
            );
    } catch {
        return {
            status: "error",
            message: "The devnet RPC endpoint could not be created.",
        };
    }

    const buildClient = options.buildClient ?? defaultBuildClient;
    const verifyChain = options.verifyChain ?? defaultVerifyChain;
    const stepDelayMs = options.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;

    function makeKeys(): { driver: Keypair; partyA: Keypair; partyB: Keypair } {
        return {
            driver: demoKeypair(accounts.driver),
            partyA: demoKeypair(accounts.partyA),
            partyB: demoKeypair(accounts.partyB),
        };
    }

    function createClient(): ProgramClient {
        const keys = makeKeys();
        return buildClient({ accounts, connection, ...keys });
    }

    async function runScenario(
        spec: ScenarioSpec,
        onEvent?: (event: RaceEvent) => void,
    ): Promise<RaceRunOutcome> {
        let phase: RunPhase = "setup";
        try {
            const keys = makeKeys();
            const client = buildClient({ accounts, connection, ...keys });
            const base = await reserveScenarioIdBase(
                connection,
                keys.driver.publicKey,
                nextScenarioIdBase(),
            );
            const engine = new ScenarioEngine({
                client,
                driver: keys.driver,
                partyA: keys.partyA.publicKey,
                partyB: keys.partyB.publicKey,
                wallet: keypairWallet(keys.partyA),
                anchor_head: true,
                scenario_id_base: base,
                onEvent,
            });

            phase = "run";
            const stream = engine.run(spec);
            for (;;) {
                const next = await stream.next();
                if (next.done === true) {
                    break;
                }
                if (stepDelayMs > 0) {
                    await delay(stepDelayMs);
                }
            }

            phase = "verify";
            const scenario = scenarioPda(keys.driver.publicKey, base)[0];
            const verification = await verifyChain({
                connection,
                scenario,
                chain: engine.chain,
            });
            return { chain_ok: verification.valid };
        } catch (err) {
            return { chain_ok: null, error: describeFailure(err, phase) };
        }
    }

    return {
        status: "ready",
        accounts,
        createClient,
        runScenario,
    };
}

/**
 * In-memory account set for an offline source: three fresh keypairs and
 * two fresh mint addresses, generated once per source and never
 * persisted. Shape only: offline runs decode the keypairs for signing
 * roles and never touch the mints, the cluster field, or the network.
 * The note records the origin so anything displaying it can say these
 * are not the devnet demo accounts from demo-accounts.json.
 */
function offlineDemoAccounts(): DemoAccounts {
    const entry = (keypair: Keypair): DemoAccountEntry => ({
        secret: base58Encode(keypair.secretKey),
        pubkey: keypair.publicKey.toBase58(),
    });
    return {
        version: 1,
        cluster: "devnet",
        program_id: PROGRAM_ID.toBase58(),
        partyA: entry(Keypair.generate()),
        partyB: entry(Keypair.generate()),
        driver: entry(Keypair.generate()),
        usd_mint: Keypair.generate().publicKey.toBase58(),
        cad_mint: Keypair.generate().publicKey.toBase58(),
        note:
            "Offline demo accounts generated in memory for this session; " +
            "not loaded from demo-accounts.json and never sent anywhere.",
    };
}

/** Lowercase hex of a byte array (a 32 byte hash becomes 64 characters). */
function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

/**
 * Default offline verification: compare the local chain with the ChainHead
 * the mock stored for this scenario. The three checks mirror
 * verifyAgainstChainHead exactly (chain rehashes, head matches, count
 * matches), so an offline chain_ok means the same thing with mock state
 * behind it. A missing anchor reads as invalid rather than as a transport
 * failure: the mock has no transport to fail.
 */
async function defaultVerifyOfflineChain(
    ctx: RaceOfflineVerifyContext,
): Promise<ChainHeadVerification> {
    const local_head = ctx.chain.head;
    const anchored = await ctx.client.fetchChainHead(ctx.scenario);
    if (!anchored.ok) {
        return {
            valid: false,
            on_chain_head: null,
            local_head,
            event_count_match: false,
        };
    }
    const on_chain_head = bytesToHex(anchored.value.final_hash);
    const event_count_match =
        anchored.value.event_count === BigInt(ctx.chain.length);
    const head_match = on_chain_head === local_head;
    const valid = ctx.chain.verify() && head_match && event_count_match;
    return { valid, on_chain_head, local_head, event_count_match };
}

/**
 * Build the offline race source: no accounts file, no Connection, no RPC
 * probe, so nothing here can fail for network reasons. The ready state
 * carries the in-memory accounts (shape only) and a run entry point that
 * drives the same ScenarioEngine with anchor_head enabled against a fresh
 * MockProgramClient, then verifies the chain against that mock's anchored
 * head. runScenario never rejects: an engine or verification throw
 * arrives as { chain_ok: null, error }, the live contract verbatim.
 */
async function createOfflineRaceSource(
    options: RaceSourceOptions,
): Promise<RaceSourceState> {
    const accounts = offlineDemoAccounts();
    const buildOfflineClient =
        options.buildOfflineClient ?? (() => new MockProgramClient());
    const verifyOffline =
        options.verifyOfflineChain ?? defaultVerifyOfflineChain;
    const stepDelayMs = options.stepDelayMs ?? DEFAULT_STEP_DELAY_MS;

    function makeKeys(): { driver: Keypair; partyA: Keypair; partyB: Keypair } {
        return {
            driver: demoKeypair(accounts.driver),
            partyA: demoKeypair(accounts.partyA),
            partyB: demoKeypair(accounts.partyB),
        };
    }

    function createClient(): ProgramClient {
        return buildOfflineClient();
    }

    async function runScenario(
        spec: ScenarioSpec,
        onEvent?: (event: RaceEvent) => void,
    ): Promise<RaceRunOutcome> {
        let phase: RunPhase = "setup";
        try {
            const keys = makeKeys();
            const client = buildOfflineClient();
            const engine = new ScenarioEngine({
                client,
                driver: keys.driver,
                partyA: keys.partyA.publicKey,
                partyB: keys.partyB.publicKey,
                wallet: keypairWallet(keys.partyA),
                anchor_head: true,
                scenario_id_base: OFFLINE_SCENARIO_ID_BASE,
                onEvent,
            });

            phase = "run";
            const stream = engine.run(spec);
            for (;;) {
                const next = await stream.next();
                if (next.done === true) {
                    break;
                }
                if (stepDelayMs > 0) {
                    await delay(stepDelayMs);
                }
            }

            phase = "verify";
            const scenario = scenarioPda(
                keys.driver.publicKey,
                OFFLINE_SCENARIO_ID_BASE,
            )[0];
            const verification = await verifyOffline({
                client,
                scenario,
                chain: engine.chain,
            });
            return { chain_ok: verification.valid };
        } catch (err) {
            return { chain_ok: null, error: describeFailure(err, phase) };
        }
    }

    return {
        status: "ready",
        accounts,
        createClient,
        runScenario,
    };
}
