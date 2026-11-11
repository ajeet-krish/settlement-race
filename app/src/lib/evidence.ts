/**
 * Devnet transaction evidence for provenance records.
 *
 * Each provenance record that happened on chain carries a `tx_sig`. The
 * evidence panel fetches every signature from RPC and records what it found:
 * `fetched_ok` (the transaction exists), `program_id_match` (one of its
 * instructions targets our program), and `success` (the transaction landed
 * without an error). Together with the chain head anchor this turns record
 * claims into independently checkable evidence.
 *
 * Every signature is shape checked (base58 alphabet, encoded length
 * window) before any network call: malformed input degrades to
 * `fetched_ok: false` with `reason: "invalid_signature"` and costs zero
 * RPC round trips. Batches are capped and the retry budget is clamped, so
 * one call can never become an unbounded request storm.
 *
 * RPC rate limits (HTTP 429) and pruned history (HTTP 410) are retried a
 * bounded number of times before the record degrades to
 * `fetched_ok: false`, so a flaky endpoint never throws through the UI.
 *
 * All money and time values stay integers: block time is seconds, converted
 * to ISO 8601 only for display and storage.
 */

import type { Connection, Finality } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./pda";
import type { ProvenanceInput, ProvenanceRecord } from "./provenance";

/** Default extra attempts after the first for retryable RPC errors. */
const DEFAULT_RETRIES = 2;
/** Hard cap on extra attempts: `Infinity` and larger budgets clamp here. */
const MAX_RETRIES = 5;
/** Largest signature batch accepted by one `fetchEvidence` call. */
const MAX_SIGS_PER_BATCH = 64;
/** Lower bound of the base58 length window for an encoded signature. */
const SIG_MIN_LENGTH = 32;
/** Upper bound of the base58 length window for an encoded signature. */
const SIG_MAX_LENGTH = 88;
/** Base58 alphabet: no 0, O, I, or l. */
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Why an evidence row failed. Only present when `fetched_ok` is false:
 * `invalid_signature` means the input was rejected before any RPC call,
 * `not_found` means the cluster answered that the transaction does not
 * exist, and `retries_exhausted` means only retryable failures (429, 410)
 * were seen until the budget ran out.
 */
export type EvidenceFailureReason =
    | "invalid_signature"
    | "not_found"
    | "retries_exhausted";

/** One fetched evidence row per transaction signature. */
export interface EvidenceRecord {
    tx_sig: string;
    /** Block time as ISO 8601, empty when the transaction was not fetched. */
    real_ts_iso: string;
    /** True when the transaction was found on chain (after any retries). */
    fetched_ok: boolean;
    /**
     * True when an instruction of the transaction targets the Settlement
     * Race program (best effort: compiled `programIdIndex` entries resolve
     * against static keys plus loaded addresses).
     */
    program_id_match: boolean;
    /** True when the transaction was fetched and its `meta.err` is null. */
    success: boolean;
    /** Present only on failed rows; see `EvidenceFailureReason`. */
    reason?: EvidenceFailureReason;
}

export interface FetchEvidenceOptions {
    /** Program id to match against; defaults to PROGRAM_ID. */
    programId?: PublicKey;
    /**
     * Extra attempts after the first for retryable RPC errors. Clamped to
     * 0 through 5: `Infinity` and larger budgets become 5, negative
     * budgets become 0, and non numeric input falls back to the default.
     */
    retries?: number;
    /** Base delay between attempts in milliseconds (grows linearly). */
    retryDelayMs?: number;
}

/** Result of verifyEvidence: which record signatures lack good evidence. */
export interface EvidenceVerification {
    valid: boolean;
    /** Signatures that have no evidence row with `fetched_ok: true`. */
    missing_sigs: string[];
}

/** Options accepted by both web3 transaction fetches used here. */
interface TxFetchConfig {
    commitment?: Finality;
    maxSupportedTransactionVersion?: number;
}

/** Account keys loaded from address lookup tables, strings or pubkeys. */
interface LoadedKeyLists {
    writable: readonly (string | PublicKey)[];
    readonly: readonly (string | PublicKey)[];
}

/**
 * Stamp provenance records with transaction signatures by index alignment.
 *
 * `sigs[i]` is written into `records[i].tx_sig` when the record carries no
 * signature yet and the signature is non-null; an existing `tx_sig` is never
 * overwritten. Records are hash chained, so this must run before
 * `ProvenanceChain.append` (tx_sig is inside the record hash). Returns new
 * record objects; inputs are not mutated.
 */
export function attachEvidence(
    records: readonly ProvenanceInput[],
    sigs: readonly (string | null)[],
): ProvenanceInput[] {
    return records.map((record, index) => {
        if (record.tx_sig !== null || sigs[index] == null) {
            return { ...record };
        }
        return { ...record, tx_sig: sigs[index] ?? null };
    });
}

/**
 * Fetch evidence for every signature, in order, one RPC round trip per
 * signature with retries on rate limit (429) and pruned history (410).
 *
 * Never rejects for RPC trouble: an unfetchable signature degrades to
 * `fetched_ok: false` with empty timestamps. It does reject a malformed
 * batch (more than {@link MAX_SIGS_PER_BATCH} signatures) before any
 * network call, so an oversized request never reaches the cluster.
 *
 * Each signature is shape checked first; a malformed one produces a row
 * with `reason: "invalid_signature"` and no RPC call at all.
 */
export async function fetchEvidence(
    connection: Connection,
    sigs: readonly string[],
    options: FetchEvidenceOptions = {},
): Promise<EvidenceRecord[]> {
    if (sigs.length > MAX_SIGS_PER_BATCH) {
        throw new RangeError(
            `fetchEvidence: at most ${MAX_SIGS_PER_BATCH} signatures per call, got ${sigs.length}`,
        );
    }
    const programId = options.programId ?? PROGRAM_ID;
    const retries = clampRetries(options.retries);
    const retryDelayMs = options.retryDelayMs ?? 250;
    const rows: EvidenceRecord[] = [];
    for (const sig of sigs) {
        rows.push(await fetchOne(connection, sig, programId, retries, retryDelayMs));
    }
    return rows;
}

/**
 * Check that every provenance record with a signature has fetched evidence.
 * Records with `tx_sig: null` (purely off chain events) are skipped.
 */
export function verifyEvidence(
    records: readonly (ProvenanceRecord | ProvenanceInput)[],
    evidence: readonly EvidenceRecord[],
): EvidenceVerification {
    const bySig = new Map(evidence.map((row) => [row.tx_sig, row]));
    const missing_sigs: string[] = [];
    for (const record of records) {
        if (record.tx_sig === null) {
            continue;
        }
        const row = bySig.get(record.tx_sig);
        if (row === undefined || !row.fetched_ok) {
            missing_sigs.push(record.tx_sig);
        }
    }
    return { valid: missing_sigs.length === 0, missing_sigs };
}

/** Normalized view of a fetched transaction, whichever fetch produced it. */
interface FetchedTx {
    programIds: string[];
    err: unknown;
    blockTime: number | null | undefined;
}

/** Result of one retryable-or-not fetch attempt. */
type AttemptOutcome =
    | { kind: "found"; tx: FetchedTx }
    | { kind: "not_found" }
    | { kind: "retryable" };

async function fetchOne(
    connection: Connection,
    sig: string,
    programId: PublicKey,
    retries: number,
    retryDelayMs: number,
): Promise<EvidenceRecord> {
    const unfetched = (reason: EvidenceFailureReason): EvidenceRecord => ({
        tx_sig: sig,
        real_ts_iso: "",
        fetched_ok: false,
        program_id_match: false,
        success: false,
        reason,
    });
    // Shape check first: malformed input never reaches the RPC endpoint.
    if (!isValidSignature(sig)) {
        return unfetched("invalid_signature");
    }
    for (let attempt = 0; ; attempt++) {
        const outcome = await attemptFetch(connection, sig);
        if (outcome.kind === "found") {
            return evaluate(outcome.tx, sig, programId);
        }
        if (outcome.kind === "not_found") {
            return unfetched("not_found");
        }
        if (attempt >= retries) {
            return unfetched("retries_exhausted");
        }
        await sleep(retryDelayMs * (attempt + 1));
    }
}

/**
 * Shape check for a transaction signature before any network call: base58
 * alphabet only (no 0, O, I, or l) and inside the length window of an
 * encoded signature.
 *
 * `bs58` is not a direct dependency of this app (only a transitive one
 * through `@solana/web3.js`), so the check is a regex plus length bounds
 * rather than a full decode. The bounds are wide enough to accept every
 * well formed signature and narrow enough to stop malformed input, and the
 * payload is never interpreted locally, so decoding would add nothing but
 * an undeclared dependency here.
 */
function isValidSignature(sig: string): boolean {
    return (
        sig.length >= SIG_MIN_LENGTH &&
        sig.length <= SIG_MAX_LENGTH &&
        BASE58_PATTERN.test(sig)
    );
}

/**
 * Clamp the retry budget to 0 through {@link MAX_RETRIES}. `Infinity`
 * (and anything above the cap) becomes the cap, negative budgets become
 * 0, and NaN falls back to the default so the attempt loop can never
 * compare against NaN and spin forever.
 */
function clampRetries(retries: number | undefined): number {
    if (retries === undefined) {
        return DEFAULT_RETRIES;
    }
    if (Number.isNaN(retries)) {
        return DEFAULT_RETRIES;
    }
    if (retries === Number.POSITIVE_INFINITY) {
        return MAX_RETRIES;
    }
    if (retries === Number.NEGATIVE_INFINITY) {
        return 0;
    }
    return Math.min(MAX_RETRIES, Math.max(0, Math.floor(retries)));
}

/**
 * One fetch pass: parsed first (instructions carry `programId` directly),
 * raw json as the fallback for encodings the parsed path rejects.
 * Retryable RPC failures are reported as such for the caller's loop.
 */
async function attemptFetch(connection: Connection, sig: string): Promise<AttemptOutcome> {
    const config: TxFetchConfig = {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
    };
    try {
        const parsed = await connection.getParsedTransaction(sig, config);
        if (parsed === null) {
            return { kind: "not_found" };
        }
        return {
            kind: "found",
            tx: normalize(
                parsed.transaction.message,
                parsed.meta?.err ?? null,
                parsed.blockTime,
                parsed.meta?.loadedAddresses ?? null,
            ),
        };
    } catch (err) {
        if (isRetryableRpcError(err)) {
            return { kind: "retryable" };
        }
    }
    try {
        const raw = await connection.getTransaction(sig, config);
        if (raw === null) {
            return { kind: "not_found" };
        }
        return {
            kind: "found",
            tx: normalize(
                raw.transaction.message,
                raw.meta?.err ?? null,
                raw.blockTime,
                raw.meta?.loadedAddresses ?? null,
            ),
        };
    } catch (err) {
        if (isRetryableRpcError(err)) {
            return { kind: "retryable" };
        }
        return { kind: "not_found" };
    }
}

/**
 * Project either message shape onto the evidence view.
 *
 * Parsed messages expose `instructions[].programId` and object account keys;
 * compiled json messages expose `programIdIndex` into static account keys
 * plus (for v0 transactions) `meta.loadedAddresses`.
 */
function normalize(
    message: unknown,
    err: unknown,
    blockTime: number | null | undefined,
    loadedAddresses: LoadedKeyLists | null,
): FetchedTx {
    const m = message as {
        instructions?: unknown;
        compiledInstructions?: unknown;
        accountKeys?: unknown;
        staticAccountKeys?: unknown;
    };
    const instructions = Array.isArray(m.instructions)
        ? m.instructions
        : Array.isArray(m.compiledInstructions)
          ? m.compiledInstructions
          : [];
    const staticKeys = Array.isArray(m.accountKeys)
        ? m.accountKeys
        : Array.isArray(m.staticAccountKeys)
          ? m.staticAccountKeys
          : [];
    const lookupKeys: unknown[] = loadedAddresses
        ? [...loadedAddresses.writable, ...loadedAddresses.readonly]
        : [];
    const keys = [...staticKeys, ...lookupKeys];
    const programIds: string[] = [];
    for (const raw of instructions) {
        if (typeof raw !== "object" || raw === null) {
            continue;
        }
        const ix = raw as { programId?: unknown; programIdIndex?: unknown };
        if (ix.programId !== undefined && ix.programId !== null) {
            programIds.push(String(ix.programId));
        } else if (typeof ix.programIdIndex === "number") {
            const key = keyToString(keys[ix.programIdIndex]);
            if (key !== null) {
                programIds.push(key);
            }
        }
    }
    return { programIds, err, blockTime };
}

/** Render one account key (string, PublicKey, or parsed account) as base58. */
function keyToString(key: unknown): string | null {
    if (typeof key === "string") {
        return key;
    }
    if (key instanceof PublicKey) {
        return key.toBase58();
    }
    if (typeof key === "object" && key !== null && "pubkey" in key) {
        return keyToString((key as { pubkey: unknown }).pubkey);
    }
    return null;
}

/** Build the evidence row for a successfully fetched transaction. */
function evaluate(tx: FetchedTx, sig: string, programId: PublicKey): EvidenceRecord {
    const target = programId.toBase58();
    return {
        tx_sig: sig,
        real_ts_iso:
            typeof tx.blockTime === "number"
                ? new Date(tx.blockTime * 1000).toISOString()
                : "",
        fetched_ok: true,
        program_id_match: tx.programIds.includes(target),
        success: tx.err === null,
    };
}

/** True for throttled (429) or pruned (410) RPC responses worth retrying. */
function isRetryableRpcError(err: unknown): boolean {
    const parts: string[] = [];
    if (err instanceof Error) {
        parts.push(err.message);
    }
    if (typeof err === "object" && err !== null) {
        const e = err as { status?: unknown; code?: unknown; cause?: unknown };
        if (typeof e.status === "number") {
            parts.push(String(e.status));
        }
        if (typeof e.code === "number") {
            parts.push(String(e.code));
        }
        if (e.cause instanceof Error) {
            parts.push(e.cause.message);
        }
    }
    const text = parts.join(" ");
    return (
        /\b429\b/.test(text) ||
        /\b410\b/.test(text) ||
        /too many requests/i.test(text) ||
        /rate limit/i.test(text)
    );
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
