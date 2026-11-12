/**
 * Live race source: the bridge between the React race view and the real
 * devnet stack (demo accounts, Anchor client, scenario engine).
 *
 * createRaceSource loads and validates app/public/demo-accounts.json (via
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
 * scenario_id_base formula: `(Date.now() mod 1_000_000) * 2 + 1`, forced
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
 *
 * Pacing: stepDelayMs (default 0) yields between engine steps for
 * callers that need to stay under a strict RPC rate limit. The default
 * relies on the client's polling confirmation spacing alone.
 */

import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import { verifyAgainstChainHead } from "../engine/anchorFlow";
import type { ChainHeadVerification } from "../engine/anchorFlow";
import { ScenarioEngine } from "../engine/scenarioEngine";
import type { RaceEvent } from "../engine/scenarioEngine";
import type { ScenarioSpec } from "../engine/scenarios";
import { AnchorClient, keypairWallet } from "./anchorClient";
import {
    DemoAccountsError,
    demoKeypair,
    fetchDemoAccounts,
} from "./demoAccounts";
import type { DemoAccounts } from "./demoAccounts";
import { PROGRAM_ID, scenarioPda } from "./pda";
import type { ProgramClient } from "./programClient";
import type { ProvenanceChain } from "./provenance";

/** Phase of a run, used only to phrase a failure message. */
type RunPhase = "setup" | "run" | "verify";

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

/** Test seams and endpoint parameters for createRaceSource. */
export interface RaceSourceOptions {
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
 * Build the live race source: load accounts, then expose the client
 * factory and the run entry point. Resolves to a state object for every
 * outcome, including a missing or invalid accounts file.
 */
export async function createRaceSource(
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
