/**
 * Provenance records and the off-chain hash chain.
 *
 * Every state transition in a race appends a ProvenanceRecord. Records form a
 * SHA-256 hash chain: each record commits to the previous record's hash, and
 * the genesis head is 64 zeros. The on-chain ChainHead account anchors the
 * chain head so an observer can prove the off-chain history was not rewritten
 * after the fact (anchoring itself lands in Phase 3).
 */

import { sha256 } from "js-sha256";
import { canonicalJson } from "./ticket";

/** Event kinds recorded in the provenance chain. */
export type EventType =
    | "TICKET_CREATED"
    | "ACK_A"
    | "ACK_B"
    | "LEG_FUNDED"
    | "RACE_STARTED"
    | "LEG1_RELEASED"
    | "LEG2_RELEASED"
    | "LEG2_PARTIAL"
    | "DEFAULT_DECLARED"
    | "ATOMIC_SETTLED"
    | "ATOMIC_REVERTED"
    | "FAILED_MARKED"
    | "CLOCK_ADVANCED"
    | "CHAIN_ANCHORED";

/** Who caused an event. */
export type ProvenanceActor = "PARTY_A" | "PARTY_B" | "ENGINE" | "DRIVER";

/** A single provenance record, schema version 1. */
export interface ProvenanceRecord {
    schema_version: 1;
    /** Zero based position in the chain. */
    seq: number;
    scenario_id: string;
    event: EventType;
    actor: ProvenanceActor;
    /** Virtual clock time as a decimal string (bigint semantics, no floats). */
    virtual_ts_ms: string;
    /** Real wall clock time in ISO 8601, or null for simulated events. */
    real_ts_iso: string | null;
    /** Event specific payload, scalar values only. */
    data: Record<string, string | number | boolean>;
    /** Solana transaction signature that caused the event, when on chain. */
    tx_sig: string | null;
    /** Hash of the previous record, or GENESIS_HASH for seq 0. */
    prev_hash: string;
    /** SHA-256 of this record's canonical JSON with hash omitted. */
    hash: string;
}

/** Caller supplied fields for append; prev_hash and hash are derived. */
export type ProvenanceInput = Omit<ProvenanceRecord, "prev_hash" | "hash">;

/** Head of an empty chain: 64 zeros, hex encoded. */
export const GENESIS_HASH: string = "0".repeat(64);

/** SHA-256 hex of the record's canonical JSON with the hash field removed. */
export function recordHash(record: ProvenanceRecord): string {
    const withoutHash: Record<string, unknown> = { ...record };
    delete withoutHash.hash;
    return sha256(canonicalJson(withoutHash));
}

/** Result of verifying a standalone record sequence. */
export interface VerifyResult {
    /** True when every link checks out. */
    valid: boolean;
    /** Index of the first inconsistent record, or null when valid. */
    broken_at: number | null;
}

/**
 * Verify an arbitrary sequence of provenance records without owning a chain,
 * for example records pasted from an export or loaded from a fixture. Every
 * record must continue the sequence: seq equals its index, prev_hash equals
 * the previous record's hash (GENESIS_HASH at index 0), and hash equals the
 * recomputed content hash.
 */
export function verifyRecords(records: ProvenanceRecord[]): VerifyResult {
    let previous = GENESIS_HASH;
    for (let i = 0; i < records.length; i++) {
        const record = records[i]!;
        if (record.seq !== i) {
            return { valid: false, broken_at: i };
        }
        if (record.prev_hash !== previous) {
            return { valid: false, broken_at: i };
        }
        if (recordHash(record) !== record.hash) {
            return { valid: false, broken_at: i };
        }
        previous = record.hash;
    }
    return { valid: true, broken_at: null };
}

/**
 * Append only provenance chain with full verification.
 *
 * append computes prev_hash from the current head and hash from the record
 * content, so callers cannot forge links without recomputing downstream
 * hashes. verify recomputes every link and reports the first inconsistency.
 */
export class ProvenanceChain {
    private readonly items: ProvenanceRecord[] = [];

    /** Number of records appended so far. */
    get length(): number {
        return this.items.length;
    }

    /** Read only view of the records in chain order. */
    get records(): readonly ProvenanceRecord[] {
        return this.items;
    }

    /** Hash of the newest record, or GENESIS_HASH when empty. */
    get head(): string {
        const last = this.items[this.items.length - 1];
        return last === undefined ? GENESIS_HASH : last.hash;
    }

    /**
     * Append a record, deriving prev_hash from the head and hash from the
     * content. The caller must supply seq equal to the current length.
     *
     * @throws Error when seq does not continue the chain.
     */
    append(input: ProvenanceInput): ProvenanceRecord {
        const expectedSeq = this.items.length;
        if (input.seq !== expectedSeq) {
            throw new Error(
                `ProvenanceChain.append: expected seq ${expectedSeq}, got ${input.seq}`,
            );
        }
        const record: ProvenanceRecord = {
            ...input,
            prev_hash: this.head,
            hash: "",
        };
        record.hash = recordHash(record);
        this.items.push(record);
        return record;
    }

    /**
     * Recompute every link: seq must equal the index, prev_hash must equal
     * the previous record's hash (GENESIS_HASH at index 0), and each hash
     * must equal the recomputed content hash.
     */
    verify(): boolean {
        return verifyRecords(this.items).valid;
    }
}
