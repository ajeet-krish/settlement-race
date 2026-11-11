import { describe, expect, it } from "vitest";
import {
    buildTicket,
    canonicalJson,
    ticketHash,
    validateTicket,
    type TicketInput,
    type TradeTicket,
} from "../ticket";

/**
 * Golden hash for FIXTURE_INPUT. If this changes, canonical JSON or the
 * hashing rules changed, which is a breaking protocol change: update the
 * on-chain ticket_hash expectations and the schema doc together.
 */
const GOLDEN_TICKET_HASH = "5afdf9f88c139d82f09a38f6dd40fc8cc7de885cddf057fc68003fb925300a62";

const FIXTURE_INPUT: TicketInput = {
    ticket_id: "SR-2026-11-10-0001",
    cl_ord_id: "CLORD-7f3a9c21",
    trade_date: "2026-11-10",
    value_date: "2026-11-12",
    side: "BUY_CAD",
    party_a: {
        desk_id: "DESK-A",
        wallet: "CwzzqAv4n1EqDZ616zB3y5UrBSzoyXhujdLzk3Cf1Ke9",
    },
    party_b: {
        desk_id: "DESK-B",
        wallet: "8iBowKEfGo2qhDT4B6KGGea3BziQi2poHHUJxiCkVuAk",
    },
    base_amount_cents: "1000000",
    quote_amount_cents: "1350000",
    rate_scaled: "1350000",
    settlement_path: "SEQUENTIAL",
    scenario: "honest",
    gap_ms: "5000",
};

describe("canonicalJson", () => {
    it("sorts object keys lexicographically", () => {
        expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    });

    it("sorts nested keys and preserves array order", () => {
        expect(canonicalJson({ z: { d: 1, c: 2 }, a: [3, 1, 2] })).toBe(
            '{"a":[3,1,2],"z":{"c":2,"d":1}}',
        );
    });

    it("produces the same output regardless of input key order", () => {
        const one = canonicalJson({
            scenario: "honest",
            amount: 100,
            flag: true,
            name: "x",
        });
        const two = canonicalJson({
            name: "x",
            flag: true,
            amount: 100,
            scenario: "honest",
        });
        expect(one).toBe(two);
    });

    it("emits no whitespace", () => {
        const serialized = canonicalJson({ a: { b: [1, 2], c: "text" } });
        expect(serialized).not.toMatch(/\s/);
        expect(serialized).toBe('{"a":{"b":[1,2],"c":"text"}}');
    });

    it("keeps unicode stable", () => {
        expect(canonicalJson({ note: "café" })).toBe('{"note":"café"}');
    });

    it("omits undefined properties like JSON.stringify", () => {
        expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    });

    it("rejects bigint, non finite numbers, and top level undefined", () => {
        expect(() => canonicalJson({ v: 1n })).toThrow();
        expect(() => canonicalJson({ v: Number.NaN })).toThrow();
        expect(() => canonicalJson({ v: Number.POSITIVE_INFINITY })).toThrow();
        expect(() => canonicalJson(undefined)).toThrow();
    });
});

describe("ticketHash", () => {
    it("matches the golden fixture hash", () => {
        expect(ticketHash(buildTicket(FIXTURE_INPUT))).toBe(
            GOLDEN_TICKET_HASH,
        );
    });

    it("is stable across repeated builds of the same input", () => {
        const first = buildTicket(FIXTURE_INPUT);
        const second = buildTicket({ ...FIXTURE_INPUT });
        expect(ticketHash(first)).toBe(ticketHash(second));
        expect(first.ticket_hash).toBe(second.ticket_hash);
        expect(first.ticket_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("ignores the ticket_hash field itself", () => {
        const ticket = buildTicket(FIXTURE_INPUT);
        const other: TradeTicket = { ...ticket, ticket_hash: "0".repeat(64) };
        expect(ticketHash(other)).toBe(ticketHash(ticket));
    });

    it("changes when any hashed field changes", () => {
        const ticket = buildTicket(FIXTURE_INPUT);
        const changed: TradeTicket = { ...ticket, gap_ms: "6000" };
        expect(ticketHash(changed)).not.toBe(ticketHash(ticket));
        const relinked: TradeTicket = {
            ...ticket,
            settlement_path: "ATOMIC",
        };
        expect(ticketHash(relinked)).not.toBe(ticketHash(ticket));
    });
});

describe("buildTicket", () => {
    it("fills schema constants and defaults lifecycle to NEW", () => {
        const ticket = buildTicket(FIXTURE_INPUT);
        expect(ticket.schema_version).toBe(1);
        expect(ticket.symbol).toBe("USD/CAD");
        expect(ticket.base_ccy).toBe("USD");
        expect(ticket.quote_ccy).toBe("CAD");
        expect(ticket.rate_scale).toBe(1000000);
        expect(ticket.lifecycle).toBe("NEW");
    });

    it("produces a ticket that passes validation", () => {
        expect(() => validateTicket(buildTicket(FIXTURE_INPUT))).not.toThrow();
    });

    it("honors an explicit lifecycle", () => {
        const ticket = buildTicket({ ...FIXTURE_INPUT, lifecycle: "PAYING" });
        expect(ticket.lifecycle).toBe("PAYING");
    });
});

describe("validateTicket", () => {
    const valid = buildTicket(FIXTURE_INPUT);

    it("accepts a well formed ticket", () => {
        expect(() => validateTicket(valid)).not.toThrow();
    });

    it("rejects non objects", () => {
        expect(() => validateTicket(null)).toThrow();
        expect(() => validateTicket(undefined)).toThrow();
        expect(() => validateTicket("ticket")).toThrow();
        expect(() => validateTicket([valid])).toThrow();
    });

    it("rejects the wrong schema version", () => {
        expect(() => validateTicket({ ...valid, schema_version: 2 })).toThrow();
    });

    it("rejects an illegal side and scenario", () => {
        expect(() => validateTicket({ ...valid, side: "BUY_USD" })).toThrow();
        expect(() =>
            validateTicket({ ...valid, scenario: "sneaky" }),
        ).toThrow();
    });

    it("rejects a malformed ticket_hash", () => {
        expect(() => validateTicket({ ...valid, ticket_hash: "abc" })).toThrow();
        expect(() =>
            validateTicket({ ...valid, ticket_hash: "A".repeat(64) }),
        ).toThrow();
        expect(() =>
            validateTicket({ ...valid, ticket_hash: "0".repeat(65) }),
        ).toThrow();
    });

    it("rejects decimal amounts and missing parties", () => {
        expect(() =>
            validateTicket({ ...valid, base_amount_cents: "10.5" }),
        ).toThrow();
        expect(() =>
            validateTicket({ ...valid, quote_amount_cents: "-1" }),
        ).toThrow();
        const missingParty: Record<string, unknown> = { ...valid };
        delete missingParty.party_b;
        expect(() => validateTicket(missingParty)).toThrow();
    });

    it("rejects a bad date and a bad gap", () => {
        expect(() => validateTicket({ ...valid, trade_date: "10-11-2026" })).toThrow();
        expect(() => validateTicket({ ...valid, gap_ms: "5.5" })).toThrow();
    });

    it("rejects a negative gap", () => {
        expect(() => validateTicket({ ...valid, gap_ms: "-1" })).toThrow();
        expect(() => validateTicket({ ...valid, gap_ms: "-5000" })).toThrow();
    });

    it("rejects values above the unsigned 64 bit range", () => {
        const overU64 = "18446744073709551616"; // u64 max + 1
        expect(() =>
            validateTicket({ ...valid, base_amount_cents: overU64 }),
        ).toThrow();
        expect(() =>
            validateTicket({ ...valid, quote_amount_cents: overU64 }),
        ).toThrow();
        expect(() => validateTicket({ ...valid, rate_scaled: overU64 })).toThrow();
        expect(() => validateTicket({ ...valid, gap_ms: overU64 })).toThrow();
        // Exactly u64 max stays valid.
        const atU64 = "18446744073709551615";
        expect(() =>
            validateTicket({ ...valid, base_amount_cents: atU64 }),
        ).not.toThrow();
        expect(() => validateTicket({ ...valid, gap_ms: atU64 })).not.toThrow();
    });

    it("rejects overlong string fields", () => {
        const overlong = "x".repeat(129);
        expect(() => validateTicket({ ...valid, ticket_id: overlong })).toThrow(
            /128 characters/,
        );
        expect(() => validateTicket({ ...valid, cl_ord_id: overlong })).toThrow(
            /128 characters/,
        );
        expect(() =>
            validateTicket({
                ...valid,
                party_a: { ...valid.party_a, desk_id: overlong },
            }),
        ).toThrow(/128 characters/);
        expect(() =>
            validateTicket({
                ...valid,
                party_b: { ...valid.party_b, wallet: overlong },
            }),
        ).toThrow(/128 characters/);
        // Exactly 128 characters stays valid.
        expect(() =>
            validateTicket({ ...valid, ticket_id: "x".repeat(128) }),
        ).not.toThrow();
    });
});

describe("schema invariants (tradeops-schema.md)", () => {
    it("changes the ticket hash when any single hashed field changes", () => {
        const base = buildTicket(FIXTURE_INPUT);
        const mutations: Array<[string, (t: TradeTicket) => void]> = [
            ["ticket_id", (t) => { t.ticket_id = "SR-2026-11-10-0002"; }],
            ["cl_ord_id", (t) => { t.cl_ord_id = "CLORD-other"; }],
            ["trade_date", (t) => { t.trade_date = "2026-11-09"; }],
            ["value_date", (t) => { t.value_date = "2026-11-13"; }],
            ["side", (t) => { t.side = "SELL_CAD"; }],
            ["party_a.desk_id", (t) => { t.party_a.desk_id = "DESK-X"; }],
            ["party_b.wallet", (t) => { t.party_b.wallet += "X"; }],
            ["base_amount_cents", (t) => { t.base_amount_cents = "1000001"; }],
            ["quote_amount_cents", (t) => { t.quote_amount_cents = "1350001"; }],
            ["rate_scaled", (t) => { t.rate_scaled = "1350001"; }],
            ["settlement_path", (t) => { t.settlement_path = "ATOMIC"; }],
            ["scenario", (t) => { t.scenario = "late_payment"; }],
            ["gap_ms", (t) => { t.gap_ms = "5001"; }],
            ["lifecycle", (t) => { t.lifecycle = "ACK"; }],
        ];
        for (const [field, mutate] of mutations) {
            const mutated: TradeTicket = {
                ...base,
                party_a: { ...base.party_a },
                party_b: { ...base.party_b },
            };
            mutate(mutated);
            expect(
                ticketHash(mutated),
                `hash must change when ${field} changes`,
            ).not.toBe(base.ticket_hash);
        }
    });

    it("preserves null and escapes strings exactly like JSON.stringify, with UTF-16 key order", () => {
        // Rule 5: null is preserved; undefined object properties are omitted.
        expect(canonicalJson({ a: null, b: undefined })).toBe('{"a":null}');
        // Rule 4: strings escape exactly as JSON.stringify does, including
        // control characters, quotes, backslashes, and lone surrogates.
        const tricky =
            'quote " backslash \\ newline \n tab \t café \ud800 😀 end';
        expect(canonicalJson({ s: tricky })).toBe(JSON.stringify({ s: tricky }));
        // Rule 1: keys sort by UTF-16 code unit (Z=90 < a=97 < z=122 < é=233),
        // not by locale collation.
        expect(canonicalJson({ "é": 1, z: 2, Z: 3, a: 4 })).toBe(
            '{"Z":3,"a":4,"z":2,"é":1}',
        );
    });

    it("copies party references so later input mutation cannot alter the ticket", () => {
        const input: TicketInput = {
            ...FIXTURE_INPUT,
            party_a: { ...FIXTURE_INPUT.party_a },
        };
        const ticket = buildTicket(input);
        input.party_a.desk_id = "MUTATED";
        expect(ticket.party_a.desk_id).toBe("DESK-A");
        expect(ticketHash(ticket)).toBe(ticket.ticket_hash);
    });

    it("rejects money as JSON numbers, wrong literals, and bad enum members", () => {
        const valid = buildTicket(FIXTURE_INPUT);
        // Money never appears as a JSON number (rule 6 / ground rules).
        expect(() =>
            validateTicket({ ...valid, base_amount_cents: 1000000 }),
        ).toThrow();
        expect(() =>
            validateTicket({ ...valid, quote_amount_cents: 1350000 }),
        ).toThrow();
        expect(() => validateTicket({ ...valid, rate_scaled: 1350000 })).toThrow();
        // Wrong literal types.
        expect(() => validateTicket({ ...valid, symbol: "EUR/USD" })).toThrow();
        expect(() => validateTicket({ ...valid, base_ccy: "EUR" })).toThrow();
        expect(() => validateTicket({ ...valid, quote_ccy: "USD" })).toThrow();
        expect(() => validateTicket({ ...valid, rate_scale: 100 })).toThrow();
        // Wrong enum members.
        expect(() =>
            validateTicket({ ...valid, settlement_path: "SMART" }),
        ).toThrow();
        expect(() =>
            validateTicket({ ...valid, lifecycle: "CANCELLED" }),
        ).toThrow();
    });

    it("validates hash shape but not hash content (documented Phase 1 behavior)", () => {
        const valid = buildTicket(FIXTURE_INPUT);
        const wrongContent: TradeTicket = {
            ...valid,
            ticket_hash: "a".repeat(64),
        };
        // validateTicket does not recompute the hash, per its documentation.
        expect(() => validateTicket(wrongContent)).not.toThrow();
        // Callers must compare ticket_hash against ticketHash() themselves.
        expect(ticketHash(wrongContent)).not.toBe(wrongContent.ticket_hash);
    });

    it("accepts any lifecycle off chain; transition guards are Phase 2", () => {
        // tradeops-schema.md section 2.1 defines the transition table, but no
        // TypeScript code enforces transitions yet: guards land on chain in
        // Phase 2. This test pins the current (permissive) behavior.
        const states = [
            "NEW",
            "ACK",
            "PAYING",
            "SETTLED",
            "DEFAULTED",
            "FAILED",
        ] as const;
        for (const lifecycle of states) {
            const ticket = buildTicket({ ...FIXTURE_INPUT, lifecycle });
            expect(ticket.lifecycle).toBe(lifecycle);
            expect(() => validateTicket(ticket)).not.toThrow();
        }
    });
});
