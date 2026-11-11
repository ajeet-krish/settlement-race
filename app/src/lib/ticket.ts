/**
 * Trade ticket schema, canonical JSON, and ticket hashing.
 *
 * The ticket is the off-chain agreement both parties acknowledge before the
 * on-chain race starts. Its SHA-256 hash is what the Scenario account stores,
 * so the exact serialization rules in this module are consensus relevant:
 * canonical JSON (keys sorted, no whitespace) hashed with SHA-256.
 */

import { sha256 } from "js-sha256";

/** Lifecycle states shared by the off-chain ticket and the on-chain scenario. */
export type LifecycleState =
    | "NEW"
    | "ACK"
    | "PAYING"
    | "SETTLED"
    | "FAILED"
    | "DEFAULTED";

/** Scenario behaviors the race UI can replay. */
export type ScenarioKind =
    | "honest"
    | "default_after_leg1"
    | "late_payment"
    | "atomic_revert"
    | "partial_payment";

/** Direction of the trade from party A's perspective. */
export type TradeSide = "BUY_CAD" | "SELL_CAD";

/** Settlement route chosen for the trade. */
export type SettlementPathName = "SEQUENTIAL" | "ATOMIC";

/** Trade ticket, exact schema version 1. */
export interface TradeTicket {
    schema_version: 1;
    ticket_id: string;
    cl_ord_id: string;
    trade_date: string;
    value_date: string;
    symbol: "USD/CAD";
    side: TradeSide;
    party_a: PartyRef;
    party_b: PartyRef;
    base_ccy: "USD";
    base_amount_cents: string;
    quote_ccy: "CAD";
    quote_amount_cents: string;
    rate_scaled: string;
    rate_scale: 1000000;
    settlement_path: SettlementPathName;
    scenario: ScenarioKind;
    gap_ms: string;
    lifecycle: LifecycleState;
    ticket_hash: string;
}

/** Counterparty reference inside a ticket. */
export interface PartyRef {
    desk_id: string;
    wallet: string;
}

/**
 * Input to buildTicket. Everything the caller supplies, minus the derived
 * schema constants and the ticket_hash that buildTicket computes.
 */
export interface TicketInput {
    ticket_id: string;
    cl_ord_id: string;
    trade_date: string;
    value_date: string;
    side: TradeSide;
    party_a: PartyRef;
    party_b: PartyRef;
    base_amount_cents: string;
    quote_amount_cents: string;
    rate_scaled: string;
    settlement_path: SettlementPathName;
    scenario: ScenarioKind;
    gap_ms: string;
    lifecycle?: LifecycleState;
}

const LIFECYCLE_STATES: readonly LifecycleState[] = [
    "NEW",
    "ACK",
    "PAYING",
    "SETTLED",
    "FAILED",
    "DEFAULTED",
];
const SCENARIO_KINDS: readonly ScenarioKind[] = [
    "honest",
    "default_after_leg1",
    "late_payment",
    "atomic_revert",
    "partial_payment",
];
const TRADE_SIDES: readonly TradeSide[] = ["BUY_CAD", "SELL_CAD"];
const SETTLEMENT_PATHS: readonly SettlementPathName[] = ["SEQUENTIAL", "ATOMIC"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
/** Length limit for free form string fields (ids, desks, wallets). */
const MAX_STRING_LENGTH = 128;
/** Largest value representable in an unsigned 64 bit integer. */
const U64_MAX = 18446744073709551615n;
/** Longest digit string that can possibly fit in an unsigned 64 bit integer. */
const U64_MAX_DIGITS = 20;

/**
 * Serialize a value as canonical JSON: object keys sorted lexicographically
 * (UTF-16 code unit order), no whitespace anywhere, arrays keep their order,
 * strings escaped exactly as JSON.stringify escapes them.
 *
 * Undefined object properties are omitted, matching JSON.stringify.
 *
 * @throws Error for bigint, undefined at the top level, functions, symbols,
 * non finite numbers, and circular structures (via the recursion guard).
 */
export function canonicalJson(v: unknown): string {
    return canonicalJsonInner(v, new Set<object>());
}

function canonicalJsonInner(v: unknown, seen: Set<object>): string {
    if (v === null) {
        return "null";
    }
    const t = typeof v;
    if (t === "string") {
        return JSON.stringify(v);
    }
    if (t === "boolean") {
        return v ? "true" : "false";
    }
    if (t === "number") {
        if (!Number.isFinite(v as number)) {
            throw new Error(`canonicalJson: non finite number: ${String(v)}`);
        }
        return JSON.stringify(v);
    }
    if (t === "bigint") {
        throw new Error(
            "canonicalJson: bigint is not JSON representable, convert to string first",
        );
    }
    if (t === "undefined" || t === "function" || t === "symbol") {
        throw new Error(`canonicalJson: unsupported value of type ${t}`);
    }
    // object
    const obj = v as object;
    if (seen.has(obj)) {
        throw new Error("canonicalJson: circular structure");
    }
    seen.add(obj);
    try {
        if (Array.isArray(v)) {
            const items = (v as unknown[]).map((item) =>
                canonicalJsonInner(item, seen),
            );
            return `[${items.join(",")}]`;
        }
        const record = v as Record<string, unknown>;
        const keys = Object.keys(record).sort();
        const parts: string[] = [];
        for (const key of keys) {
            const value = record[key];
            if (value === undefined) {
                continue;
            }
            parts.push(`${JSON.stringify(key)}:${canonicalJsonInner(value, seen)}`);
        }
        return `{${parts.join(",")}}`;
    } finally {
        seen.delete(obj);
    }
}

/**
 * SHA-256 (hex, lowercase) of the canonical JSON of the ticket with the
 * ticket_hash field removed. This is the hash stored on chain.
 */
export function ticketHash(t: TradeTicket): string {
    const withoutHash: Record<string, unknown> = { ...t };
    delete withoutHash.ticket_hash;
    return sha256(canonicalJson(withoutHash));
}

/**
 * Build a complete ticket from caller input, filling schema constants
 * (schema_version, symbol, base_ccy, quote_ccy, rate_scale) and computing
 * ticket_hash. The result is validated before it is returned.
 *
 * @throws Error when the assembled ticket fails validation.
 */
export function buildTicket(input: TicketInput): TradeTicket {
    const ticket: TradeTicket = {
        schema_version: 1,
        ticket_id: input.ticket_id,
        cl_ord_id: input.cl_ord_id,
        trade_date: input.trade_date,
        value_date: input.value_date,
        symbol: "USD/CAD",
        side: input.side,
        party_a: { ...input.party_a },
        party_b: { ...input.party_b },
        base_ccy: "USD",
        base_amount_cents: input.base_amount_cents,
        quote_ccy: "CAD",
        quote_amount_cents: input.quote_amount_cents,
        rate_scaled: input.rate_scaled,
        rate_scale: 1000000,
        settlement_path: input.settlement_path,
        scenario: input.scenario,
        gap_ms: input.gap_ms,
        lifecycle: input.lifecycle ?? "NEW",
        ticket_hash: "",
    };
    ticket.ticket_hash = ticketHash(ticket);
    validateTicket(ticket);
    return ticket;
}

/**
 * Assert that an unknown value is a valid TradeTicket (schema version 1).
 *
 * Validates field presence, types, enum membership, date and integer string
 * formats, string length limits (128 characters for ids, desks, and
 * wallets), unsigned 64 bit range checks for amounts, rate, and gap (a
 * negative gap is rejected), and the ticket_hash shape (64 lowercase hex
 * characters). It does not recompute the hash; use ticketHash for that.
 * Unknown extra keys are tolerated for now; strict rejection is deferred to
 * a Phase 2 decision.
 *
 * @throws Error naming the first field that fails.
 */
export function validateTicket(v: unknown): asserts v is TradeTicket {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
        throw new Error("validateTicket: ticket must be a plain object");
    }
    const t = v as Record<string, unknown>;

    if (t.schema_version !== 1) {
        throw new Error("validateTicket: schema_version must be 1");
    }
    requireNonEmptyString(t, "ticket_id");
    requireNonEmptyString(t, "cl_ord_id");
    requireDateString(t, "trade_date");
    requireDateString(t, "value_date");
    requireOneOf(t, "symbol", ["USD/CAD"]);
    requireOneOf(t, "side", TRADE_SIDES);
    requireParty(t, "party_a");
    requireParty(t, "party_b");
    requireOneOf(t, "base_ccy", ["USD"]);
    requireU64String(t, "base_amount_cents");
    requireOneOf(t, "quote_ccy", ["CAD"]);
    requireU64String(t, "quote_amount_cents");
    requireU64String(t, "rate_scaled");
    if (t.rate_scale !== 1000000) {
        throw new Error("validateTicket: rate_scale must be 1000000");
    }
    requireOneOf(t, "settlement_path", SETTLEMENT_PATHS);
    requireOneOf(t, "scenario", SCENARIO_KINDS);
    requireU64String(t, "gap_ms");
    requireOneOf(t, "lifecycle", LIFECYCLE_STATES);
    const hash = t.ticket_hash;
    if (typeof hash !== "string" || !HEX_64_PATTERN.test(hash)) {
        throw new Error(
            "validateTicket: ticket_hash must be 64 lowercase hex characters",
        );
    }
}

function requireNonEmptyString(t: Record<string, unknown>, key: string): string {
    const v = t[key];
    if (typeof v !== "string" || v.length === 0) {
        throw new Error(`validateTicket: ${key} must be a non-empty string`);
    }
    if (v.length > MAX_STRING_LENGTH) {
        throw new Error(
            `validateTicket: ${key} must be at most ${MAX_STRING_LENGTH} characters`,
        );
    }
    return v;
}

function requireDateString(t: Record<string, unknown>, key: string): string {
    const v = requireNonEmptyString(t, key);
    if (!DATE_PATTERN.test(v)) {
        throw new Error(`validateTicket: ${key} must be YYYY-MM-DD`);
    }
    return v;
}

/**
 * Require a non negative integer string whose value fits in an unsigned 64
 * bit integer (max 18446744073709551615). This rejects negative gap values
 * and amounts beyond the u64 range. Digit strings longer than 20 characters
 * are rejected before BigInt parsing; only leading zero padding could keep a
 * longer string within range, and padded input is rejected as non canonical.
 */
function requireU64String(t: Record<string, unknown>, key: string): string {
    const v = requireNonEmptyString(t, key);
    if (!NON_NEGATIVE_INTEGER_PATTERN.test(v)) {
        throw new Error(
            `validateTicket: ${key} must be a non negative integer string`,
        );
    }
    if (v.length > U64_MAX_DIGITS || BigInt(v) > U64_MAX) {
        throw new Error(
            `validateTicket: ${key} must be within the unsigned 64 bit range`,
        );
    }
    return v;
}

function requireOneOf<T extends string>(
    t: Record<string, unknown>,
    key: string,
    allowed: readonly T[],
): T {
    const v = t[key];
    if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
        throw new Error(
            `validateTicket: ${key} must be one of ${allowed.join(", ")}`,
        );
    }
    return v as T;
}

function requireParty(t: Record<string, unknown>, key: string): PartyRef {
    const v = t[key];
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
        throw new Error(`validateTicket: ${key} must be an object`);
    }
    const party = v as Record<string, unknown>;
    const deskId = requireNonEmptyString(party, "desk_id");
    const wallet = requireNonEmptyString(party, "wallet");
    return { desk_id: deskId, wallet };
}
