import { describe, expect, it } from "vitest";
import {
    GENESIS_HASH,
    ProvenanceChain,
    recordHash,
    verifyRecords,
    type ProvenanceInput,
    type ProvenanceRecord,
} from "../provenance";

function fixtureInputs(): ProvenanceInput[] {
    return [
        {
            schema_version: 1,
            seq: 0,
            scenario_id: "SR-2026-11-10-0001",
            event: "TICKET_CREATED",
            actor: "ENGINE",
            virtual_ts_ms: "0",
            real_ts_iso: "2026-11-10T12:00:00.000Z",
            data: { ticket_id: "SR-2026-11-10-0001" },
            tx_sig: null,
        },
        {
            schema_version: 1,
            seq: 1,
            scenario_id: "SR-2026-11-10-0001",
            event: "ACK_A",
            actor: "PARTY_A",
            virtual_ts_ms: "100",
            real_ts_iso: null,
            data: { ack: true },
            tx_sig: "5xTr7YqEXAMPLESIGNATUREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        },
        {
            schema_version: 1,
            seq: 2,
            scenario_id: "SR-2026-11-10-0001",
            event: "LEG_FUNDED",
            actor: "PARTY_B",
            virtual_ts_ms: "500",
            real_ts_iso: null,
            data: { leg: "LEG2_CAD", amount_cents: "1350000" },
            tx_sig: "3kQp9WmEXAMPLESIGNATUREBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        },
    ];
}

function filledChain(): ProvenanceChain {
    const chain = new ProvenanceChain();
    for (const input of fixtureInputs()) {
        chain.append(input);
    }
    return chain;
}

describe("ProvenanceChain", () => {
    it("starts empty at the genesis head", () => {
        const chain = new ProvenanceChain();
        expect(chain.length).toBe(0);
        expect(chain.head).toBe(GENESIS_HASH);
        expect(GENESIS_HASH).toHaveLength(64);
        expect(chain.verify()).toBe(true);
    });

    it("links appended records and verifies", () => {
        const chain = filledChain();
        expect(chain.length).toBe(3);
        expect(chain.records[0]!.prev_hash).toBe(GENESIS_HASH);
        expect(chain.records[1]!.prev_hash).toBe(chain.records[0]!.hash);
        expect(chain.records[2]!.prev_hash).toBe(chain.records[1]!.hash);
        expect(chain.head).toBe(chain.records[2]!.hash);
        expect(chain.verify()).toBe(true);
    });

    it("is deterministic: two chains from the same inputs share heads", () => {
        const first = filledChain();
        const second = filledChain();
        expect(first.head).toBe(second.head);
        expect(first.records[0]!.hash).toBe(second.records[0]!.hash);
    });

    it("rejects an append whose seq does not continue the chain", () => {
        const chain = new ProvenanceChain();
        const inputs = fixtureInputs();
        chain.append(inputs[0]!);
        expect(() => chain.append(inputs[2]!)).toThrow(/expected seq 1/);
        expect(chain.length).toBe(1);
    });

    it("detects tampering with record data at that link", () => {
        const chain = filledChain();
        chain.records[1]!.data.ack = false;
        expect(chain.verify()).toBe(false);
    });

    it("detects tampering with the stored hash", () => {
        const chain = filledChain();
        const record = chain.records[2]!;
        record.hash = "f".repeat(64);
        expect(chain.verify()).toBe(false);
    });

    it("detects tampering with a prev_hash link", () => {
        const chain = filledChain();
        chain.records[2]!.prev_hash = "a".repeat(64);
        expect(chain.verify()).toBe(false);
    });

    it("detects a tampered genesis link", () => {
        const chain = filledChain();
        chain.records[0]!.prev_hash = "b".repeat(64);
        expect(chain.verify()).toBe(false);
    });

    it("stores money payloads as decimal integer strings", () => {
        const records = filledChain().records;
        const amount = records[2]!.data.amount_cents;
        expect(typeof amount).toBe("string");
        expect(amount).toBe("1350000");
        expect(amount).toMatch(/^\d+$/);
    });

    it("verifyRecords accepts a standalone copy of a valid chain", () => {
        const result = verifyRecords([...filledChain().records]);
        expect(result.valid).toBe(true);
        expect(result.broken_at).toBeNull();
    });

    it("verifyRecords accepts an empty sequence", () => {
        expect(verifyRecords([])).toEqual({ valid: true, broken_at: null });
    });

    it("verifyRecords reports the index of the first broken link", () => {
        const records = [...filledChain().records];
        records[1]!.data.ack = false;
        const result = verifyRecords(records);
        expect(result.valid).toBe(false);
        expect(result.broken_at).toBe(1);
    });
});

describe("provenance schema invariants (tradeops-schema.md)", () => {
    it("matches the worked example hashes from section 5.3", () => {
        const chain = new ProvenanceChain();
        const first = chain.append({
            schema_version: 1,
            seq: 0,
            scenario_id: "SR-2026-11-10-0001",
            event: "TICKET_CREATED",
            actor: "ENGINE",
            virtual_ts_ms: "0",
            real_ts_iso: "2026-11-10T12:00:00.000Z",
            data: { ticket_id: "SR-2026-11-10-0001", path: "SEQUENTIAL" },
            tx_sig: null,
        });
        expect(first.hash).toBe(
            "5659a252f893a2593a6e3110304119b639d06a297b0441bc83b17d372950a6cd",
        );
        const second = chain.append({
            schema_version: 1,
            seq: 1,
            scenario_id: "SR-2026-11-10-0001",
            event: "ACK_A",
            actor: "PARTY_A",
            virtual_ts_ms: "100",
            real_ts_iso: null,
            data: { desk_id: "DESK-A" },
            tx_sig: "5xTr7YqEXAMPLESIGNATUREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        });
        expect(second.prev_hash).toBe(first.hash);
        expect(second.hash).toBe(
            "32e9cdf692ca8ddc609513e49396a7ed7b104839c8d21aedd87fa1807e354609",
        );
        expect(chain.head).toBe(second.hash);
    });

    it("recordHash omits the hash field itself (canonical rule 8)", () => {
        const record = filledChain().records[0]!;
        const withDifferentStoredHash: ProvenanceRecord = {
            ...record,
            hash: "f".repeat(64),
        };
        expect(recordHash(withDifferentStoredHash)).toBe(record.hash);
    });

    it("verifyRecords detects a tampered seq number", () => {
        const records = [...filledChain().records];
        records[1]!.seq = 2;
        const result = verifyRecords(records);
        expect(result.valid).toBe(false);
        expect(result.broken_at).toBe(1);
    });

    it("rejects bigint payloads so money only travels as decimal strings", () => {
        const chain = new ProvenanceChain();
        const input: ProvenanceInput = {
            ...fixtureInputs()[0]!,
            data: {
                amount_cents: 1350000n,
            } as unknown as Record<string, string | number | boolean>,
        };
        expect(() => chain.append(input)).toThrow(/bigint/);
        expect(chain.length).toBe(0);
    });
});
