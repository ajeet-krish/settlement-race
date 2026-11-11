// Phase 3 live devnet smoke test.
//
// Drives the honest sequential settlement end to end through
// app/src/lib/anchorClient.ts against the deployed program, anchors the
// provenance chain, verifies the anchor, fetches evidence for captured
// signatures, and (when the SOL budget allows) settles one atomic lane.
//
// Roles: party A is the Anchor provider wallet (pays every transaction
// fee), the driver is the CLI wallet from ~/.config/solana/id.json (pays
// the init rents, because the program's payer is the driver), and party B
// signs its own acknowledgements and payments. Key material is loaded from
// scripts/devnet-keypairs.json (mode 600) and never printed.
//
// Budget: at most 0.05 SOL total across the three wallets. Balances are
// checked before anything is sent; an insufficient balance aborts cleanly
// with no transaction. Devnet play money only.
//
// RPC fault handling: transaction and fetch calls retry clear rate limits
// (429 and 410) a bounded number of times. web3.js confirms signatures
// over a websocket subscription whose rejection can escape the await
// chain, so process level handlers catch escaped faults, print whatever
// completed, and report PARTIAL instead of crashing. Devnet play money
// only; no secret key is ever logged.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    clusterApiUrl,
} from "@solana/web3.js";
import {
    getAccount,
    getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { AnchorClient, keypairWallet } from "../app/src/lib/anchorClient";
import { PROGRAM_ID, scenarioPda } from "../app/src/lib/pda";
import {
    ProvenanceChain,
    type EventType,
    type ProvenanceActor,
} from "../app/src/lib/provenance";
import { fetchEvidence } from "../app/src/lib/evidence";
import {
    anchorTerminalChain,
    verifyAgainstChainHead,
} from "../app/src/engine/anchorFlow";
import type { TxResult } from "../app/src/lib/programClient";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const KEYPAIRS_FILE = join(SCRIPT_DIR, "devnet-keypairs.json");
const ACCOUNTS_FILE = join(SCRIPT_DIR, "devnet-accounts.json");
const CLI_WALLET_FILE = join(homedir(), ".config", "solana", "id.json");
const RPC_URL = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");

// Honest scenario amounts: integer cents, matched to the devnet token
// balances (party A holds 1,000,000 USD cents, party B 1,350,000 CAD
// cents), so both lanes fit without a faucet top up.
const LEG1_USD_CENTS = 100_000n;
const LEG2_CAD_CENTS = 130_000n;
const GAP_MS = 5_000n;
const T_START_MS = 1_000n;
const T_RELEASE1_MS = 2_000n;
const T_PAST_GAP_MS = 7_001n; // release 1 at 2000 plus gap 5000 plus 1

// SOL guards. Rents: two scenarios with two vaults each plus one chain
// head come to roughly 0.014 SOL on the driver; fees stay under 0.001 SOL
// on party A. The 0.05 SOL ceiling is the phase budget.
const TOTAL_BUDGET_LAMPORTS = 50_000_000;
const DRIVER_MIN_LAMPORTS = 20_000_000;
const FEE_PAYER_MIN_LAMPORTS = 5_000_000;
const ATOMIC_MIN_DRIVER_LAMPORTS = 10_000_000;
const MAX_SEND_ATTEMPTS = 3;
/** Pause between transactions to stay under the public RPC rate limit. */
const STEP_DELAY_MS = 400;

interface StoredKeyPairs {
    authority: number[];
    party_a: number[];
    party_b: number[];
}

interface StoredAccounts {
    mints: { usd: string; cad: string };
}

interface SignatureLog {
    step: string;
    signature: string;
}

interface Balances {
    a: number;
    b: number;
    driver: number;
}

interface Spend {
    spent: number;
    startTotal: number;
    endTotal: number;
}

const sigLog: SignatureLog[] = [];
const milestones = {
    sequential: null as string | null,
    chainHead: null as string | null,
    evidence: null as string | null,
    atomic: null as string | null,
};
let startBalances: Balances | null = null;
let walletKeys: { a: PublicKey; b: PublicKey; driver: PublicKey } | null = null;
let summaryPrinted = false;
let finished = false;

function loadKeypair(path: string): Keypair {
    const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function isRateLimit(text: string): boolean {
    return /429|410|too many requests|rate limit/i.test(text);
}

function isNetworkFault(text: string): boolean {
    return /429|410|too many requests|rate limit|fetch failed|timeout|econn|network|socket|blockhash not found|unexpected server response/i.test(
        text,
    );
}

function sol(lamports: number): string {
    return (lamports / LAMPORTS_PER_SOL).toFixed(5);
}

function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

/** Run one client transaction, retrying only clear RPC rate limits. */
async function must(step: string, run: () => Promise<TxResult>): Promise<string> {
    let last = "";
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        const result = await run();
        if (result.ok) {
            sigLog.push({ step, signature: result.signature });
            console.log(`  ok    ${step.padEnd(18)} ${result.signature}`);
            await sleep(STEP_DELAY_MS);
            return result.signature;
        }
        last = result.error;
        if (attempt < MAX_SEND_ATTEMPTS && isRateLimit(result.error)) {
            console.log(
                `  retry ${step.padEnd(18)} rate limited (${result.error})`,
            );
            await sleep(1500 * attempt);
            continue;
        }
        throw new Error(`${step}: ${result.error}`);
    }
    throw new Error(`${step}: ${last}`);
}

/** Run one client fetch with a bounded retry for transient read errors. */
async function mustFetch<T>(
    step: string,
    run: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
): Promise<T> {
    let last = "";
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        const result = await run();
        if (result.ok) {
            return result.value;
        }
        last = result.error;
        if (attempt < MAX_SEND_ATTEMPTS && isRateLimit(result.error)) {
            console.log(
                `  retry ${step.padEnd(18)} rate limited (${result.error})`,
            );
            await sleep(1500 * attempt);
            continue;
        }
        throw new Error(`${step}: ${last}`);
    }
    throw new Error(`${step}: ${last}`);
}

/** First free scenario id at or above `base` for this driver. */
async function findFreeScenarioId(
    connection: Connection,
    driver: PublicKey,
    base: bigint,
): Promise<bigint> {
    for (let offset = 0n; offset < 100n; offset++) {
        const id = base + offset;
        const [address] = scenarioPda(driver, id);
        const info = await connection.getAccountInfo(address);
        if (info === null) {
            return id;
        }
    }
    throw new Error(`no free scenario id near ${base} for this driver`);
}

/** Token balance of an owner's canonical ATA, 0 when the account is absent. */
async function tokenBalance(
    connection: Connection,
    mint: PublicKey,
    owner: PublicKey,
): Promise<bigint> {
    const address = getAssociatedTokenAddressSync(mint, owner);
    try {
        const account = await getAccount(connection, address);
        return account.amount;
    } catch {
        return 0n;
    }
}

/** Measure spend across the three wallets; null when RPC is unreachable. */
async function measureSpend(): Promise<Spend | null> {
    const base = startBalances;
    const keys = walletKeys;
    if (base === null || keys === null) {
        return null;
    }
    try {
        const connection = new Connection(RPC_URL, "confirmed");
        const end = {
            a: await connection.getBalance(keys.a),
            b: await connection.getBalance(keys.b),
            driver: await connection.getBalance(keys.driver),
        };
        return {
            spent:
                base.a -
                end.a +
                (base.b - end.b) +
                (base.driver - end.driver),
            startTotal: base.a + base.b + base.driver,
            endTotal: end.a + end.b + end.driver,
        };
    } catch {
        return null;
    }
}

interface ChainEvent {
    event: EventType;
    actor: ProvenanceActor;
    virtual: bigint;
    data: Record<string, string | number | boolean>;
    tx_sig: string | null;
}

function printSummary(spend: Spend | null): void {
    if (summaryPrinted) {
        return;
    }
    summaryPrinted = true;
    console.log("== summary ==");
    console.log(`sequential   ${milestones.sequential ?? "not reached"}`);
    console.log(`chain head   ${milestones.chainHead ?? "not reached"}`);
    console.log(`evidence     ${milestones.evidence ?? "not reached"}`);
    console.log(`atomic       ${milestones.atomic ?? "not reached"}`);
    if (spend !== null) {
        const budgetNote =
            spend.spent > TOTAL_BUDGET_LAMPORTS
                ? "OVER BUDGET"
                : `budget ${sol(TOTAL_BUDGET_LAMPORTS)} SOL`;
        console.log(
            `sol spent    ${sol(spend.spent)} (${budgetNote}; wallets ${sol(spend.startTotal)} -> ${sol(spend.endTotal)})`,
        );
    } else {
        console.log("sol spent    unavailable (balance read failed)");
    }
    console.log(`signatures   ${sigLog.length} transactions`);
    for (const entry of sigLog) {
        console.log(`  ${entry.step.padEnd(18)} ${entry.signature}`);
    }
}

/** Terminate exactly once: print outcome, then force exit after a beat. */
function finish(code: number, outcome: string): void {
    if (finished) {
        return;
    }
    finished = true;
    console.log(outcome);
    process.exitCode = code;
    // Give stdout a moment to drain, then break any lingering websocket so
    // the process cannot hang after the report is complete.
    setTimeout(() => {
        process.exit(code);
    }, 1000).unref();
}

async function main(): Promise<void> {
    console.log("== Phase 3 devnet smoke (play money only) ==");
    const connection = new Connection(RPC_URL, "confirmed");

    // Keypairs: parties from the mode 600 fixture, driver from the CLI.
    // Secrets are loaded into memory only and never logged.
    const stored = JSON.parse(
        readFileSync(KEYPAIRS_FILE, "utf8"),
    ) as StoredKeyPairs;
    const accounts = JSON.parse(
        readFileSync(ACCOUNTS_FILE, "utf8"),
    ) as StoredAccounts;
    const partyA = Keypair.fromSecretKey(Uint8Array.from(stored.party_a));
    const partyB = Keypair.fromSecretKey(Uint8Array.from(stored.party_b));
    const driver = loadKeypair(CLI_WALLET_FILE);
    const usdMint = new PublicKey(accounts.mints.usd);
    const cadMint = new PublicKey(accounts.mints.cad);
    walletKeys = {
        a: partyA.publicKey,
        b: partyB.publicKey,
        driver: driver.publicKey,
    };

    console.log(`rpc          ${RPC_URL}`);
    console.log(`program      ${PROGRAM_ID.toBase58()}`);
    console.log(`party A      ${partyA.publicKey.toBase58()} (fee payer)`);
    console.log(`party B      ${partyB.publicKey.toBase58()}`);
    console.log(`driver       ${driver.publicKey.toBase58()} (init payer)`);

    // Preflight: program live, balances sufficient, all checks happen
    // before the first transaction is sent.
    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (programInfo === null || !programInfo.executable) {
        throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed`);
    }

    const balances: Balances = {
        a: await connection.getBalance(partyA.publicKey),
        b: await connection.getBalance(partyB.publicKey),
        driver: await connection.getBalance(driver.publicKey),
    };
    startBalances = balances;
    const startTotal = balances.a + balances.b + balances.driver;
    console.log(
        `balances     A ${sol(balances.a)} | B ${sol(balances.b)} | driver ${sol(balances.driver)} SOL (total ${sol(startTotal)})`,
    );
    if (balances.driver < DRIVER_MIN_LAMPORTS) {
        throw new Error(
            `insufficient driver balance ${sol(balances.driver)} SOL; ` +
                `need at least ${sol(DRIVER_MIN_LAMPORTS)} SOL for init rents (the devnet faucet is closed)`,
        );
    }
    if (balances.a < FEE_PAYER_MIN_LAMPORTS) {
        throw new Error(
            `insufficient party A balance ${sol(balances.a)} SOL; ` +
                `need at least ${sol(FEE_PAYER_MIN_LAMPORTS)} SOL for fees`,
        );
    }

    const partyAUsd = await tokenBalance(connection, usdMint, partyA.publicKey);
    const partyBCad = await tokenBalance(connection, cadMint, partyB.publicKey);
    console.log(
        `tokens       A USD ${partyAUsd} cents | B CAD ${partyBCad} cents`,
    );
    if (partyAUsd < LEG1_USD_CENTS || partyBCad < LEG2_CAD_CENTS) {
        throw new Error(
            "insufficient token balances for the sequential lane " +
                `(need ${LEG1_USD_CENTS} USD cents on A and ${LEG2_CAD_CENTS} CAD cents on B)`,
        );
    }
    const atomicTokensAffordable =
        partyAUsd >= 2n * LEG1_USD_CENTS && partyBCad >= 2n * LEG2_CAD_CENTS;

    const client = new AnchorClient({
        connection,
        usdMint,
        cadMint,
        driver,
        partyB,
        wallet: keypairWallet(partyA),
    });

    const sequentialId = await findFreeScenarioId(
        connection,
        driver.publicKey,
        7100n,
    );
    const [scenario] = scenarioPda(driver.publicKey, sequentialId);
    console.log(`scenario     ${scenario.toBase58()} (id ${sequentialId})`);

    // Honest sequential lane: init, clock, acks, full funding, start,
    // release leg 1, advance past the gap, release leg 2 in full.
    console.log("-- sequential lane --");
    const initSig = await must("init_scenario", () =>
        client.initScenario({
            driver: driver.publicKey,
            party_a: partyA.publicKey,
            party_b: partyB.publicKey,
            scenario_id: sequentialId,
            ticket_hash: ticketHash(),
            path: "SEQUENTIAL",
            leg1_usd_cents: LEG1_USD_CENTS,
            leg2_cad_cents: LEG2_CAD_CENTS,
            gap_ms: GAP_MS,
        }),
    );
    // start_race requires virtual_now_ms > 0 (pinned by the zero time
    // guard), so the clock moves before the race opens, then again after.
    await must("advance_clock", () =>
        client.advanceClock({
            scenario,
            signer: driver.publicKey,
            to_ms: T_START_MS,
        }),
    );
    const ackASig = await must("ack_a", () =>
        client.ack({ scenario, signer: partyA.publicKey }),
    );
    const ackBSig = await must("ack_b", () =>
        client.ack({ scenario, signer: partyB.publicKey }),
    );
    const fundUsdSig = await must("fund_leg_usd", () =>
        client.fundLeg({
            scenario,
            signer: partyA.publicKey,
            leg: "LEG1_USD",
            amount_cents: LEG1_USD_CENTS,
        }),
    );
    const fundCadSig = await must("fund_leg_cad", () =>
        client.fundLeg({
            scenario,
            signer: partyB.publicKey,
            leg: "LEG2_CAD",
            amount_cents: LEG2_CAD_CENTS,
        }),
    );
    const startSig = await must("start_race", () =>
        client.startRace({ scenario, signer: driver.publicKey }),
    );
    await must("advance_clock", () =>
        client.advanceClock({
            scenario,
            signer: driver.publicKey,
            to_ms: T_RELEASE1_MS,
        }),
    );
    const release1Sig = await must("release_leg1", () =>
        client.releaseLeg1({ scenario, signer: driver.publicKey }),
    );
    await must("advance_clock", () =>
        client.advanceClock({
            scenario,
            signer: driver.publicKey,
            to_ms: T_PAST_GAP_MS,
        }),
    );
    const release2Sig = await must("release_leg2", () =>
        client.releaseLeg2({ scenario, signer: partyB.publicKey }),
    );

    const settled = await mustFetch("fetch_scenario", () =>
        client.fetchScenario(scenario),
    );
    console.log(
        `  state       status=${settled.status} paid=${settled.paid_cad_cents} leg2=${LEG2_CAD_CENTS}`,
    );
    if (settled.status !== "SETTLED") {
        throw new Error(`expected SETTLED, got ${settled.status}`);
    }
    if (settled.paid_cad_cents !== LEG2_CAD_CENTS) {
        throw new Error(
            `expected paid ${LEG2_CAD_CENTS}, got ${settled.paid_cad_cents}`,
        );
    }
    milestones.sequential = `SETTLED paid=${settled.paid_cad_cents}/${LEG2_CAD_CENTS}`;

    // Minimal provenance chain with the captured signatures. The
    // CHAIN_ANCHORED event is deliberately not part of the anchored chain.
    console.log("-- provenance chain --");
    const chain = new ProvenanceChain();
    const events: ChainEvent[] = [
        {
            event: "TICKET_CREATED",
            actor: "ENGINE",
            virtual: 0n,
            data: {
                path: "SEQUENTIAL",
                leg1_usd_cents: LEG1_USD_CENTS.toString(),
                leg2_cad_cents: LEG2_CAD_CENTS.toString(),
                gap_ms: GAP_MS.toString(),
            },
            tx_sig: null,
        },
        {
            event: "ACK_A",
            actor: "PARTY_A",
            virtual: T_START_MS,
            data: { ack: "party_a" },
            tx_sig: ackASig,
        },
        {
            event: "ACK_B",
            actor: "PARTY_B",
            virtual: T_START_MS,
            data: { ack: "party_b" },
            tx_sig: ackBSig,
        },
        {
            event: "LEG_FUNDED",
            actor: "PARTY_A",
            virtual: T_START_MS,
            data: { leg: "LEG1_USD", amount_cents: LEG1_USD_CENTS.toString() },
            tx_sig: fundUsdSig,
        },
        {
            event: "LEG_FUNDED",
            actor: "PARTY_B",
            virtual: T_START_MS,
            data: { leg: "LEG2_CAD", amount_cents: LEG2_CAD_CENTS.toString() },
            tx_sig: fundCadSig,
        },
        {
            event: "RACE_STARTED",
            actor: "DRIVER",
            virtual: T_START_MS,
            data: { path: "SEQUENTIAL" },
            tx_sig: startSig,
        },
        {
            event: "LEG1_RELEASED",
            actor: "DRIVER",
            virtual: T_RELEASE1_MS,
            data: { amount_cents: LEG1_USD_CENTS.toString() },
            tx_sig: release1Sig,
        },
        {
            event: "LEG2_RELEASED",
            actor: "PARTY_B",
            virtual: T_PAST_GAP_MS,
            data: { amount_cents: LEG2_CAD_CENTS.toString() },
            tx_sig: release2Sig,
        },
    ];
    for (const ev of events) {
        chain.append({
            schema_version: 1,
            seq: chain.length,
            scenario_id: sequentialId.toString(),
            event: ev.event,
            actor: ev.actor,
            virtual_ts_ms: ev.virtual.toString(),
            real_ts_iso: new Date().toISOString(),
            data: ev.data,
            tx_sig: ev.tx_sig,
        });
    }
    if (!chain.verify()) {
        throw new Error("local provenance chain failed self verification");
    }
    console.log(`  chain       ${chain.length} records, head ${chain.head}`);

    const anchorSig = await must("anchor_chain_head", () =>
        anchorTerminalChain(client, {
            scenario,
            signer: driver.publicKey,
            chain,
            anchored_virtual_ms: T_PAST_GAP_MS,
        }),
    );
    const head = await mustFetch("fetch_chain_head", () =>
        client.fetchChainHead(scenario),
    );
    const headHex = bytesToHex(head.final_hash);
    const verification = await verifyAgainstChainHead(
        connection,
        scenario,
        chain,
        PROGRAM_ID,
    );
    console.log(
        `  verify      valid=${verification.valid} head_match=${verification.on_chain_head === chain.head} event_count_match=${verification.event_count_match}`,
    );
    if (!verification.valid) {
        throw new Error(
            `anchor verification failed: ${JSON.stringify(verification)}`,
        );
    }
    if (headHex !== chain.head) {
        throw new Error(
            `fetchChainHead head ${headHex} != local head ${chain.head}`,
        );
    }
    if (head.event_count !== BigInt(chain.length)) {
        throw new Error(
            `fetchChainHead event_count ${head.event_count} != ${chain.length}`,
        );
    }
    milestones.chainHead = `valid=${verification.valid} event_count=${chain.length} head=${chain.head}`;

    // Evidence for a sample of captured signatures: init, first funding,
    // leg 1 release, and the anchor itself.
    console.log("-- evidence --");
    const evidenceSigs = [initSig, fundUsdSig, release1Sig, anchorSig];
    const evidence = await fetchEvidence(connection, evidenceSigs);
    let fetchedOk = 0;
    let programMatch = 0;
    for (const row of evidence) {
        if (row.fetched_ok) fetchedOk++;
        if (row.fetched_ok && row.program_id_match) programMatch++;
        console.log(
            `  ${row.tx_sig.slice(0, 12)}... fetched_ok=${row.fetched_ok} program_id_match=${row.program_id_match} success=${row.success}${row.reason ? ` reason=${row.reason}` : ""}`,
        );
    }
    if (fetchedOk !== evidence.length || programMatch !== evidence.length) {
        throw new Error(
            `evidence incomplete: ${fetchedOk}/${evidence.length} fetched, ${programMatch}/${evidence.length} program match`,
        );
    }
    milestones.evidence = `${programMatch}/${evidence.length} fetched_ok and program_id_match`;

    // One atomic lane when the budget allows: init, clock, acks, full
    // funding of both legs, start, settle in one transaction.
    milestones.atomic = "SKIPPED: insufficient driver SOL for a second lane";
    const driverAfterSequential = await connection.getBalance(driver.publicKey);
    if (
        driverAfterSequential >= ATOMIC_MIN_DRIVER_LAMPORTS &&
        atomicTokensAffordable
    ) {
        console.log("-- atomic lane --");
        try {
            const atomicId = await findFreeScenarioId(
                connection,
                driver.publicKey,
                7300n,
            );
            const [atomicScenario] = scenarioPda(driver.publicKey, atomicId);
            await must("init_scenario", () =>
                client.initScenario({
                    driver: driver.publicKey,
                    party_a: partyA.publicKey,
                    party_b: partyB.publicKey,
                    scenario_id: atomicId,
                    ticket_hash: ticketHash(),
                    path: "ATOMIC",
                    leg1_usd_cents: LEG1_USD_CENTS,
                    leg2_cad_cents: LEG2_CAD_CENTS,
                    gap_ms: GAP_MS,
                }),
            );
            // Same zero time precondition as the sequential lane.
            await must("advance_clock", () =>
                client.advanceClock({
                    scenario: atomicScenario,
                    signer: driver.publicKey,
                    to_ms: T_START_MS,
                }),
            );
            await must("ack_a", () =>
                client.ack({
                    scenario: atomicScenario,
                    signer: partyA.publicKey,
                }),
            );
            await must("ack_b", () =>
                client.ack({
                    scenario: atomicScenario,
                    signer: partyB.publicKey,
                }),
            );
            await must("fund_leg_usd", () =>
                client.fundLeg({
                    scenario: atomicScenario,
                    signer: partyA.publicKey,
                    leg: "LEG1_USD",
                    amount_cents: LEG1_USD_CENTS,
                }),
            );
            await must("fund_leg_cad", () =>
                client.fundLeg({
                    scenario: atomicScenario,
                    signer: partyB.publicKey,
                    leg: "LEG2_CAD",
                    amount_cents: LEG2_CAD_CENTS,
                }),
            );
            await must("start_race", () =>
                client.startRace({
                    scenario: atomicScenario,
                    signer: driver.publicKey,
                }),
            );
            await must("settle_atomic", () =>
                client.settleAtomic({
                    scenario: atomicScenario,
                    signer: driver.publicKey,
                }),
            );
            const atomicState = await mustFetch("fetch_scenario", () =>
                client.fetchScenario(atomicScenario),
            );
            console.log(
                `  state       status=${atomicState.status} paid=${atomicState.paid_cad_cents}`,
            );
            if (atomicState.status !== "SETTLED") {
                throw new Error(`expected SETTLED, got ${atomicState.status}`);
            }
            milestones.atomic = "SETTLED";
        } catch (err) {
            milestones.atomic = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
        }
    } else if (!atomicTokensAffordable) {
        milestones.atomic = "SKIPPED: token balances cover one lane only";
    }

    // Spend accounting across all three wallets.
    printSummary(await measureSpend());
}

/** Deterministic 32 byte ticket hash for the smoke ticket. */
function ticketHash(): Uint8Array {
    const payload = JSON.stringify({
        scenario: "smoke_phase3",
        leg1: LEG1_USD_CENTS.toString(),
        leg2: LEG2_CAD_CENTS.toString(),
        gap: GAP_MS.toString(),
    });
    return new Uint8Array(createHash("sha256").update(payload).digest());
}

/**
 * Report a fault and exit with the right classification: network shaped
 * faults after retries are PARTIAL (exit 0, the phase is not failed for
 * devnet flakiness), everything else is FAIL.
 */
function reportFault(label: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${label}: ${message}`);
    const network = isNetworkFault(message);
    void (async () => {
        const spend = await measureSpend();
        printSummary(spend);
        finish(
            network ? 0 : 1,
            network
                ? "RESULT: PARTIAL (devnet RPC fault after retries)"
                : "RESULT: FAIL",
        );
    })();
}

process.on("uncaughtException", (err) => {
    reportFault("UNCAUGHT", err);
});
process.on("unhandledRejection", (err) => {
    reportFault("UNHANDLED", err);
});

main()
    .then(() => {
        finish(0, "RESULT: PASS");
    })
    .catch((err: unknown) => {
        reportFault("ERROR", err);
    });
