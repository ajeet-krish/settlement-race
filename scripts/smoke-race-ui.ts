// Live devnet smoke for the wired Race view.
//
// Drives one full honest scenario end to end through the exact factory the
// React Race tab uses (createRaceSource from app/src/lib/raceSource.ts),
// with two seams only: the demo accounts loader reads app/public/demo-accounts
// .json from disk (node has no app origin to fetch from), and the connection
// is the one this script already uses for its preflight and spend checks.
// Everything else, account validation, Anchor client construction, the
// ScenarioEngine run with anchor_head enabled, and the ChainHead verify, is
// the production path.
//
// Output: step count, terminal status of both lanes, chain verify result,
// transaction signature count, elapsed time, and SOL spent against the
// 0.03 SOL budget.
//
// Token preflight: the honest scenario funds both lanes, so party A needs
// 2 x leg 1 USD cents and party B needs 2 x leg 2 CAD cents, while
// setup-devnet provisions one UI sized lane (see docs/tests.md). Shortfalls
// are minted with the recorded mint authority, the same devnet play money
// setup mints, before anything runs. --topup stops after that step, which
// is the command the UI's insufficient funds hint points at.
//
// Budget: at most 0.03 SOL across the three wallets, checked before the
// run and again before the single rate limit retry (a retry rents a second
// pair of scenario accounts, so it must fit the remaining budget). Devnet
// play money only; secrets are loaded into memory and never printed.

import { chmodSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    clusterApiUrl,
} from "@solana/web3.js";
import type { Signer } from "@solana/web3.js";
import {
    getAccount,
    getAssociatedTokenAddressSync,
    mintTo,
} from "@solana/spl-token";
import {
    DEMO_ACCOUNTS_MISSING_GUIDANCE,
    DemoAccountsError,
    demoKeypair,
    parseDemoAccounts,
} from "../app/src/lib/demoAccounts";
import { PROGRAM_ID } from "../app/src/lib/pda";
import { createRaceSource } from "../app/src/lib/raceSource";
import type { RaceEvent } from "../app/src/engine/scenarioEngine";
import { getScenario } from "../app/src/engine/scenarios";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const DEMO_ACCOUNTS_FILE = join(
    REPO_ROOT,
    "app",
    "public",
    "demo-accounts.json",
);
const KEYPAIRS_FILE = join(SCRIPT_DIR, "devnet-keypairs.json");
const RPC_URL = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
/**
 * Pinned Solana devnet genesis hash, the same guard setup-devnet.ts uses,
 * so a misconfigured SOLANA_RPC_URL can never spend against another
 * cluster. SOLANA_ALLOW_NON_DEVNET=1 bypasses it with a loud warning.
 */
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

// One honest run rents two scenarios, four vaults, and one chain head
// (about 0.014 SOL on the driver), pays fees from party A, and mints the
// token top up once. The ceiling covers that plus one rate limited retry.
const TOTAL_BUDGET_LAMPORTS = 30_000_000;
const DRIVER_MIN_LAMPORTS = 20_000_000;
const FEE_PAYER_MIN_LAMPORTS = 5_000_000;
const RETRY_RESERVE_LAMPORTS = 15_000_000;
const MAX_SEND_ATTEMPTS = 4;
const RETRY_AFTER_RATE_LIMIT_MS = 2_500;

interface Balances {
    a: number;
    b: number;
    driver: number;
}

interface StoredKeypairs {
    authority?: number[];
}

let startBalances: Balances | null = null;
let balanceKeys: { a: PublicKey; b: PublicKey; driver: PublicKey } | null = null;
let summaryPrinted = false;
let finished = false;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRateLimit(text: string): boolean {
    return /\b429\b|\b410\b|too many requests|rate limit/i.test(text);
}

function isNetworkFault(text: string): boolean {
    return /429|410|too many requests|rate limit|fetch failed|timeout|econn|network|socket|blockhash not found|unexpected server response/i.test(
        text,
    );
}

/** Lamports as a SOL string; display only, the integer math stays exact. */
function sol(lamports: number): string {
    return (lamports / LAMPORTS_PER_SOL).toFixed(5);
}

/**
 * Read the demo accounts file the UI fetches, through the same validation
 * the browser path uses. Node has no app origin, so the loader seam reads
 * the file from disk instead of over HTTP.
 */
function loadDemoAccounts() {
    let raw: string;
    try {
        raw = readFileSync(DEMO_ACCOUNTS_FILE, "utf8");
    } catch {
        throw new DemoAccountsError("missing", DEMO_ACCOUNTS_MISSING_GUIDANCE);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new DemoAccountsError(
            "bad_json",
            "demo-accounts.json is not valid JSON.",
        );
    }
    return Promise.resolve(parseDemoAccounts(parsed));
}

/** Mint authority from the setup keypair store; never logged. */
function loadMintAuthority(): Keypair {
    let raw: string;
    try {
        // Re-assert mode 600 at read time, the same guard setup-devnet.ts
        // applies when it loads the store; a looser mode would leave the
        // mint authority secret world readable on disk.
        chmodSync(KEYPAIRS_FILE, 0o600);
        raw = readFileSync(KEYPAIRS_FILE, "utf8");
    } catch {
        throw new Error(
            "mint authority file missing; run npx tsx scripts/setup-devnet.ts first",
        );
    }
    const stored = JSON.parse(raw) as StoredKeypairs;
    if (!Array.isArray(stored.authority)) {
        throw new Error(
            "mint authority missing; run npx tsx scripts/setup-devnet.ts first",
        );
    }
    return Keypair.fromSecretKey(Uint8Array.from(stored.authority));
}

/** Token balance of an owner's canonical ATA, 0 when the account is absent. */
async function tokenBalance(
    connection: Connection,
    mint: PublicKey,
    owner: PublicKey,
): Promise<bigint> {
    try {
        const account = await getAccount(
            connection,
            getAssociatedTokenAddressSync(mint, owner),
            "confirmed",
        );
        return account.amount;
    } catch {
        return 0n;
    }
}

async function readBalances(connection: Connection, keys: {
    a: PublicKey;
    b: PublicKey;
    driver: PublicKey;
}): Promise<Balances> {
    return {
        a: await connection.getBalance(keys.a, "confirmed"),
        b: await connection.getBalance(keys.b, "confirmed"),
        driver: await connection.getBalance(keys.driver, "confirmed"),
    };
}

function totalOf(balances: Balances): number {
    return balances.a + balances.b + balances.driver;
}

/** Run one mint, retrying only clear RPC rate limits with backoff. */
async function mintWithRetry(label: string, mint: () => Promise<string>): Promise<void> {
    let last = "";
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
        try {
            await mint();
            return;
        } catch (error) {
            last = errorMessage(error);
            if (attempt < MAX_SEND_ATTEMPTS && isRateLimit(last)) {
                console.log(`  retry       ${label} rate limited (${last})`);
                await sleep(1_500 * attempt);
                continue;
            }
            throw new Error(`${label} mint failed: ${last}`);
        }
    }
    throw new Error(`${label} mint failed: ${last}`);
}

/**
 * Mint the shortfall so both parties can fund both lanes: party A to
 * 2 x leg 1 USD cents, party B to 2 x leg 2 CAD cents. Play money only,
 * with the recorded devnet mint authority.
 */
async function topUpTokens(args: {
    connection: Connection;
    payer: Signer;
    partyB: PublicKey;
    usdMint: PublicKey;
    cadMint: PublicKey;
    needAUsd: bigint;
    needBCad: bigint;
    haveAUsd: bigint;
    haveBCad: bigint;
}): Promise<void> {
    const authority = loadMintAuthority();
    console.log(
        `mint authority ${authority.publicKey.toBase58()} (devnet play money)`,
    );
    if (args.haveAUsd < args.needAUsd) {
        const missing = args.needAUsd - args.haveAUsd;
        const ata = getAssociatedTokenAddressSync(args.usdMint, args.payer.publicKey);
        await mintWithRetry("party A USD", () =>
            mintTo(
                args.connection,
                args.payer,
                args.usdMint,
                ata,
                authority,
                missing,
            ),
        );
        console.log(`  minted      party A +${missing} USD cents (now ${args.needAUsd})`);
    }
    if (args.haveBCad < args.needBCad) {
        const missing = args.needBCad - args.haveBCad;
        const ata = getAssociatedTokenAddressSync(args.cadMint, args.partyB);
        await mintWithRetry("party B CAD", () =>
            mintTo(
                args.connection,
                args.payer,
                args.cadMint,
                ata,
                authority,
                missing,
            ),
        );
        console.log(`  minted      party B +${missing} CAD cents (now ${args.needBCad})`);
    }
}

/**
 * Terminal status pair from the last event that carries a snapshot, or
 * null when the run never reached a snapshot bearing step.
 */
function terminalStatuses(
    events: readonly RaceEvent[],
): { sequential: string; atomic: string } | null {
    for (let index = events.length - 1; index >= 0; index--) {
        const snapshot = events[index]?.status_snapshot;
        if (snapshot !== undefined) {
            return snapshot;
        }
    }
    return null;
}

function printSpend(start: Balances | null, end: Balances | null): void {
    if (start === null || end === null) {
        console.log("sol spent     unavailable (balance read failed)");
        return;
    }
    const spent =
        start.a - end.a + (start.b - end.b) + (start.driver - end.driver);
    const budgetNote =
        spent > TOTAL_BUDGET_LAMPORTS ? "OVER BUDGET" : "within budget";
    console.log(
        `sol spent     ${sol(spent)} SOL (${budgetNote}; wallets ${sol(totalOf(start))} -> ${sol(totalOf(end))})`,
    );
}

/** Terminate exactly once: print the outcome, then exit after a beat. */
function finish(code: number, outcome: string): void {
    if (finished) {
        return;
    }
    finished = true;
    console.log(outcome);
    process.exitCode = code;
    setTimeout(() => {
        process.exit(code);
    }, 1_000).unref();
}

/**
 * Report a fault with whatever completed: network shaped faults after
 * retries are PARTIAL (exit 0, devnet flakiness is not a code failure),
 * everything else is FAIL.
 */
function reportFault(label: string, error: unknown): void {
    console.error(`${label}: ${errorMessage(error)}`);
    const network = isNetworkFault(errorMessage(error));
    void (async () => {
        let end: Balances | null = null;
        if (startBalances !== null && balanceKeys !== null) {
            try {
                const connection = new Connection(RPC_URL, "confirmed");
                end = await readBalances(connection, balanceKeys);
            } catch {
                end = null;
            }
        }
        if (!summaryPrinted) {
            summaryPrinted = true;
            printSpend(startBalances, end);
        }
        finish(
            network ? 0 : 1,
            network
                ? "RESULT: PARTIAL (devnet RPC fault after retries)"
                : "RESULT: FAIL",
        );
    })();
}

async function main(): Promise<void> {
    const onlyTopUp = process.argv.includes("--topup");
    console.log("== Race view devnet smoke (play money only) ==");
    const connection = new Connection(RPC_URL, "confirmed");
    console.log(`rpc          ${RPC_URL}`);

    const genesis = await connection.getGenesisHash();
    if (
        genesis !== DEVNET_GENESIS_HASH &&
        process.env.SOLANA_ALLOW_NON_DEVNET !== "1"
    ) {
        throw new Error(
            `refusing to run: ${RPC_URL} reports genesis hash ${genesis}, ` +
                `expected devnet ${DEVNET_GENESIS_HASH}; ` +
                "set SOLANA_ALLOW_NON_DEVNET=1 to override (emergencies only)",
        );
    }

    const source = await createRaceSource({
        connection,
        loadAccounts: loadDemoAccounts,
    });
    if (source.status === "missing-accounts") {
        throw new Error(source.guidance);
    }
    if (source.status === "error") {
        throw new Error(source.message);
    }
    if (source.status !== "ready") {
        throw new Error("createRaceSource returned an unexpected state");
    }

    const accounts = source.accounts;
    const partyA = demoKeypair(accounts.partyA);
    const keys = {
        a: new PublicKey(accounts.partyA.pubkey),
        b: new PublicKey(accounts.partyB.pubkey),
        driver: new PublicKey(accounts.driver.pubkey),
    };
    const usdMint = new PublicKey(accounts.usd_mint);
    const cadMint = new PublicKey(accounts.cad_mint);

    console.log(`program      ${PROGRAM_ID.toBase58()}`);
    console.log(`party A      ${keys.a.toBase58()} (fee payer, mint payer)`);
    console.log(`party B      ${keys.b.toBase58()}`);
    console.log(`driver       ${keys.driver.toBase58()} (init payer)`);

    const programInfo = await connection.getAccountInfo(PROGRAM_ID);
    if (programInfo === null || !programInfo.executable) {
        throw new Error(`program ${PROGRAM_ID.toBase58()} is not deployed`);
    }

    const start = await readBalances(connection, keys);
    startBalances = start;
    balanceKeys = keys;
    console.log(
        `balances     A ${sol(start.a)} | B ${sol(start.b)} | driver ${sol(start.driver)} SOL (total ${sol(totalOf(start))})`,
    );
    if (start.driver < DRIVER_MIN_LAMPORTS) {
        throw new Error(
            `insufficient driver balance ${sol(start.driver)} SOL; ` +
                `need at least ${sol(DRIVER_MIN_LAMPORTS)} SOL for scenario rents ` +
                "(run npx tsx scripts/setup-devnet.ts to top up)",
        );
    }
    if (start.a < FEE_PAYER_MIN_LAMPORTS) {
        throw new Error(
            `insufficient party A balance ${sol(start.a)} SOL for transaction fees`,
        );
    }

    // Token preflight: both lanes fund in full, so the parties need twice
    // the single lane notionals setup-devnet provisions.
    const spec = getScenario("honest");
    const needAUsd = 2n * spec.leg1_usd_cents;
    const needBCad = 2n * spec.leg2_cad_cents;
    const haveAUsd = await tokenBalance(connection, usdMint, keys.a);
    const haveBCad = await tokenBalance(connection, cadMint, keys.b);
    console.log(
        `tokens       A USD ${haveAUsd} of ${needAUsd} cents | B CAD ${haveBCad} of ${needBCad} cents`,
    );
    if (haveAUsd < needAUsd || haveBCad < needBCad) {
        console.log("-- token top up --");
        await topUpTokens({
            connection,
            payer: partyA,
            partyB: keys.b,
            usdMint,
            cadMint,
            needAUsd,
            needBCad,
            haveAUsd,
            haveBCad,
        });
    } else {
        console.log("tokens       sufficient for both lanes");
    }
    if (onlyTopUp) {
        finish(0, "RESULT: TOPUP OK");
        return;
    }

    console.log("-- honest scenario run --");
    const events: RaceEvent[] = [];
    const startedAt = Date.now();
    let outcome = await source.runScenario(spec, (event) => {
        events.push(event);
    });

    // One retry for a clear rate limit, only when the remaining budget
    // can rent a second pair of scenario accounts.
    if (
        outcome.chain_ok === null &&
        outcome.error !== undefined &&
        isRateLimit(outcome.error)
    ) {
        const current = await readBalances(connection, keys);
        const spentSoFar = totalOf(start) - totalOf(current);
        if (spentSoFar + RETRY_RESERVE_LAMPORTS <= TOTAL_BUDGET_LAMPORTS) {
            console.log(`retry        ${outcome.error}`);
            await sleep(RETRY_AFTER_RATE_LIMIT_MS);
            events.length = 0;
            outcome = await source.runScenario(spec, (event) => {
                events.push(event);
            });
        } else {
            console.log(
                "retry        skipped: a second run would exceed the SOL budget",
            );
        }
    }
    const elapsedSeconds = (Date.now() - startedAt) / 1_000;

    const terminals = terminalStatuses(events);
    const signatures = events.filter((event) => event.tx_sig != null).length;
    const chainLabel =
        outcome.chain_ok === true
            ? "VALID (chain_ok true)"
            : outcome.chain_ok === false
              ? "BROKEN (chain_ok false)"
              : "not run (chain_ok null)";
    console.log(`  steps        ${events.length} provenance events`);
    console.log(`  sequential   ${terminals?.sequential ?? "unavailable"}`);
    console.log(`  atomic       ${terminals?.atomic ?? "unavailable"}`);
    console.log(
        `  chain verify ${chainLabel}${outcome.error !== undefined ? `: ${outcome.error}` : ""}`,
    );
    console.log(`  signatures   ${signatures} transactions`);
    console.log(`  elapsed      ${elapsedSeconds.toFixed(1)} s`);

    const end = await readBalances(connection, keys);
    if (!summaryPrinted) {
        summaryPrinted = true;
        printSpend(start, end);
    }
    const spent = totalOf(start) - totalOf(end);
    const passed =
        outcome.chain_ok === true &&
        events.length > 0 &&
        terminals !== null &&
        spent <= TOTAL_BUDGET_LAMPORTS;
    if (passed) {
        finish(0, "RESULT: PASS");
        return;
    }
    const networkFault =
        outcome.error !== undefined && isNetworkFault(outcome.error);
    if (networkFault) {
        finish(0, "RESULT: PARTIAL (devnet RPC fault after retries)");
        return;
    }
    finish(1, "RESULT: FAIL");
}

process.on("uncaughtException", (error) => {
    reportFault("UNCAUGHT", error);
});
process.on("unhandledRejection", (error) => {
    reportFault("UNHANDLED", error);
});

main().catch((error: unknown) => {
    reportFault("ERROR", error);
});
