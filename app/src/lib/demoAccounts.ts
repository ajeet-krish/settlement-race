/**
 * Demo account loading for the Settlement Race UI.
 *
 * scripts/setup-devnet.ts writes app/public/demo-accounts.json (gitignored,
 * devnet play money only) with the three demo keypairs the race needs without
 * a wallet adapter: party A, party B, and the driver, plus the USD and CAD
 * mint addresses. fetchDemoAccounts loads and validates that file once at
 * startup; parseDemoAccounts validates an already parsed object.
 *
 * Validation checks shape and consistency: schema version, cluster, program
 * id against pda.ts PROGRAM_ID, three keypairs whose secrets are 64 bytes
 * (base58 string or number array) and whose declared pubkeys are the keys
 * those secrets actually derive, and the two mint addresses. Every failure
 * throws a typed DemoAccountsError whose message names the field that failed
 * and never contains secret material.
 *
 * `bs58` is not a direct dependency of this app (only transitive through
 * `@solana/web3.js`, see the note in evidence.ts), so base58 encode and decode
 * are implemented here with bigint math instead of an undeclared import.
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./pda";

/** One demo signing key: 64 byte secret key and its public key, both base58. */
export interface DemoAccountEntry {
    /** Base58 encoded 64 byte secret key. Rebuild the Keypair with demoKeypair. */
    secret: string;
    /** Base58 public key matching the secret. */
    pubkey: string;
}

/** Validated contents of app/public/demo-accounts.json. */
export interface DemoAccounts {
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

/** Machine readable reason a DemoAccountsError was thrown. */
export type DemoAccountsErrorCode =
    | "fetch_failed"
    | "missing"
    | "bad_json"
    | "bad_version"
    | "bad_cluster"
    | "bad_program_id"
    | "bad_keypair"
    | "bad_secret"
    | "bad_pubkey"
    | "bad_mint";

/** Guidance shown when the file was never generated (surfaced by the UI). */
export const DEMO_ACCOUNTS_MISSING_GUIDANCE =
    "Demo accounts not found. Run npx tsx scripts/setup-devnet.ts first.";

/** Typed failure from loading or validating demo accounts. */
export class DemoAccountsError extends Error {
    readonly code: DemoAccountsErrorCode;

    constructor(code: DemoAccountsErrorCode, message: string) {
        super(message);
        this.name = "DemoAccountsError";
        this.code = code;
    }
}

/** Length of an ed25519 secret key in bytes: 32 byte seed plus public key. */
const SECRET_LENGTH = 64;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Path of the demo accounts file relative to the app origin. */
const DEMO_ACCOUNTS_PATH = "/demo-accounts.json";

/**
 * Encode bytes as base58 (the Solana alphabet) with bigint math. Leading zero
 * bytes become leading "1" characters, matching the usual base58 rules.
 */
export function base58Encode(bytes: Uint8Array): string {
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
 * Decode a base58 string to bytes, or null when a character falls outside
 * the base58 alphabet. Leading "1" characters are zero bytes.
 */
export function base58Decode(text: string): Uint8Array | null {
    if (text.length === 0) {
        return null;
    }
    let value = 0n;
    for (const char of text) {
        const index = BASE58_ALPHABET.indexOf(char);
        if (index < 0) {
            return null;
        }
        value = value * 58n + BigInt(index);
    }
    const decoded: number[] = [];
    while (value > 0n) {
        decoded.unshift(Number(value & 0xffn));
        value >>= 8n;
    }
    let leadingZeros = 0;
    for (const char of text) {
        if (char !== "1") {
            break;
        }
        leadingZeros += 1;
    }
    while (leadingZeros > 0) {
        decoded.unshift(0);
        leadingZeros -= 1;
    }
    return Uint8Array.from(decoded);
}

/**
 * Rebuild the signing keypair for a validated demo account. The UI should
 * call this instead of decoding `secret` itself, so no module outside this
 * one needs base58 decoding or the undeclared `bs58` package.
 *
 * @throws DemoAccountsError when the secret is not a 64 byte base58 string.
 */
export function demoKeypair(account: DemoAccountEntry): Keypair {
    const secret = base58Decode(account.secret);
    if (secret === null || secret.length !== SECRET_LENGTH) {
        throw new DemoAccountsError(
            "bad_secret",
            "Demo account secret must decode to 64 bytes.",
        );
    }
    return Keypair.fromSecretKey(secret);
}

/**
 * Fetch and validate app/public/demo-accounts.json from the app origin (or
 * baseUrl when given, with or without a trailing slash).
 *
 * @throws DemoAccountsError: "missing" carries the exact setup guidance the
 * UI surfaces; every other code names the field or transport failure. No
 * message contains secret material.
 */
export async function fetchDemoAccounts(baseUrl = ""): Promise<DemoAccounts> {
    const base = baseUrl.replace(/\/+$/, "");
    let response: Response;
    try {
        response = await fetch(`${base}${DEMO_ACCOUNTS_PATH}`);
    } catch {
        throw new DemoAccountsError(
            "fetch_failed",
            "Demo accounts could not be fetched from the app server.",
        );
    }
    if (response.status === 404) {
        throw new DemoAccountsError("missing", DEMO_ACCOUNTS_MISSING_GUIDANCE);
    }
    if (!response.ok) {
        throw new DemoAccountsError(
            "fetch_failed",
            `Demo accounts request failed with HTTP ${response.status}.`,
        );
    }
    let raw: unknown;
    try {
        raw = await response.json();
    } catch {
        throw new DemoAccountsError(
            "bad_json",
            "demo-accounts.json is not valid JSON.",
        );
    }
    return parseDemoAccounts(raw);
}

/**
 * Validate and normalize a parsed demo accounts file into DemoAccounts.
 * Number array secrets are normalized to base58 so the result always has one
 * shape; unknown extra keys are tolerated.
 *
 * @throws DemoAccountsError naming the first field that fails, never with
 * secret content in the message.
 */
export function parseDemoAccounts(raw: unknown): DemoAccounts {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new DemoAccountsError(
            "bad_json",
            "demo-accounts.json must contain a JSON object.",
        );
    }
    const file = raw as Record<string, unknown>;
    if (file.version !== 1) {
        throw new DemoAccountsError(
            "bad_version",
            "demo-accounts.json version must be 1.",
        );
    }
    if (file.cluster !== "devnet") {
        throw new DemoAccountsError(
            "bad_cluster",
            "demo-accounts.json cluster must be devnet.",
        );
    }
    if (file.program_id !== PROGRAM_ID.toBase58()) {
        throw new DemoAccountsError(
            "bad_program_id",
            "demo-accounts.json program_id does not match this app's program id.",
        );
    }
    const usdMint = requireAddress(file.usd_mint, "usd_mint", "bad_mint");
    const cadMint = requireAddress(file.cad_mint, "cad_mint", "bad_mint");
    return {
        version: 1,
        cluster: "devnet",
        program_id: PROGRAM_ID.toBase58(),
        partyA: parseEntry(file.partyA, "partyA"),
        partyB: parseEntry(file.partyB, "partyB"),
        driver: parseEntry(file.driver, "driver"),
        usd_mint: usdMint,
        cad_mint: cadMint,
        note: typeof file.note === "string" ? file.note : "",
    };
}

function isByte(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 255
    );
}

/**
 * Accept a secret as a base58 string decoding to 64 bytes or an array of 64
 * byte values, and return it normalized to base58. Error messages describe
 * the requirement only and never echo the value.
 */
function normalizeSecret(value: unknown, label: string): string {
    if (typeof value === "string") {
        const bytes = base58Decode(value);
        if (bytes === null || bytes.length !== SECRET_LENGTH) {
            throw new DemoAccountsError(
                "bad_secret",
                `${label} secret must be a base58 string decoding to 64 bytes.`,
            );
        }
        return value;
    }
    if (Array.isArray(value)) {
        if (value.length !== SECRET_LENGTH || !value.every(isByte)) {
            throw new DemoAccountsError(
                "bad_secret",
                `${label} secret must be an array of 64 bytes (integers 0-255).`,
            );
        }
        return base58Encode(Uint8Array.from(value));
    }
    throw new DemoAccountsError(
        "bad_secret",
        `${label} secret must be a base58 string or a number array.`,
    );
}

/**
 * Validate one { secret, pubkey } entry of the demo accounts file. The
 * declared pubkey must be the public key the secret actually derives, so a
 * mismatched pair fails here instead of at signing time. Error messages may
 * name both public keys but never contain the secret.
 */
function parseEntry(value: unknown, label: string): DemoAccountEntry {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new DemoAccountsError(
            "bad_keypair",
            `${label} must be an object with secret and pubkey.`,
        );
    }
    const entry = value as Record<string, unknown>;
    const secret = normalizeSecret(entry.secret, label);
    const pubkey = requireAddress(entry.pubkey, `${label} pubkey`, "bad_pubkey");
    const derived = demoKeypair({ secret, pubkey }).publicKey.toBase58();
    if (derived !== pubkey) {
        throw new DemoAccountsError(
            "bad_pubkey",
            `${label} pubkey ${pubkey} does not match its secret: the secret derives ${derived}.`,
        );
    }
    return { secret, pubkey };
}

/**
 * Validate a base58 Solana address and return it in canonical form.
 * The error code distinguishes keypair pubkeys from mint addresses.
 */
function requireAddress(
    value: unknown,
    field: string,
    code: "bad_pubkey" | "bad_mint",
): string {
    if (typeof value !== "string") {
        throw new DemoAccountsError(code, `${field} must be a base58 address.`);
    }
    let key: PublicKey;
    try {
        key = new PublicKey(value);
    } catch {
        throw new DemoAccountsError(code, `${field} is not a valid address.`);
    }
    return key.toBase58();
}
