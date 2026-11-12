/**
 * Minimal RaceEvent factory for race view tests. Only the fields the pure
 * modules read are populated; provenance hashes are placeholders because
 * no test verifies chain links here.
 */

import type { RaceEvent } from "../../../engine/scenarioEngine";
import type { EventType, ProvenanceRecord } from "../../../lib/provenance";
import type { SettlementPathName } from "../../../lib/ticket";

/** Monotonic seq counter so React style keys would stay unique. */
let nextSeq = 0;

export interface MakeEventArgs {
    event: EventType;
    /** Virtual stamp in milliseconds. */
    ts: bigint;
    /** Lane the record touched; defaults to SEQUENTIAL. */
    lane?: SettlementPathName;
    /** Provenance data payload; lane is added automatically. */
    data?: Record<string, string | number | boolean>;
    /** Transaction signature, when the step had one. */
    tx_sig?: string;
    /** Lifecycle snapshot attached to final records. */
    status_snapshot?: { sequential: string; atomic: string };
    /** Human readable detail line. */
    note?: string;
}

/** Build one stream event for tests. */
export function makeEvent(args: MakeEventArgs): RaceEvent {
    const lane = args.lane ?? "SEQUENTIAL";
    const data = { ...args.data, lane };
    const provenance: ProvenanceRecord = {
        schema_version: 1,
        seq: nextSeq,
        scenario_id: "SR-TEST-0001",
        event: args.event,
        actor: "ENGINE",
        virtual_ts_ms: args.ts.toString(),
        real_ts_iso: null,
        data,
        tx_sig: args.tx_sig ?? null,
        prev_hash: "0".repeat(64),
        hash: "0".repeat(64),
    };
    const seq = nextSeq;
    nextSeq += 1;
    return {
        lane,
        event: args.event,
        virtual_ts_ms: args.ts,
        seq,
        provenance,
        tx_sig: args.tx_sig,
        note: args.note,
        status_snapshot: args.status_snapshot,
    };
}
