/**
 * Pure view derivations for the provenance tab.
 *
 * Chain rows are built from the run's accumulated events, so the race
 * tab stays the single source of truth and this module never holds
 * state of its own. Verify verdicts map verifyRecords output to display
 * copy, the tamper demo edits a deep copy and never the original, the
 * anchor summary reports exactly what the run's chain_ok verdict can
 * and cannot say without reading the anchor again, and the evidence
 * helpers pick signatures and aggregate fetched rows. No React, no
 * network, no clock: every function here is testable as data.
 */

import type { RaceEvent } from "../../engine/scenarioEngine";
import { verifyEvidence } from "../../lib/evidence";
import type {
    EvidenceFailureReason,
    EvidenceRecord,
    EvidenceVerification,
} from "../../lib/evidence";
import {
    GENESIS_HASH,
    recordHash,
    verifyRecords,
    type EventType,
    type ProvenanceActor,
    type ProvenanceRecord,
    type VerifyResult,
} from "../../lib/provenance";
import type { RaceMode } from "../../lib/raceSource";
import type { SettlementPathName } from "../../lib/ticket";
import { formatVirtualSeconds } from "../race/raceTiming";
import type { ChainStatus } from "../race/raceTypes";

/** Leading characters of a shortened hash. */
const SHORT_HEAD = 8;
/** Trailing characters of a shortened hash. */
const SHORT_TAIL = 4;
/** Signatures checked per evidence fetch, kept light on the RPC. */
export const EVIDENCE_SIG_CAP = 10;
/** Mirrors the batch cap fetchEvidence enforces before any network call. */
const FETCH_BATCH_CAP = 64;

/**
 * First eight characters, an ellipsis, then the last four, for example
 * "8f3a1c9d...b2e4". Values too short to shorten are returned whole, so
 * an empty string stays empty.
 */
export function shortHash(value: string): string {
    if (value.length <= SHORT_HEAD + SHORT_TAIL + 1) {
        return value;
    }
    return `${value.slice(0, SHORT_HEAD)}...${value.slice(-SHORT_TAIL)}`;
}

/**
 * Virtual stamp as seconds with millisecond precision, for example
 * "1234" becomes "1.234". A value that is not a plain non negative
 * integer string is returned unchanged instead of throwing: display
 * formatting must never crash on a record from an unexpected shape.
 * The formatting itself is the race clock's, so both tabs render the
 * same stamp the same way.
 */
export function formatVirtualTs(ms: string): string {
    if (!/^\d+$/.test(ms)) {
        return ms;
    }
    return formatVirtualSeconds(BigInt(ms));
}

/** One chain table row: the record fields the table columns show. */
export interface ChainRow {
    /** Zero based position in the chain. */
    seq: number;
    /** Lane the step touched, taken from the run event. */
    lane: SettlementPathName;
    /** Virtual clock stamp as a decimal string. */
    virtual_ts_ms: string;
    /** Provenance event kind. */
    event: EventType;
    /** Who caused the event. */
    actor: ProvenanceActor;
    /** Transaction signature, or null for off chain steps. */
    tx_sig: string | null;
    /** Hash of the previous record, full value. */
    prev_hash: string;
    /** Content hash of this record, full value. */
    hash: string;
    /** Event specific payload, shown in the expanded detail row. */
    data: Record<string, string | number | boolean>;
}

/**
 * Derive one table row per event, in stream order. The stream order is
 * the chain order: events are appended as the engine records them, so
 * rows come out with seq equal to their index, which is exactly the
 * invariant verifyRecords checks.
 */
export function chainRows(events: readonly RaceEvent[]): ChainRow[] {
    return events.map((event) => {
        const record = event.provenance;
        return {
            seq: record.seq,
            lane: event.lane,
            virtual_ts_ms: record.virtual_ts_ms,
            event: record.event,
            actor: record.actor,
            tx_sig: record.tx_sig,
            prev_hash: record.prev_hash,
            hash: record.hash,
            data: record.data,
        };
    });
}

/** The provenance records behind the events, in chain order. */
export function recordsFromEvents(
    events: readonly RaceEvent[],
): ProvenanceRecord[] {
    return events.map((event) => event.provenance);
}

/** Head of the chain: the newest record's hash, or genesis when empty. */
export function localHead(records: readonly ProvenanceRecord[]): string {
    const last = records[records.length - 1];
    return last === undefined ? GENESIS_HASH : last.hash;
}

/** Why a link failed, in the order verifyRecords checks the three. */
export type BreakReason = "seq" | "prev_hash" | "hash";

/**
 * Which check fails first at one index, mirroring verifyRecords order:
 * sequence position, previous link, then content hash. Null when the
 * record passes every check (or the index does not exist).
 */
export function breakReason(
    records: readonly ProvenanceRecord[],
    index: number,
): BreakReason | null {
    const record = records[index];
    if (record === undefined) {
        return null;
    }
    if (record.seq !== index) {
        return "seq";
    }
    const previous = index === 0 ? GENESIS_HASH : records[index - 1]?.hash;
    if (record.prev_hash !== previous) {
        return "prev_hash";
    }
    if (recordHash(record) !== record.hash) {
        return "hash";
    }
    return null;
}

/** Display copy for one break reason, sentence case, no jargon. */
const BREAK_REASON_COPY: Readonly<Record<BreakReason, string>> = {
    seq: "the sequence does not continue",
    prev_hash: "the previous link does not match",
    hash: "the content hash does not match the record",
};

/** Verdict slab content: the word, the line under it, and where it broke. */
export interface VerifyVerdict {
    label: "VALID" | "BROKEN";
    detail: string;
    /** First broken index, or null when the chain verifies. */
    broken_at: number | null;
    /** Which check failed first, or null when valid. */
    break_reason: BreakReason | null;
}

/**
 * Map a verifyRecords result to verdict display copy. A broken verdict
 * names the first failing seq and which of the three checks failed, so
 * the table can mark that row without re-deriving anything.
 */
export function verifyVerdict(
    result: VerifyResult,
    records: readonly ProvenanceRecord[],
): VerifyVerdict {
    if (result.valid) {
        const count = records.length;
        return {
            label: "VALID",
            detail:
                count === 0
                    ? "No records to verify"
                    : `${count} ${count === 1 ? "record" : "records"}, every hash link recomputes`,
            broken_at: null,
            break_reason: null,
        };
    }
    const brokenAt = result.broken_at ?? 0;
    const reason = breakReason(records, brokenAt);
    return {
        label: "BROKEN",
        detail: `First broken link at seq ${brokenAt}: ${
            reason === null ? "a link check failed" : BREAK_REASON_COPY[reason]
        }`,
        broken_at: brokenAt,
        break_reason: reason,
    };
}

/** One cell of the anchor comparison: known, unknown, or not checked. */
export type AnchorCell = "match" | "unknown" | "unchecked";

/** What the run's chain_ok verdict says about the anchored head. */
export interface AnchorSummary {
    status: ChainStatus;
    /** Short verdict word for the anchor line. */
    label: string;
    /** Whether the local head matched the anchored head. */
    head_match: AnchorCell;
    /** Whether the local record count matched the anchored count. */
    count_match: AnchorCell;
    /** Honest explanation of what the cells can and cannot say. */
    note: string;
}

/**
 * Summarize the anchor comparison from the run's verdict alone. The run
 * pipeline returns chain_ok as one boolean, so a disagreement cannot be
 * attributed to the head or the count without reading the anchor
 * again, and this summary says exactly that instead of guessing. A
 * valid run means all three checks passed: the rehash, the head, and
 * the count.
 */
export function summarizeAnchor(
    status: ChainStatus,
    local: VerifyResult | null,
): AnchorSummary {
    if (status === "VALID") {
        return {
            status,
            label: "Anchor agrees",
            head_match: "match",
            count_match: "match",
            note: "The run read the anchored chain head: the head and the event count both matched the local chain.",
        };
    }
    if (status === "BROKEN") {
        const consistent = local === null || local.valid;
        return {
            status,
            label: "Anchor disagrees",
            head_match: "unknown",
            count_match: "unknown",
            note: consistent
                ? "The run's anchor check failed: no anchor was readable, or the head or the count disagreed. This panel does not read the anchor again, so it cannot name which one."
                : "The run's anchor check failed and the local chain now fails its own rehash, so there is no consistent chain to compare against.",
        };
    }
    return {
        status,
        label: "Anchor not checked",
        head_match: "unchecked",
        count_match: "unchecked",
        note: "No anchor check has run yet. Finish a scenario to anchor the chain head.",
    };
}

/** A data field edit made by the tamper demo, on the copy only. */
export interface TamperEdit {
    /** Sequence position of the edited record. */
    seq: number;
    /** Data key that was edited. */
    key: string;
    /** Value before the edit, or null when the field was added. */
    before: string | number | boolean | null;
    /** Value after the edit. */
    after: string | number | boolean;
}

/** Result of the tamper demo: the edit and both verification runs. */
export interface TamperDemo {
    /** What the demo changed in the copy. */
    edit: TamperEdit;
    /** Verification of the edited copy: broken at the edited seq. */
    copy_result: VerifyResult;
    /** Verification of the untouched original at demo time. */
    original_result: VerifyResult;
}

/** One edit that always changes the record's content hash. */
function bumpValue(before: string | number | boolean): string | number | boolean {
    if (typeof before === "number") {
        return before + 1;
    }
    if (typeof before === "boolean") {
        return !before;
    }
    return `${before} (edited)`;
}

/**
 * Deep copy the chain, edit one data field in the copy, and verify both
 * sides. The original array and its records are never written to, so
 * the original verification stays valid and the copy breaks at the
 * edited record: hash chains turn a silent edit into visible tamper
 * evidence. Returns null for an empty chain, where there is nothing to
 * demonstrate against.
 */
export function simulateTamper(
    records: readonly ProvenanceRecord[],
): TamperDemo | null {
    if (records.length === 0) {
        return null;
    }
    const copy: ProvenanceRecord[] = records.map((record) => ({
        ...record,
        data: { ...record.data },
    }));
    const index = Math.floor(copy.length / 2);
    const target = copy[index];
    if (target === undefined) {
        return null;
    }
    const keys = Object.keys(target.data);
    let edit: TamperEdit;
    if (keys.length === 0) {
        target.data.tampered_demo = true;
        edit = { seq: target.seq, key: "tampered_demo", before: null, after: true };
    } else {
        const key = keys[0]!;
        const before = target.data[key]!;
        const after = bumpValue(before);
        target.data[key] = after;
        edit = { seq: target.seq, key, before, after };
    }
    return {
        edit,
        copy_result: verifyRecords(copy),
        original_result: verifyRecords(records.slice()),
    };
}

/** Where the evidence section stands before any fetch runs. */
export type EvidencePhase = "offline" | "empty" | "ready";

/**
 * Which evidence state the panel is in. Offline always wins: the mock
 * ledger signs nothing a cluster has ever seen, so there is no
 * on-chain evidence to fetch no matter what the records claim. Live
 * with no signatures (an empty or purely off chain chain) is the empty
 * state, and anything else is ready to fetch.
 */
export function evidencePhase(
    mode: RaceMode,
    records: readonly ProvenanceRecord[],
): EvidencePhase {
    if (mode === "offline") {
        return "offline";
    }
    if (distinctSigs(records).length === 0) {
        return "empty";
    }
    return "ready";
}

/** Distinct non null signatures in chain order, duplicates dropped. */
export function distinctSigs(
    records: readonly ProvenanceRecord[],
): string[] {
    const seen = new Set<string>();
    const sigs: string[] = [];
    for (const record of records) {
        const sig = record.tx_sig;
        if (sig === null || seen.has(sig)) {
            continue;
        }
        seen.add(sig);
        sigs.push(sig);
    }
    return sigs;
}

/**
 * The signatures one fetch call will read: the first `cap` distinct
 * signatures in chain order. The cap is clamped to the batch limit
 * fetchEvidence enforces, so a caller can never hand it a batch it
 * rejects, and the default stays small to keep RPC traffic light.
 */
export function selectEvidenceSigs(
    records: readonly ProvenanceRecord[],
    cap: number = EVIDENCE_SIG_CAP,
): string[] {
    const bounded = Math.min(FETCH_BATCH_CAP, Math.max(0, Math.floor(cap)));
    return distinctSigs(records).slice(0, bounded);
}

/** Counts for the evidence summary line. */
export interface EvidenceSummary {
    /** Rows returned by the fetch. */
    total: number;
    /** Rows whose transaction was found. */
    fetched: number;
    /** Rows whose transaction targets our program. */
    program_match: number;
    /** Rows whose transaction landed without an error. */
    succeeded: number;
    /** Rows with no transaction found. */
    unfetched: number;
}

/** Aggregate fetched rows into the counts the summary line shows. */
export function summarizeEvidence(
    rows: readonly EvidenceRecord[],
): EvidenceSummary {
    let fetched = 0;
    let programMatch = 0;
    let succeeded = 0;
    for (const row of rows) {
        if (row.fetched_ok) {
            fetched += 1;
        }
        if (row.program_id_match) {
            programMatch += 1;
        }
        if (row.success) {
            succeeded += 1;
        }
    }
    return {
        total: rows.length,
        fetched,
        program_match: programMatch,
        succeeded,
        unfetched: rows.length - fetched,
    };
}

/**
 * Run the library's verifyEvidence over just the records whose
 * signature appears in the fetched rows, so signatures outside a capped
 * fetch are not misreported as missing evidence.
 */
export function checkEvidence(
    records: readonly ProvenanceRecord[],
    rows: readonly EvidenceRecord[],
): EvidenceVerification {
    const present = new Set(rows.map((row) => row.tx_sig));
    const checked = records.filter(
        (record) => record.tx_sig !== null && present.has(record.tx_sig),
    );
    return verifyEvidence(checked, rows);
}

/** Sentence case copy for a failed evidence row. */
export function evidenceReasonLabel(
    reason: EvidenceFailureReason,
): string {
    switch (reason) {
        case "invalid_signature":
            return "invalid signature";
        case "not_found":
            return "not found on chain";
        case "retries_exhausted":
            return "RPC retries exhausted";
    }
}

/**
 * Phrase an unexpected evidence fetch failure the way the anchor client
 * phrases transport trouble: messages already carrying a typed prefix
 * keep it, everything else becomes a typed RpcError line. fetchEvidence
 * already degrades ordinary RPC trouble into rows, so this only fires
 * for a failure outside that contract.
 */
export function describeEvidenceFailure(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (/^(RpcError|AccountNotFound|InvalidInstructionData):/.test(message)) {
        return message;
    }
    return `RpcError: ${message}`;
}
