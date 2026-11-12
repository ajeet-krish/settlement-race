/**
 * Devnet setup for Settlement Race.
 *
 * Creates two legacy SPL Token mints (USD and CAD, 2 decimals), airdrops SOL
 * to the two party wallets with retry on devnet faucet rate limits, creates
 * associated token accounts for both parties on both mints, mints the initial
 * play money balances, and writes every pubkey to scripts/devnet-accounts.json.
 *
 * It also keeps a third demo keypair (the race driver) in the keypair store,
 * tops the driver wallet up with SOL from the payer when it runs low, and
 * writes the browser facing demo keypairs and mint addresses to
 * app/public/demo-accounts.json (gitignored, mode 600, devnet secrets) so the
 * React UI can load them without a wallet adapter.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/setup-devnet.ts           # create once, then top up
 *   npx tsx scripts/setup-devnet.ts --reset   # regenerate party keypairs
 *
 * --reset note: --reset deletes scripts/devnet-keypairs.json and
 * scripts/devnet-accounts.json, then generates fresh authority and party
 * keypairs. Mints from an earlier run are left on devnet untouched and become
 * orphaned. Running without --reset reuses the recorded keypairs and mints,
 * creating nothing twice and only topping balances up to the initial amounts.
 *
 * The payer is the solana CLI wallet (~/.config/solana/id.json) when it
 * exists, otherwise an ephemeral keypair funded by airdrop. The mint
 * authority is a dedicated keypair persisted in scripts/devnet-keypairs.json
 * so later runs can top up balances.
 *
 * Cluster guard: before any transaction is sent, the script fetches the RPC
 * genesis hash and compares it against the pinned Solana devnet genesis hash
 * (DEVNET_GENESIS_HASH below, pinned from api.devnet.solana.com and cross
 * checked with `solana genesis-hash --url devnet`). A mismatch aborts with a
 * clear error, so a SOLANA_RPC_URL pointed at another cluster can never spend
 * the real solana CLI wallet or create real mints. Emergency override:
 * SOLANA_ALLOW_NON_DEVNET=1 bypasses the guard and prints a loud warning.
 *
 * Funding order for the party wallets: the devnet faucet first (it is the
 * canonical source and is sometimes closed with RPC error 410 or rate
 * limited with 429), then a SOL transfer from the payer wallet as a
 * fallback, keeping a reserve in the payer for future fees.
 *
 * Devnet play money only. Never deploy to or reference mainnet, and never
 * handle real funds. The keypair file is gitignored because it holds secrets,
 * even though devnet keys are worthless.
 */

import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    clusterApiUrl,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    createMint,
    getAccount,
    getMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
} from "@solana/spl-token";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(SCRIPT_DIR);
const ACCOUNTS_FILE = join(SCRIPT_DIR, "devnet-accounts.json");
const KEYPAIRS_FILE = join(SCRIPT_DIR, "devnet-keypairs.json");
/** Gitignored JSON the React UI fetches for the three demo keypairs. */
const DEMO_ACCOUNTS_FILE = join(REPO_ROOT, "app", "public", "demo-accounts.json");
const PROGRAM_SOURCE_FILE = join(
    REPO_ROOT,
    "programs",
    "settlement-race",
    "src",
    "lib.rs",
);
const CLI_WALLET_FILE = join(homedir(), ".config", "solana", "id.json");

const RPC_URL = process.env.SOLANA_RPC_URL ?? clusterApiUrl("devnet");
/**
 * Pinned Solana devnet genesis hash. Obtained by calling getGenesisHash on
 * https://api.devnet.solana.com twice with matching results, then cross
 * checked against `solana genesis-hash --url devnet` (Agave 4.1.2), which
 * returned the same value. The guard in assertDevnet aborts on any mismatch.
 */
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const USD_DECIMALS = 2;
const CAD_DECIMALS = 2;

/** SOL requested per party; halved on rate limit failures, floored at 0.25. */
const PARTY_AIRDROP_SOL = 2;
const MIN_AIRDROP_SOL = 0.25;
/** Payer needs rent for mints, ATAs, and transaction fees. */
const PAYER_MIN_SOL = 0.5;
/** Sol the payer keeps for itself when it has to fund parties by transfer. */
const PAYER_KEEP_SOL = 0.5;
/** Lamports held back from payer transfers to cover transaction fees. */
const FEE_BUFFER_LAMPORTS = 10_000_000; // 0.01 SOL
/** Balance at or above this counts as a funded, usable party wallet. */
const PARTY_MIN_LAMPORTS = Math.floor(0.1 * LAMPORTS_PER_SOL);
/** The demo driver only signs race transactions, so it needs less SOL. */
const DRIVER_MIN_LAMPORTS = Math.floor(0.05 * LAMPORTS_PER_SOL);
/**
 * After this run has transferred SOL to the driver once, only a balance at
 * or above this counts as still topped up; anything lower means the wallet
 * was drained again mid run and is rescued like a normal top up.
 */
const DRIVER_TOPPED_LAMPORTS = Math.floor(0.1 * LAMPORTS_PER_SOL);
const AIRDROP_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000];
const AIRDROP_CONFIRM_TIMEOUT_MS = 20_000;

/** Set once the faucet reports it is closed (RPC error 410), to skip retries. */
let faucetClosed = false;

/**
 * Scenario catalogue notionals in integer cents, mirroring LEG1_USD_CENTS
 * and LEG2_CAD_CENTS in app/src/engine/scenarios.ts (all five specs share
 * them) and the demo ticket in docs/tradeops-schema.md.
 */
const SCENARIO_LEG1_USD_CENTS = 1_000_000n; // USD 10,000.00
const SCENARIO_LEG2_CAD_CENTS = 1_350_000n; // CAD 13,500.00
/** Full funding in basis points: 10000 bps equals 1.0 (fund_bps max). */
const FULL_FUND_BPS = 10_000n;
/** Largest fund_bps across the five specs (honest, default, late use 10000). */
const MAX_FUND_BPS = 10_000n;
/** The race UI funds both lanes (sequential and atomic) from one party pair. */
const FUNDED_LANES = 2n;
/** Headroom above the two-lane requirement: 1000 bps equals 10 percent. */
const HEADROOM_BPS = 1_000n;

/** Ceiling division so a target never rounds below the requirement. */
function centsCeil(numerator: bigint, denominator: bigint): bigint {
    return (numerator + denominator - 1n) / denominator;
}

/**
 * Party A's USD target: two lanes of the largest USD leg requirement across
 * the five specs (the USD leg is not bps scaled), plus 10 percent headroom.
 * Integer math only: 1,000,000 x 2 x 11,000 / 10,000 = 2,200,000 cents.
 */
const PARTY_A_USD_TARGET_CENTS = centsCeil(
    SCENARIO_LEG1_USD_CENTS * FUNDED_LANES * (FULL_FUND_BPS + HEADROOM_BPS),
    FULL_FUND_BPS,
);

/**
 * Party B's CAD target: two lanes of the largest CAD leg at the highest
 * fund_bps (10000), plus 10 percent headroom. Integer math only:
 * 1,350,000 x 2 x 10,000 / 10,000 x 11,000 / 10,000 = 2,970,000 cents.
 */
const PARTY_B_CAD_TARGET_CENTS = centsCeil(
    SCENARIO_LEG2_CAD_CENTS *
        FUNDED_LANES *
        MAX_FUND_BPS *
        (FULL_FUND_BPS + HEADROOM_BPS),
    FULL_FUND_BPS * FULL_FUND_BPS,
);

/**
 * Initial balances in integer cents. With 2 decimals, one base unit equals
 * one cent, so cents are also the mint amount. Party A holds mostly USD,
 * party B holds mostly CAD, matching an FX trade where each side starts long
 * its own currency. The USD and CAD sides cover both race lanes plus the
 * headroom above; the small secondary balances are display only.
 */
const INITIAL_BALANCES_CENTS = {
    party_a: { usd: PARTY_A_USD_TARGET_CENTS, cad: 50_000n }, // 22,000.00 USD and 500.00 CAD
    party_b: { usd: 50_000n, cad: PARTY_B_CAD_TARGET_CENTS }, // 500.00 USD and 29,700.00 CAD
} as const;

interface StoredKeypairs {
    note: string;
    authority: number[];
    party_a: number[];
    party_b: number[];
    driver: number[];
}

interface PreviousAccounts {
    mints: { usd: string; cad: string };
}

interface DevnetAccounts {
    cluster: "devnet";
    rpc_url: string;
    created_at: string;
    note: string;
    decimals: { usd: number; cad: number };
    mints: { usd: string; cad: string };
    authority: string;
    payer: string;
    parties: {
        party_a: { pubkey: string; token_accounts: { usd: string; cad: string } };
        party_b: { pubkey: string; token_accounts: { usd: string; cad: string } };
    };
    initial_balances_cents: {
        party_a: { usd: string; cad: string };
        party_b: { usd: string; cad: string };
    };
    sol_funded: { party_a: boolean; party_b: boolean };
}

/** One entry of app/public/demo-accounts.json: secret and public key. */
interface DemoAccountEntry {
    secret: string;
    pubkey: string;
}

/**
 * app/public/demo-accounts.json: the browser facing subset of the devnet
 * setup, three demo keypairs plus the mint addresses. It holds secrets (devnet
 * play money only), so it is gitignored and written with mode 600.
 */
interface DemoAccountsFile {
    version: 1;
    cluster: "devnet";
    program_id: string;
    partyA: DemoAccountEntry;
    partyB: DemoAccountEntry;
    driver: DemoAccountEntry;
    usd_mint: string;
    cad_mint: string;
    note: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Format an integer lamport count as a SOL string using integer math only:
 * whole SOL from integer division plus the remainder zero padded to nine
 * digits, so no float rounding ever reaches the output.
 */
function formatSol(lamports: number): string {
    const whole = Math.floor(lamports / 1_000_000_000);
    const remainder = lamports - whole * 1_000_000_000;
    return `${whole}.${String(remainder).padStart(9, "0")}`;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode bytes as base58 (the Solana alphabet) with bigint math. The demo
 * accounts file stores keypair secrets as base58 strings; `bs58` is not a
 * dependency of this workspace, so the encoding lives here. Leading zero
 * bytes become leading "1" characters, matching the usual base58 rules.
 */
function base58Encode(bytes: Uint8Array): string {
    let value = 0n;
    for (const byte of bytes) {
        value = (value << 8n) | BigInt(byte);
    }
    let encoded = "";
    while (value > 0n) {
        encoded = `${BASE58_ALPHABET.charAt(Number(value % 58n))}${encoded}`;
        value /= 58n;
    }
    for (const byte of bytes) {
        if (byte !== 0) {
            break;
        }
        encoded = `1${encoded}`;
    }
    return encoded;
}

/**
 * Read the program id from declare_id! in the Anchor program source, the
 * value `anchor keys sync` keeps aligned with Anchor.toml and the app's
 * pda.ts PROGRAM_ID, so the demo accounts file always carries the id the
 * frontend validates against.
 */
function readProgramId(): string {
    const match = /declare_id!\s*\(\s*"([1-9A-HJ-NP-Za-km-z]+)"\s*\)/.exec(
        readFileSync(PROGRAM_SOURCE_FILE, "utf8"),
    );
    if (match === null || match[1] === undefined) {
        throw new Error(`Could not find declare_id!("...") in ${PROGRAM_SOURCE_FILE}`);
    }
    return match[1];
}

async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => {
                    reject(new Error(`${label} timed out after ${ms} ms`));
                }, ms);
            }),
        ]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

function loadCliPayer(): Keypair | null {
    if (!existsSync(CLI_WALLET_FILE)) {
        return null;
    }
    try {
        const raw = JSON.parse(readFileSync(CLI_WALLET_FILE, "utf8")) as number[];
        return Keypair.fromSecretKey(Uint8Array.from(raw));
    } catch (error) {
        console.warn(`Could not read solana CLI wallet: ${errorMessage(error)}`);
        return null;
    }
}

function loadOrCreateKeypairs(): {
    authority: Keypair;
    party_a: Keypair;
    party_b: Keypair;
    driver: Keypair;
} {
    if (existsSync(KEYPAIRS_FILE)) {
        chmodSync(KEYPAIRS_FILE, 0o600);
        const stored = JSON.parse(
            readFileSync(KEYPAIRS_FILE, "utf8"),
        ) as StoredKeypairs;
        return {
            authority: Keypair.fromSecretKey(Uint8Array.from(stored.authority)),
            party_a: Keypair.fromSecretKey(Uint8Array.from(stored.party_a)),
            party_b: Keypair.fromSecretKey(Uint8Array.from(stored.party_b)),
            driver: loadOrMigrateDriver(stored),
        };
    }
    const generated = {
        authority: Keypair.generate(),
        party_a: Keypair.generate(),
        party_b: Keypair.generate(),
        driver: Keypair.generate(),
    };
    const stored: StoredKeypairs = {
        note: "Devnet play money only. Never use these keys on mainnet.",
        authority: Array.from(generated.authority.secretKey),
        party_a: Array.from(generated.party_a.secretKey),
        party_b: Array.from(generated.party_b.secretKey),
        driver: Array.from(generated.driver.secretKey),
    };
    writeFileSync(KEYPAIRS_FILE, `${JSON.stringify(stored, null, 2)}\n`, {
        mode: 0o600,
    });
    console.log(`Wrote new keypairs to ${KEYPAIRS_FILE}`);
    return generated;
}

/**
 * Read the demo driver keypair from the store, generating and persisting one
 * when the file predates the driver field (files written before the demo
 * accounts pipeline existed). The rewrite keeps mode 600, so the secrets never
 * land with wider permissions.
 */
function loadOrMigrateDriver(stored: StoredKeypairs): Keypair {
    const existing: number[] | undefined = stored.driver;
    if (Array.isArray(existing)) {
        return Keypair.fromSecretKey(Uint8Array.from(existing));
    }
    const driver = Keypair.generate();
    stored.driver = Array.from(driver.secretKey);
    writeFileSync(KEYPAIRS_FILE, `${JSON.stringify(stored, null, 2)}\n`, {
        mode: 0o600,
    });
    console.log(`Added demo driver keypair to ${KEYPAIRS_FILE}`);
    return driver;
}

function loadPreviousAccounts(): PreviousAccounts | null {
    if (!existsSync(ACCOUNTS_FILE)) {
        return null;
    }
    try {
        const raw = JSON.parse(
            readFileSync(ACCOUNTS_FILE, "utf8"),
        ) as DevnetAccounts;
        return { mints: raw.mints };
    } catch (error) {
        console.warn(
            `Ignoring unreadable ${ACCOUNTS_FILE}: ${errorMessage(error)}`,
        );
        return null;
    }
}

/**
 * Request an airdrop, halving the amount when the devnet faucet rate limits
 * us, with exponential backoff. Returns false when every attempt fails so the
 * caller can decide whether the shortfall is fatal.
 */
async function airdropWithRetry(
    connection: Connection,
    to: PublicKey,
    lamports: number,
): Promise<boolean> {
    if (faucetClosed) {
        console.warn(`  skipping airdrop for ${to.toBase58()}: faucet already reported closed`);
        return false;
    }
    let amount = lamports;
    for (let attempt = 1; attempt <= AIRDROP_BACKOFF_MS.length; attempt++) {
        try {
            const signature = await withTimeout(
                connection.requestAirdrop(to, amount),
                AIRDROP_CONFIRM_TIMEOUT_MS,
                "requestAirdrop",
            );
            const latest = await connection.getLatestBlockhash("confirmed");
            await withTimeout(
                connection.confirmTransaction(
                    { signature, ...latest },
                    "confirmed",
                ),
                AIRDROP_CONFIRM_TIMEOUT_MS,
                "confirmTransaction",
            );
            const balance = await connection.getBalance(to, "confirmed");
            if (balance >= amount) {
                console.log(
                    `  airdrop ok: ${to.toBase58()} received ${formatSol(amount)} SOL`,
                );
                return true;
            }
            console.warn(
                `  airdrop confirmed but balance is only ${balance} lamports, retrying`,
            );
        } catch (error) {
            const message = errorMessage(error);
            console.warn(
                `  airdrop attempt ${attempt}/${AIRDROP_BACKOFF_MS.length} for ${to.toBase58()} failed: ${message}`,
            );
            if (message.includes("faucet is closed") || message.startsWith("410")) {
                faucetClosed = true;
                console.warn(
                    "  devnet faucet is closed (RPC 410); falling back to payer transfers",
                );
                break;
            }
        }
        amount = Math.max(
            Math.floor(amount / 2),
            Math.floor(MIN_AIRDROP_SOL * LAMPORTS_PER_SOL),
        );
        const backoff = AIRDROP_BACKOFF_MS[attempt - 1] ?? 20_000;
        if (attempt < AIRDROP_BACKOFF_MS.length) {
            await sleep(backoff);
        }
    }
    if (!faucetClosed) {
        console.warn(
            `  giving up on airdrop to ${to.toBase58()}; the devnet faucet is rate limiting this address`,
        );
    }
    return false;
}

/**
 * Fallback funding path: send SOL from the payer wallet to a party wallet.
 * The payer splits what it can spare above its own keep between the parties,
 * so funding party A can never drain party B.
 */
async function transferFromPayer(
    connection: Connection,
    payer: Keypair,
    to: PublicKey,
    requestedLamports: number,
    shareLamports: number,
): Promise<boolean> {
    const amount = Math.min(requestedLamports, shareLamports);
    if (amount < Math.floor(MIN_AIRDROP_SOL * LAMPORTS_PER_SOL)) {
        console.warn(
            `  payer cannot fund ${to.toBase58()}: not enough spare SOL above its ${PAYER_KEEP_SOL} SOL reserve`,
        );
        return false;
    }
    try {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: to,
                lamports: amount,
            }),
        );
        await withTimeout(
            sendAndConfirmTransaction(connection, transaction, [payer], {
                commitment: "confirmed",
            }),
            AIRDROP_CONFIRM_TIMEOUT_MS,
            "payer transfer",
        );
        console.log(
            `  payer sent ${formatSol(amount)} SOL to ${to.toBase58()}`,
        );
        return true;
    } catch (error) {
        console.warn(
            `  payer transfer to ${to.toBase58()} failed: ${errorMessage(error)}`,
        );
        return false;
    }
}

/**
 * Ensure both party wallets hold SOL: faucet first, payer transfer second.
 * Returns one boolean per party.
 */
async function fundParties(
    connection: Connection,
    payer: Keypair,
    parties: PublicKey[],
): Promise<[boolean, boolean]> {
    const requestedEach = PARTY_AIRDROP_SOL * LAMPORTS_PER_SOL;
    const payerBalance = await connection.getBalance(payer.publicKey, "confirmed");
    const spare = Math.max(
        0,
        payerBalance -
            Math.floor(PAYER_KEEP_SOL * LAMPORTS_PER_SOL) -
            FEE_BUFFER_LAMPORTS,
    );
    const shareEach = Math.floor(spare / parties.length);

    const funded: boolean[] = [];
    for (const party of parties) {
        const existing = await connection.getBalance(party, "confirmed");
        if (existing >= PARTY_MIN_LAMPORTS) {
            console.log(
                `  ${party.toBase58()} already holds ${formatSol(existing)} SOL`,
            );
            funded.push(true);
            continue;
        }
        if (await airdropWithRetry(connection, party, requestedEach)) {
            funded.push(true);
            continue;
        }
        funded.push(
            await transferFromPayer(connection, payer, party, requestedEach, shareEach),
        );
    }
    return [funded[0] ?? false, funded[1] ?? false];
}

/**
 * Set once fundDriver transfers SOL to the driver during this process run.
 * It feeds the cumulative guard below: after one top up, repeat calls only
 * transfer again when the wallet has dropped below DRIVER_TOPPED_LAMPORTS,
 * so repeated calls in one run cannot farm the payer. No state file: the
 * flag lives only for the lifetime of one script invocation, and each fresh
 * rerun still gets exactly one rescue transfer for a drained driver.
 */
let driverToppedUpThisRun = false;

/**
 * Keep the demo driver wallet funded: skip when it already qualifies
 * (idempotent on rerun), otherwise top up from the payer with
 * transferFromPayer. That helper refuses transfers below its 0.25 SOL dust
 * floor, so the request is that floor rather than the exact shortfall; any
 * success therefore lands above the minimum. The skip threshold is
 * DRIVER_MIN_LAMPORTS until this run has topped the driver up once, then
 * DRIVER_TOPPED_LAMPORTS: a balance still at or above 0.1 SOL after a top up
 * means no further transfer, while anything lower is a drain that gets
 * rescued as before. Returns false when the payer could not spare enough,
 * letting main() warn like it does for the parties.
 */
async function fundDriver(
    connection: Connection,
    payer: Keypair,
    driver: PublicKey,
): Promise<boolean> {
    const existing = await connection.getBalance(driver, "confirmed");
    const skipThreshold = driverToppedUpThisRun
        ? DRIVER_TOPPED_LAMPORTS
        : DRIVER_MIN_LAMPORTS;
    if (existing >= skipThreshold) {
        console.log(
            `  demo driver ${driver.toBase58()} already holds ${formatSol(existing)} SOL`,
        );
        return true;
    }
    const payerBalance = await connection.getBalance(payer.publicKey, "confirmed");
    const spare = Math.max(
        0,
        payerBalance -
            Math.floor(PAYER_KEEP_SOL * LAMPORTS_PER_SOL) -
            FEE_BUFFER_LAMPORTS,
    );
    const requested = Math.floor(MIN_AIRDROP_SOL * LAMPORTS_PER_SOL);
    const funded = await transferFromPayer(connection, payer, driver, requested, spare);
    if (funded) {
        driverToppedUpThisRun = true;
        const balance = await connection.getBalance(driver, "confirmed");
        console.log(
            `  demo driver ${driver.toBase58()} now holds ${formatSol(balance)} SOL`,
        );
    }
    return funded;
}

async function resolveMint(
    connection: Connection,
    payer: Keypair,
    authority: Keypair,
    previous: PublicKey | null,
    decimals: number,
    label: string,
): Promise<PublicKey> {
    if (previous !== null) {
        try {
            const mint = await getMint(connection, previous, "confirmed");
            if (mint.decimals !== decimals) {
                throw new Error(
                    `expected ${decimals} decimals, found ${mint.decimals}`,
                );
            }
            console.log(`Reusing ${label} mint ${previous.toBase58()}`);
            return previous;
        } catch (error) {
            console.warn(
                `Previous ${label} mint ${previous.toBase58()} is unusable (${errorMessage(error)}), creating a new one`,
            );
        }
    }
    const mint = await createMint(
        connection,
        payer,
        authority.publicKey,
        null,
        decimals,
    );
    console.log(`Created ${label} mint ${mint.toBase58()} (${decimals} decimals)`);
    return mint;
}

/** Mint whatever is missing so the balance reaches the target cents. */
async function topUp(
    connection: Connection,
    payer: Keypair,
    authority: Keypair,
    mint: PublicKey,
    ata: PublicKey,
    targetCents: bigint,
    label: string,
): Promise<void> {
    const account = await getAccount(connection, ata, "confirmed");
    if (account.amount >= targetCents) {
        console.log(`  ${label} already at ${account.amount} cents, nothing to mint`);
        return;
    }
    const missing = targetCents - account.amount;
    await mintTo(connection, payer, mint, ata, authority, missing);
    console.log(`  ${label} topped up by ${missing} cents (now ${targetCents})`);
}

/**
 * Verify the RPC endpoint is Solana devnet before any transaction is sent.
 *
 * Fetches the cluster genesis hash and compares it against the pinned devnet
 * genesis hash. On mismatch the script aborts, because a non devnet endpoint
 * would spend the real solana CLI wallet and create real mints, violating the
 * devnet only convention. Emergency override: SOLANA_ALLOW_NON_DEVNET=1
 * bypasses the guard and prints a loud warning.
 */
async function assertDevnet(connection: Connection): Promise<void> {
    const genesisHash = await withTimeout(
        connection.getGenesisHash(),
        AIRDROP_CONFIRM_TIMEOUT_MS,
        "getGenesisHash",
    );
    if (genesisHash === DEVNET_GENESIS_HASH) {
        console.log(`Genesis hash ok (devnet): ${genesisHash}`);
        return;
    }
    if (process.env.SOLANA_ALLOW_NON_DEVNET === "1") {
        console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        console.warn("!!! SOLANA_ALLOW_NON_DEVNET=1: devnet genesis hash guard BYPASSED !!!");
        console.warn(`!!! ${RPC_URL} reports genesis hash ${genesisHash}`);
        console.warn(`!!! expected devnet ${DEVNET_GENESIS_HASH}`);
        console.warn("!!! This run may spend real funds on a non devnet cluster.");
        console.warn("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
        return;
    }
    throw new Error(
        `refusing to run: ${RPC_URL} reports genesis hash ${genesisHash}, expected devnet ${DEVNET_GENESIS_HASH}; ` +
            "set SOLANA_ALLOW_NON_DEVNET=1 to override (emergencies only) or point SOLANA_RPC_URL at devnet",
    );
}

/**
 * Write app/public/demo-accounts.json, the file the React UI fetches at
 * startup to get the three demo keypairs (party A, party B, and the driver)
 * and the mint addresses without a wallet adapter.
 *
 * The file holds secrets (devnet play money only), so it is created with mode
 * 600, chmodded on every run, gitignored, and never logged beyond its path.
 * program_id is read from declare_id! so it always matches the app.
 */
export function writeDemoAccounts(
    keypairs: { party_a: Keypair; party_b: Keypair; driver: Keypair },
    usdMint: PublicKey,
    cadMint: PublicKey,
): void {
    const entry = (keypair: Keypair): DemoAccountEntry => ({
        secret: base58Encode(keypair.secretKey),
        pubkey: keypair.publicKey.toBase58(),
    });
    const demoAccounts: DemoAccountsFile = {
        version: 1,
        cluster: "devnet",
        program_id: readProgramId(),
        partyA: entry(keypairs.party_a),
        partyB: entry(keypairs.party_b),
        driver: entry(keypairs.driver),
        usd_mint: usdMint.toBase58(),
        cad_mint: cadMint.toBase58(),
        note: "devnet play money only; gitignored; regenerate with npx tsx scripts/setup-devnet.ts",
    };
    mkdirSync(dirname(DEMO_ACCOUNTS_FILE), { recursive: true });
    writeFileSync(DEMO_ACCOUNTS_FILE, `${JSON.stringify(demoAccounts, null, 2)}\n`, {
        mode: 0o600,
    });
    chmodSync(DEMO_ACCOUNTS_FILE, 0o600);
    console.log(`Wrote ${DEMO_ACCOUNTS_FILE}`);
}

async function main(): Promise<void> {
    const reset = process.argv.includes("--reset");
    if (reset) {
        for (const file of [ACCOUNTS_FILE, KEYPAIRS_FILE]) {
            if (existsSync(file)) {
                rmSync(file);
                console.log(`--reset removed ${file}`);
            }
        }
    }

    const keypairs = loadOrCreateKeypairs();
    const cliPayer = loadCliPayer();
    const payer = cliPayer ?? Keypair.generate();

    const connection = new Connection(RPC_URL, "confirmed");
    console.log(`RPC: ${RPC_URL}`);
    await assertDevnet(connection);
    console.log(
        `Payer: ${payer.publicKey.toBase58()}${cliPayer !== null ? " (solana CLI wallet)" : " (ephemeral)"}`,
    );
    console.log(`Mint authority: ${keypairs.authority.publicKey.toBase58()}`);
    console.log(`Party A: ${keypairs.party_a.publicKey.toBase58()}`);
    console.log(`Party B: ${keypairs.party_b.publicKey.toBase58()}`);

    const payerBalance = await connection.getBalance(
        payer.publicKey,
        "confirmed",
    );
    if (payerBalance < Math.floor(PAYER_MIN_SOL * LAMPORTS_PER_SOL)) {
        console.log(
            `Payer balance ${payerBalance} lamports is below ${PAYER_MIN_SOL} SOL, requesting airdrop`,
        );
        const funded = await airdropWithRetry(
            connection,
            payer.publicKey,
            2 * LAMPORTS_PER_SOL,
        );
        if (!funded) {
            throw new Error(
                `Could not fund payer ${payer.publicKey.toBase58()} (devnet faucet rate limit). Fund it manually or set SOLANA_RPC_URL to a faucet friendly RPC, then rerun.`,
            );
        }
    }

    console.log(
        "Funding party wallets (faucet first, payer transfer as fallback)",
    );
    const [partyAFunded, partyBFunded] = await fundParties(connection, payer, [
        keypairs.party_a.publicKey,
        keypairs.party_b.publicKey,
    ]);

    console.log("Funding demo driver wallet (payer transfer)");
    const driverFunded = await fundDriver(
        connection,
        payer,
        keypairs.driver.publicKey,
    );

    const previous = loadPreviousAccounts();
    const usdMint = await resolveMint(
        connection,
        payer,
        keypairs.authority,
        previous !== null ? new PublicKey(previous.mints.usd) : null,
        USD_DECIMALS,
        "USD",
    );
    const cadMint = await resolveMint(
        connection,
        payer,
        keypairs.authority,
        previous !== null ? new PublicKey(previous.mints.cad) : null,
        CAD_DECIMALS,
        "CAD",
    );

    console.log("Creating associated token accounts");
    const partyAUsd = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdMint,
        keypairs.party_a.publicKey,
    );
    const partyACad = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        cadMint,
        keypairs.party_a.publicKey,
    );
    const partyBUsd = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdMint,
        keypairs.party_b.publicKey,
    );
    const partyBCad = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        cadMint,
        keypairs.party_b.publicKey,
    );
    console.log(`  Party A USD ATA: ${partyAUsd.address.toBase58()}`);
    console.log(`  Party A CAD ATA: ${partyACad.address.toBase58()}`);
    console.log(`  Party B USD ATA: ${partyBUsd.address.toBase58()}`);
    console.log(`  Party B CAD ATA: ${partyBCad.address.toBase58()}`);

    console.log("Minting initial balances (integer cents, 2 decimals)");
    await topUp(
        connection,
        payer,
        keypairs.authority,
        usdMint,
        partyAUsd.address,
        INITIAL_BALANCES_CENTS.party_a.usd,
        "Party A USD",
    );
    await topUp(
        connection,
        payer,
        keypairs.authority,
        cadMint,
        partyACad.address,
        INITIAL_BALANCES_CENTS.party_a.cad,
        "Party A CAD",
    );
    await topUp(
        connection,
        payer,
        keypairs.authority,
        usdMint,
        partyBUsd.address,
        INITIAL_BALANCES_CENTS.party_b.usd,
        "Party B USD",
    );
    await topUp(
        connection,
        payer,
        keypairs.authority,
        cadMint,
        partyBCad.address,
        INITIAL_BALANCES_CENTS.party_b.cad,
        "Party B CAD",
    );

    const accounts: DevnetAccounts = {
        cluster: "devnet",
        rpc_url: RPC_URL,
        created_at: new Date().toISOString(),
        note: "Devnet play money only. Pubkeys for the Settlement Race demo. Secrets live in devnet-keypairs.json (gitignored).",
        decimals: { usd: USD_DECIMALS, cad: CAD_DECIMALS },
        mints: { usd: usdMint.toBase58(), cad: cadMint.toBase58() },
        authority: keypairs.authority.publicKey.toBase58(),
        payer: payer.publicKey.toBase58(),
        parties: {
            party_a: {
                pubkey: keypairs.party_a.publicKey.toBase58(),
                token_accounts: {
                    usd: partyAUsd.address.toBase58(),
                    cad: partyACad.address.toBase58(),
                },
            },
            party_b: {
                pubkey: keypairs.party_b.publicKey.toBase58(),
                token_accounts: {
                    usd: partyBUsd.address.toBase58(),
                    cad: partyBCad.address.toBase58(),
                },
            },
        },
        initial_balances_cents: {
            party_a: {
                usd: INITIAL_BALANCES_CENTS.party_a.usd.toString(),
                cad: INITIAL_BALANCES_CENTS.party_a.cad.toString(),
            },
            party_b: {
                usd: INITIAL_BALANCES_CENTS.party_b.usd.toString(),
                cad: INITIAL_BALANCES_CENTS.party_b.cad.toString(),
            },
        },
        sol_funded: { party_a: partyAFunded, party_b: partyBFunded },
    };
    writeFileSync(ACCOUNTS_FILE, `${JSON.stringify(accounts, null, 2)}\n`);
    console.log(`Wrote ${ACCOUNTS_FILE}`);

    writeDemoAccounts(keypairs, usdMint, cadMint);

    if (!partyAFunded || !partyBFunded || !driverFunded) {
        process.exitCode = 1;
        console.error(
            "Warning: at least one party or the demo driver wallet has no SOL. Token accounts and balances are ready, but on chain instructions signed by that wallet will fail until it receives SOL. Rerun this script later or fund the wallet manually.",
        );
    } else {
        console.log("Devnet setup complete.");
    }
}

main().catch((error) => {
    console.error(`setup-devnet failed: ${errorMessage(error)}`);
    process.exitCode = 1;
});
