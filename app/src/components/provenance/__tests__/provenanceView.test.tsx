import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { RaceEvent } from "../../../engine/scenarioEngine";
import type { EvidenceRecord } from "../../../lib/evidence";
import {
    GENESIS_HASH,
    ProvenanceChain,
    verifyRecords,
    type ProvenanceInput,
} from "../../../lib/provenance";
import ProvenancePanel from "../../ProvenancePanel";
import {
    breakReason,
    chainRows,
    checkEvidence,
    describeEvidenceFailure,
    distinctSigs,
    evidencePhase,
    evidenceReasonLabel,
    formatVirtualTs,
    localHead,
    recordsFromEvents,
    selectEvidenceSigs,
    shortHash,
    simulateTamper,
    summarizeAnchor,
    summarizeEvidence,
    verifyVerdict,
} from "../provenanceView";

/**
 * Pure logic for the provenance tab. The fixtures build a real hash
 * chained ProvenanceChain (so tamper and verify runs recompute genuine
 * hashes) and project it into RaceEvents the way the engine does. No
 * DOM library: the only mount checks render static markup through
 * react-dom/server, which is already a dependency.
 */

const SIG_A = "4kTqWm9dR2vXnLpJsYbGcHfA5uEzQrNtM6xBw1iVoKjPdCs";
const SIG_B = "3nVsJp8xLqFdRtWmYkB2hGcZa5uE7oQnMxT1wViArUjPdFb";

function fixtureInputs(): ProvenanceInput[] {
    return [
        {
            schema_version: 1,
            seq: 0,
            scenario_id: "SR-TEST-0001",
            event: "TICKET_CREATED",
            actor: "ENGINE",
            virtual_ts_ms: "0",
            real_ts_iso: null,
            data: { lane: "SEQUENTIAL" },
            tx_sig: null,
        },
        {
            schema_version: 1,
            seq: 1,
            scenario_id: "SR-TEST-0001",
            event: "ACK_A",
            actor: "PARTY_A",
            virtual_ts_ms: "1000",
            real_ts_iso: null,
            data: { desk_id: "DESK-A", lane: "SEQUENTIAL" },
            tx_sig: SIG_A,
        },
        {
            schema_version: 1,
            seq: 2,
            scenario_id: "SR-TEST-0001",
            event: "LEG_FUNDED",
            actor: "PARTY_B",
            virtual_ts_ms: "1500",
            real_ts_iso: null,
            data: { amount_cents: 1350000, lane: "ATOMIC" },
            tx_sig: SIG_B,
        },
        {
            schema_version: 1,
            seq: 3,
            scenario_id: "SR-TEST-0001",
            event: "ATOMIC_SETTLED",
            actor: "ENGINE",
            virtual_ts_ms: "2000",
            real_ts_iso: null,
            data: { lane: "ATOMIC" },
            // Reuses the first signature so dedupe has something to drop.
            tx_sig: SIG_A,
        },
    ];
}

function fixtureEvents(): RaceEvent[] {
    const chain = new ProvenanceChain();
    for (const input of fixtureInputs()) {
        chain.append(input);
    }
    return chain.records.map((record) => ({
        lane: record.data.lane === "ATOMIC" ? "ATOMIC" : "SEQUENTIAL",
        event: record.event,
        virtual_ts_ms: BigInt(record.virtual_ts_ms),
        seq: record.seq,
        provenance: record,
        tx_sig: record.tx_sig ?? undefined,
    }));
}

/** Freeze an array, its records, and their payloads, deeply. */
function deepFreeze(value: object): void {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
        const child = (value as Record<string, unknown>)[key];
        if (
            child !== null &&
            typeof child === "object" &&
            !Object.isFrozen(child)
        ) {
            deepFreeze(child);
        }
    }
}

describe("chain row derivation", () => {
    it("maps events to rows in chain order with the record fields", () => {
        const events = fixtureEvents();
        const rows = chainRows(events);
        const records = recordsFromEvents(events);

        expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3]);
        rows.forEach((row, index) => {
            const record = records[index]!;
            expect(row.seq).toBe(record.seq);
            expect(row.hash).toBe(record.hash);
            expect(row.prev_hash).toBe(record.prev_hash);
            expect(row.tx_sig).toBe(record.tx_sig);
            expect(row.data).toEqual(record.data);
            expect(row.virtual_ts_ms).toBe(record.virtual_ts_ms);
        });
        expect(rows[0]!.event).toBe("TICKET_CREATED");
        expect(rows[2]!.lane).toBe("ATOMIC");
        expect(rows[2]!.actor).toBe("PARTY_B");
    });

    it("shortens hashes to eight leading and four trailing characters", () => {
        expect(shortHash(GENESIS_HASH)).toBe("00000000...0000");
        const value = `12345678${"x".repeat(48)}9012`;
        expect(shortHash(value)).toBe("12345678...9012");
        // Too short to shorten: returned whole, including empty.
        expect(shortHash("abc")).toBe("abc");
        expect(shortHash("")).toBe("");
    });

    it("formats virtual stamps as seconds and passes odd values through", () => {
        expect(formatVirtualTs("1234")).toBe("1.234");
        expect(formatVirtualTs("0")).toBe("0.000");
        expect(formatVirtualTs("not a number")).toBe("not a number");
    });

    it("reports the newest record hash as the local head", () => {
        const records = recordsFromEvents(fixtureEvents());
        expect(localHead(records)).toBe(records[records.length - 1]!.hash);
        expect(localHead([])).toBe(GENESIS_HASH);
    });
});

describe("verify verdict mapping", () => {
    it("maps a valid result to VALID with the record count", () => {
        const records = recordsFromEvents(fixtureEvents());
        const verdict = verifyVerdict(verifyRecords(records), records);

        expect(verdict.label).toBe("VALID");
        expect(verdict.broken_at).toBeNull();
        expect(verdict.break_reason).toBeNull();
        expect(verdict.detail).toContain("4 records");
        expect(verdict.detail).toContain("every hash link recomputes");
    });

    it("maps a broken result to BROKEN naming the first bad seq and reason", () => {
        const records = recordsFromEvents(fixtureEvents());
        // Edit record 2's payload without relinking: the content hash
        // fails first, which is what a tampered field looks like.
        records[2]!.data.tampered = true;
        const result = verifyRecords(records);
        expect(result).toEqual({ valid: false, broken_at: 2 });

        const verdict = verifyVerdict(result, records);
        expect(verdict.label).toBe("BROKEN");
        expect(verdict.broken_at).toBe(2);
        expect(verdict.break_reason).toBe("hash");
        expect(verdict.detail).toContain("seq 2");
        expect(verdict.detail).toContain("content hash does not match");
    });

    it("distinguishes a previous link mismatch from a sequence gap", () => {
        const relinked = recordsFromEvents(fixtureEvents());
        relinked[1]!.prev_hash = "f".repeat(64);
        expect(verifyRecords(relinked).broken_at).toBe(1);
        expect(breakReason(relinked, 1)).toBe("prev_hash");

        const resequenced = recordsFromEvents(fixtureEvents());
        resequenced[1]!.seq = 7;
        expect(verifyRecords(resequenced).broken_at).toBe(1);
        expect(breakReason(resequenced, 1)).toBe("seq");
        expect(breakReason(resequenced, 99)).toBeNull();
    });
});

describe("tamper demo", () => {
    it("breaks the copy at the edited record and never touches the original", () => {
        const records = recordsFromEvents(fixtureEvents());
        const before = JSON.stringify(records);
        deepFreeze(records);

        // The freeze proves no mutation: any write to the original
        // would throw in strict mode before assertions even run.
        const demo = simulateTamper(records);
        expect(demo).not.toBeNull();
        expect(demo!.copy_result).toEqual({ valid: false, broken_at: 2 });
        expect(demo!.edit.seq).toBe(2);
        expect(demo!.original_result).toEqual({ valid: true, broken_at: null });

        expect(JSON.stringify(records)).toBe(before);
        expect(Object.isFrozen(records)).toBe(true);
        expect(Object.isFrozen(records[2]!.data)).toBe(true);
        expect(verifyRecords(records.slice())).toEqual({
            valid: true,
            broken_at: null,
        });
    });

    it("edits one data field in a way that always changes the value", () => {
        const demo = simulateTamper(recordsFromEvents(fixtureEvents()));
        expect(demo!.edit).toEqual({
            seq: 2,
            key: "amount_cents",
            before: 1350000,
            after: 1350001,
        });
    });

    it("has nothing to demonstrate on an empty chain", () => {
        expect(simulateTamper([])).toBeNull();
    });
});

describe("anchor summary", () => {
    it("reports head and count as matched when the run verified", () => {
        const summary = summarizeAnchor("VALID", {
            valid: true,
            broken_at: null,
        });
        expect(summary.label).toBe("Anchor agrees");
        expect(summary.head_match).toBe("match");
        expect(summary.count_match).toBe("match");
    });

    it("claims nothing specific when the run reported a disagreement", () => {
        const summary = summarizeAnchor("BROKEN", {
            valid: true,
            broken_at: null,
        });
        expect(summary.label).toBe("Anchor disagrees");
        expect(summary.head_match).toBe("unknown");
        expect(summary.count_match).toBe("unknown");
        expect(summary.note).toContain("no anchor was readable");
        expect(summary.note).toContain("cannot name which one");
    });

    it("stays unchecked before any run has anchored a head", () => {
        const summary = summarizeAnchor("PENDING", null);
        expect(summary.label).toBe("Anchor not checked");
        expect(summary.head_match).toBe("unchecked");
        expect(summary.count_match).toBe("unchecked");
    });
});

describe("evidence aggregation", () => {
    const rows: EvidenceRecord[] = [
        {
            tx_sig: SIG_A,
            real_ts_iso: "2026-11-12T00:00:00.000Z",
            fetched_ok: true,
            program_id_match: true,
            success: true,
        },
        {
            tx_sig: SIG_B,
            real_ts_iso: "",
            fetched_ok: true,
            program_id_match: false,
            success: true,
        },
        {
            tx_sig: "9notfound",
            real_ts_iso: "",
            fetched_ok: false,
            program_id_match: false,
            success: false,
            reason: "not_found",
        },
    ];

    it("counts fetched, program matches, and successes across mixed rows", () => {
        expect(summarizeEvidence(rows)).toEqual({
            total: 3,
            fetched: 2,
            program_match: 1,
            succeeded: 2,
            unfetched: 1,
        });
    });

    it("passes only when every checked signature was fetched", () => {
        const records = recordsFromEvents(fixtureEvents());
        const found: EvidenceRecord[] = [
            {
                tx_sig: SIG_A,
                real_ts_iso: "",
                fetched_ok: true,
                program_id_match: true,
                success: true,
            },
            {
                tx_sig: SIG_B,
                real_ts_iso: "",
                fetched_ok: true,
                program_id_match: true,
                success: true,
            },
        ];
        expect(checkEvidence(records, found)).toEqual({
            valid: true,
            missing_sigs: [],
        });
        // A signature outside the capped fetch is not judged at all,
        // so a partial batch never misreports the unfetched remainder.
        expect(checkEvidence(records, found.slice(0, 1))).toEqual({
            valid: true,
            missing_sigs: [],
        });
        // A row inside the batch that was not fetched is missing
        // evidence, which fails the aggregate check.
        const unfetched: EvidenceRecord[] = [
            found[0]!,
            {
                tx_sig: SIG_B,
                real_ts_iso: "",
                fetched_ok: false,
                program_id_match: false,
                success: false,
                reason: "not_found",
            },
        ];
        expect(checkEvidence(records, unfetched)).toEqual({
            valid: false,
            missing_sigs: [SIG_B],
        });
    });

    it("selects the first distinct signatures up to a clamped cap", () => {
        const records = recordsFromEvents(fixtureEvents());
        expect(distinctSigs(records)).toEqual([SIG_A, SIG_B]);
        expect(distinctSigs(records.slice(0, 1))).toEqual([]);
        expect(selectEvidenceSigs(records, 1)).toEqual([SIG_A]);
        expect(selectEvidenceSigs(records, 1.9)).toEqual([SIG_A]);
        expect(selectEvidenceSigs(records, -1)).toEqual([]);
        expect(selectEvidenceSigs(records)).toEqual([SIG_A, SIG_B]);
    });

    it("derives the offline and empty states without any fetch", () => {
        const records = recordsFromEvents(fixtureEvents());
        expect(evidencePhase("offline", records)).toBe("offline");
        expect(evidencePhase("live", [])).toBe("empty");
        expect(evidencePhase("live", records)).toBe("ready");
        const noSigs = records.map((record) => ({
            ...record,
            tx_sig: null,
        }));
        expect(evidencePhase("live", noSigs)).toBe("empty");
    });

    it("phrases failure reasons and wraps transport errors as RpcError", () => {
        expect(evidenceReasonLabel("invalid_signature")).toBe(
            "invalid signature",
        );
        expect(evidenceReasonLabel("not_found")).toBe("not found on chain");
        expect(evidenceReasonLabel("retries_exhausted")).toBe(
            "RPC retries exhausted",
        );
        expect(describeEvidenceFailure(new Error("connection reset"))).toBe(
            "RpcError: connection reset",
        );
        expect(
            describeEvidenceFailure(new Error("RpcError: 429 too many requests")),
        ).toBe("RpcError: 429 too many requests");
        expect(describeEvidenceFailure("boom")).toBe("RpcError: boom");
    });
});

describe("panel states", () => {
    it("invites a run when no chain exists yet", () => {
        const markup = renderToStaticMarkup(<ProvenancePanel />);

        expect(markup).toContain("Run a scenario to generate provenance");
        expect(markup).not.toContain("Chain records");
        expect(markup).not.toContain("Simulate tamper");
    });

    it("renders the chain, verify, tamper, and honest offline evidence state", () => {
        const markup = renderToStaticMarkup(
            <ProvenancePanel
                events={fixtureEvents()}
                mode="offline"
                chainStatus="VALID"
            />,
        );

        expect(markup).toContain("Chain records");
        expect(markup).toContain("NOT VERIFIED");
        expect(markup).toContain("Simulate tamper");
        expect(markup).toContain("Anchor agrees");
        expect(markup).toContain("Offline demo");
        expect(markup).toContain("No on-chain evidence in offline demo");
        expect(markup).toContain("Prev hash");
        expect(markup).not.toContain("Fetch devnet evidence");
    });

    it("offers a devnet evidence fetch in live mode", () => {
        const markup = renderToStaticMarkup(
            <ProvenancePanel events={fixtureEvents()} mode="live" />,
        );

        expect(markup).toContain("Fetch devnet evidence");
        expect(markup).toContain("Devnet live");
        expect(markup).not.toContain("No on-chain evidence");
    });
});
