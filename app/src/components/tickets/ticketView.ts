/**
 * Tickets view logic: reconstruct the run's trade ticket, map provenance
 * events onto the lifecycle rail, format the rate, and hold the schema
 * reference data. Pure functions and data only (no React, no DOM), so the
 * derivation is testable without a renderer.
 *
 * Reconstruction honesty: the engine builds one canonical ticket per run
 * (scenarioEngine's ticketForSpec) but emits only ticket_id, ticket_hash,
 * and the acknowledgements into the event stream. The spec carries the
 * notionals, the gap, and the scenario kind; the trade and value dates,
 * client order id, desks, side, and path are engine constants that no
 * event records. This module rebuilds those constants verbatim, rebuilds
 * the ticket through lib/ticket's buildTicket, and compares the result
 * with the TICKET_CREATED record's hash. A match proves the rebuild is
 * byte identical to the ticket the chain refers to (SHA-256 over
 * canonical JSON); a mismatch or a missing record is reported as such.
 * The view labels itself reconstructed either way, and nothing in the
 * engine or race source is modified to expose more.
 */

import { RACE_ID, type RaceEvent } from "../../engine/scenarioEngine";
import type { ScenarioSpec } from "../../engine/scenarios";
import { buildTicket } from "../../lib/ticket";
import type {
    LifecycleState,
    SettlementPathName,
    TradeTicket,
} from "../../lib/ticket";

/**
 * Engine constants mirrored from scenarioEngine's ticketForSpec. They are
 * module private there and must not be changed without changing this
 * mirror; the hash comparison below is the drift detector, because a
 * changed constant yields a different ticket_hash and the view reports a
 * mismatch instead of a false match.
 */
const CL_ORD_ID = "ORD-ENGINE-0001";
const TRADE_DATE = "2026-11-11";
const VALUE_DATE = "2026-11-13";
const DESK_A = "DESK-A";
const DESK_B = "DESK-B";

/** The ticket's rate_scale as bigint, six decimal places of precision. */
const RATE_SCALE = 1_000_000n;

const INTEGER_STRING = /^\d+$/;

/** Every lifecycle state, in rail order for the non terminal members. */
const LIFECYCLE_STATES: readonly LifecycleState[] = [
    "NEW",
    "ACK",
    "PAYING",
    "SETTLED",
    "FAILED",
    "DEFAULTED",
];

/** States with no outbound transition (tradeops schema section 2). */
const TERMINAL_STATES: readonly LifecycleState[] = [
    "SETTLED",
    "FAILED",
    "DEFAULTED",
];

/** Which rail step a lifecycle state lands on: terminal states share 3. */
const RAIL_INDEX: Readonly<Record<LifecycleState, number>> = {
    NEW: 0,
    ACK: 1,
    PAYING: 2,
    SETTLED: 3,
    DEFAULTED: 3,
    FAILED: 3,
};

/** Narrow an untrusted string to a lifecycle state, or null. */
function asLifecycle(v: unknown): LifecycleState | null {
    if (typeof v !== "string") {
        return null;
    }
    return (LIFECYCLE_STATES as readonly string[]).includes(v)
        ? (v as LifecycleState)
        : null;
}

/** True when the state is terminal (SETTLED, DEFAULTED, FAILED). */
export function isTerminalState(state: LifecycleState): boolean {
    return TERMINAL_STATES.includes(state);
}

/**
 * Rebuild the run's canonical ticket from the spec plus the two party
 * wallets. Mirrors the engine's ticketForSpec field for field, so the
 * result validates and carries the same ticket_hash the lanes stored.
 *
 * @throws Error when the assembled ticket fails lib/ticket validation
 * (for example a wallet longer than 128 characters).
 */
export function buildRunTicket(
    spec: ScenarioSpec,
    partyAWallet: string,
    partyBWallet: string,
): TradeTicket {
    // Integer rate math: quote cents scaled by rate_scale over base
    // cents, exact for the scenario catalogue amounts. Zero base is
    // guarded so a hypothetical zero notional cannot throw.
    const rateScaled =
        spec.leg1_usd_cents === 0n
            ? 0n
            : (spec.leg2_cad_cents * RATE_SCALE) / spec.leg1_usd_cents;
    return buildTicket({
        ticket_id: RACE_ID,
        cl_ord_id: CL_ORD_ID,
        trade_date: TRADE_DATE,
        value_date: VALUE_DATE,
        side: "BUY_CAD",
        party_a: { desk_id: DESK_A, wallet: partyAWallet },
        party_b: { desk_id: DESK_B, wallet: partyBWallet },
        base_amount_cents: spec.leg1_usd_cents.toString(),
        quote_amount_cents: spec.leg2_cad_cents.toString(),
        rate_scaled: rateScaled.toString(),
        settlement_path: "SEQUENTIAL",
        scenario: spec.kind,
        gap_ms: spec.gap_ms,
        lifecycle: "NEW",
    });
}

/** The ticket_hash recorded by the first TICKET_CREATED record, or null. */
export function recordedTicketHash(
    events: readonly RaceEvent[],
): string | null {
    for (const event of events) {
        if (event.event !== "TICKET_CREATED") {
            continue;
        }
        const hash = event.provenance.data.ticket_hash;
        if (typeof hash === "string" && hash.length > 0) {
            return hash;
        }
    }
    return null;
}

/**
 * Drive one lane's lifecycle from the event stream, in stream order.
 *
 * The rules follow tradeops section 2.1: TICKET_CREATED lands in NEW,
 * ACK_A and ACK_B together flip to ACK, RACE_STARTED moves to PAYING, and
 * the terminal events close the state. A status_snapshot (attached to
 * terminal records by the engine) is authoritative whenever it appears.
 * Returns null when the lane has no events at all.
 */
export function laneLifecycle(
    events: readonly RaceEvent[],
    lane: SettlementPathName,
): LifecycleState | null {
    let state: LifecycleState | null = null;
    let ackA = false;
    let ackB = false;
    for (const event of events) {
        let snapshotTaken = false;
        if (event.status_snapshot !== undefined) {
            const snapshot =
                lane === "SEQUENTIAL"
                    ? event.status_snapshot.sequential
                    : event.status_snapshot.atomic;
            const parsed = asLifecycle(snapshot);
            if (parsed !== null) {
                state = parsed;
                snapshotTaken = true;
            }
        }
        if (event.lane !== lane) {
            continue;
        }
        // A snapshot is the engine's read of the chain, so when one is
        // present and parseable it wins over this record's transition.
        if (snapshotTaken) {
            continue;
        }
        switch (event.event) {
            case "TICKET_CREATED":
                if (state === null) {
                    state = "NEW";
                }
                break;
            case "ACK_A":
                ackA = true;
                if (state === null) {
                    state = "NEW";
                }
                if (ackB) {
                    state = "ACK";
                }
                break;
            case "ACK_B":
                ackB = true;
                if (state === null) {
                    state = "NEW";
                }
                if (ackA) {
                    state = "ACK";
                }
                break;
            case "RACE_STARTED":
                if (state === null || state === "NEW" || state === "ACK") {
                    state = "PAYING";
                }
                break;
            case "LEG2_RELEASED":
                state = "SETTLED";
                break;
            case "DEFAULT_DECLARED":
                state = "DEFAULTED";
                break;
            case "ATOMIC_SETTLED":
                state = "SETTLED";
                break;
            case "ATOMIC_REVERTED":
                // tradeops section 2.1: PAYING plus ATOMIC_REVERTED is
                // FAILED, the reverted attempt moved no funds. The
                // engine's follow-up FAILED_MARKED lands on the same
                // state, so the mapping stays idempotent.
                state = "FAILED";
                break;
            case "FAILED_MARKED":
                state = "FAILED";
                break;
            default:
                break;
        }
    }
    return state;
}

/** How a rail step reads: label, transition rule caption, and cause. */
export interface RailStepCopy {
    id: "NEW" | "ACK" | "PAYING" | "TERMINAL";
    index: number;
    label: string;
    rule: string;
    cause: string;
}

/** Progress of one step along the rail. */
export type RailStatus = "done" | "current" | "ahead";

/** Colour role of a step, matching the theme tokens. */
export type RailTone = "neutral" | "amber" | "teal" | "clay";

/** One rendered rail step: copy plus derived progress. */
export interface RailStep extends RailStepCopy {
    status: RailStatus;
    tone: RailTone;
}

/** Rail view derived from a run's event stream. */
export interface RailView {
    /** Highlighted lifecycle state on the sequential (ticket) path. */
    current: LifecycleState;
    /** Terminal state reached on the sequential path, or null. */
    terminal: LifecycleState | null;
    /** The four steps, exactly one carrying status "current". */
    steps: readonly RailStep[];
    /** Lifecycle of the sequential lane (the ticket's own path). */
    sequentialState: LifecycleState;
    /** Lifecycle of the atomic lane, or null when it has no events. */
    atomicState: LifecycleState | null;
}

const NEW_COPY: RailStepCopy = {
    id: "NEW",
    index: 0,
    label: "NEW",
    rule: "TICKET_CREATED: the agreed ticket is hashed into both lane accounts before anything moves.",
    cause: "ENGINE",
};

const ACK_COPY: RailStepCopy = {
    id: "ACK",
    index: 1,
    label: "ACK",
    rule: "ACK_A and ACK_B: both parties sign, and the second acknowledgement flips the state. Funding is accepted only in ACK.",
    cause: "BOTH PARTIES",
};

const PAYING_COPY: RailStepCopy = {
    id: "PAYING",
    index: 2,
    label: "PAYING",
    rule: "RACE_STARTED by the driver after both legs are funded: the sequential exposure window runs until leg 2 arrives or the gap expires.",
    cause: "DRIVER",
};

/** Terminal step copy, written from the state the run actually reached. */
function terminalCopy(terminal: LifecycleState | null): RailStepCopy {
    switch (terminal) {
        case "SETTLED":
            return {
                id: "TERMINAL",
                index: 3,
                label: "SETTLED",
                rule: "LEG2_RELEASED in full (party B pays), or ATOMIC_SETTLED in one transaction. Terminal: no transition out.",
                cause: "ENGINE",
            };
        case "DEFAULTED":
            return {
                id: "TERMINAL",
                index: 3,
                label: "DEFAULTED",
                rule: "DEFAULT_DECLARED after the gap expired with leg 2 unpaid. Terminal: no transition out.",
                cause: "DRIVER",
            };
        case "FAILED":
            return {
                id: "TERMINAL",
                index: 3,
                label: "FAILED",
                rule: "FAILED_MARKED after an unrecoverable condition, such as a reverted atomic settle. Terminal: no transition out.",
                cause: "DRIVER",
            };
        default:
            return {
                id: "TERMINAL",
                index: 3,
                label: "TERMINAL",
                rule: "Three exits: full payment settles, an expired gap defaults, an unrecoverable attempt fails. Terminal either way.",
                cause: "STATE MACHINE",
            };
    }
}

/** Colour role for the terminal step once the state is known. */
function terminalTone(terminal: LifecycleState | null): RailTone {
    switch (terminal) {
        case "SETTLED":
            return "teal";
        case "DEFAULTED":
        case "FAILED":
            return "clay";
        default:
            return "neutral";
    }
}

/**
 * Map a run's event stream onto the four step lifecycle rail. The
 * sequential lane drives the ticket's own state (the ticket names the
 * SEQUENTIAL path), and the atomic lane's state rides along for the lane
 * chips. Returns null for an empty stream, which is the empty state.
 */
export function railFromEvents(events: readonly RaceEvent[]): RailView | null {
    if (events.length === 0) {
        return null;
    }
    const sequentialState = laneLifecycle(events, "SEQUENTIAL");
    if (sequentialState === null) {
        return null;
    }
    const atomicState = laneLifecycle(events, "ATOMIC");
    const terminal = isTerminalState(sequentialState)
        ? sequentialState
        : null;
    const stepIndex = RAIL_INDEX[sequentialState];
    const statusAt = (index: number): RailStatus =>
        index < stepIndex ? "done" : index === stepIndex ? "current" : "ahead";
    const terminalStep = terminalCopy(terminal);
    const steps: RailStep[] = [
        { ...NEW_COPY, status: statusAt(0), tone: "neutral" },
        { ...ACK_COPY, status: statusAt(1), tone: "neutral" },
        { ...PAYING_COPY, status: statusAt(2), tone: "amber" },
        {
            ...terminalStep,
            status: statusAt(3),
            tone: terminalTone(terminal),
        },
    ];
    return {
        current: sequentialState,
        terminal,
        steps,
        sequentialState,
        atomicState,
    };
}

/** Result of comparing the rebuilt hash with the recorded one. */
export type HashCheck = "match" | "mismatch" | "absent";

/** Everything the header card renders for one run. */
export interface TicketView {
    /** Rebuilt canonical ticket (lifecycle frozen at NEW, as the engine writes it). */
    ticket: TradeTicket;
    /** Lifecycle derived from the run's events, shown as CURRENT. */
    lifecycle: LifecycleState;
    /** Whether the rebuilt hash matches the TICKET_CREATED record. */
    hashCheck: HashCheck;
    /** The recorded hash, when a TICKET_CREATED record carried one. */
    recordedHash: string | null;
}

/** Inputs the derivation needs; any missing piece yields the empty state. */
export interface TicketViewInput {
    scenario: ScenarioSpec | null;
    partyAWallet: string | null;
    partyBWallet: string | null;
    events: readonly RaceEvent[];
}

/**
 * Derive the ticket view for the last run, or null for the empty state:
 * no run yet (no events), or no scenario or wallet available to rebuild
 * from. The cheap checks run first; a non empty wallet that then fails
 * ticket validation throws from buildTicket, which signals a programming
 * error rather than an empty state.
 */
export function deriveTicketView(
    input: TicketViewInput,
): TicketView | null {
    const { scenario, partyAWallet, partyBWallet, events } = input;
    if (scenario === null || partyAWallet === null || partyBWallet === null) {
        return null;
    }
    if (partyAWallet.length === 0 || partyBWallet.length === 0) {
        return null;
    }
    if (events.length === 0) {
        return null;
    }
    const ticket = buildRunTicket(scenario, partyAWallet, partyBWallet);
    const recordedHash = recordedTicketHash(events);
    const hashCheck: HashCheck =
        recordedHash === null
            ? "absent"
            : recordedHash === ticket.ticket_hash
              ? "match"
              : "mismatch";
    const lifecycle = laneLifecycle(events, "SEQUENTIAL") ?? "NEW";
    return { ticket, lifecycle, hashCheck, recordedHash };
}

/**
 * Format rate_scaled as a decimal with six places, integer math only:
 * "1350000" becomes "1.350000". Ratios are formatted for display only
 * and never used in money math (tradeops section 1.2).
 *
 * @throws Error for a non integer string, or a non positive integer scale.
 */
export function formatRateScaled(
    rateScaled: string,
    rateScale: number = 1_000_000,
): string {
    if (!INTEGER_STRING.test(rateScaled)) {
        throw new Error(
            `formatRateScaled: not an integer string: ${JSON.stringify(rateScaled)}`,
        );
    }
    if (!Number.isSafeInteger(rateScale) || rateScale <= 0) {
        throw new Error(
            `formatRateScaled: rateScale must be a positive integer: ${rateScale}`,
        );
    }
    const decimals = rateScale.toString().length - 1;
    const value = BigInt(rateScaled);
    const scale = BigInt(rateScale);
    const whole = value / scale;
    const frac = value % scale;
    return `${whole}.${frac.toString().padStart(decimals, "0")}`;
}

/** Shorten a 64 hex hash for the card: head characters then tail. */
export function shortHash(hash: string, head = 10, tail = 8): string {
    if (hash.length <= head + tail + 3) {
        return hash;
    }
    return `${hash.slice(0, head)}...${hash.slice(-tail)}`;
}

/** Shorten a base58 wallet for the card: head characters then tail. */
export function truncateWallet(wallet: string, head = 5, tail = 5): string {
    if (wallet.length <= head + tail + 3) {
        return wallet;
    }
    return `${wallet.slice(0, head)}...${wallet.slice(-tail)}`;
}

/** One row of the schema reference (tradeops section 1.1 field table). */
export interface TicketFieldDoc {
    field: string;
    type: string;
    meaning: string;
}

/**
 * All 22 rows of the schema version 1 field table: the 20 ticket keys
 * with party_a and party_b expanded to their desk and wallet leaves, so
 * a reviewer sees the whole FIX inspired shape in one place.
 */
export const TICKET_FIELD_DOCS: readonly TicketFieldDoc[] = [
    {
        field: "schema_version",
        type: "literal 1",
        meaning: "Ticket schema version; any other value is rejected.",
    },
    {
        field: "ticket_id",
        type: "string",
        meaning: "Unique trade reference for the race.",
    },
    {
        field: "cl_ord_id",
        type: "string",
        meaning: "Client order id carried from the order side for audit continuity.",
    },
    {
        field: "trade_date",
        type: "string, YYYY-MM-DD",
        meaning: "Date the trade was agreed.",
    },
    {
        field: "value_date",
        type: "string, YYYY-MM-DD",
        meaning: "Settlement value date; the toy does not enforce business day calendars.",
    },
    {
        field: "symbol",
        type: 'literal "USD/CAD"',
        meaning: "The only pair this project trades.",
    },
    {
        field: "side",
        type: '"BUY_CAD" or "SELL_CAD"',
        meaning: "Direction from party A's perspective.",
    },
    {
        field: "party_a.desk_id",
        type: "string",
        meaning: "Party A desk identifier.",
    },
    {
        field: "party_a.wallet",
        type: "string, base58",
        meaning: "Party A Solana wallet.",
    },
    {
        field: "party_b.desk_id",
        type: "string",
        meaning: "Party B desk identifier.",
    },
    {
        field: "party_b.wallet",
        type: "string, base58",
        meaning: "Party B Solana wallet.",
    },
    {
        field: "base_ccy",
        type: 'literal "USD"',
        meaning: "Base currency of the pair.",
    },
    {
        field: "base_amount_cents",
        type: "string, non negative integer",
        meaning: "Leg 1 notional in USD cents, decimal integer string.",
    },
    {
        field: "quote_ccy",
        type: 'literal "CAD"',
        meaning: "Quote currency of the pair.",
    },
    {
        field: "quote_amount_cents",
        type: "string, non negative integer",
        meaning: "Leg 2 notional in CAD cents, decimal integer string.",
    },
    {
        field: "rate_scaled",
        type: "string, integer",
        meaning: 'Execution rate times rate_scale; 1.350000 is stored as "1350000".',
    },
    {
        field: "rate_scale",
        type: "literal 1000000",
        meaning: "Six decimal places of rate precision.",
    },
    {
        field: "settlement_path",
        type: '"SEQUENTIAL" or "ATOMIC"',
        meaning: "Route: pay first with a gap, or atomic delivery versus payment.",
    },
    {
        field: "scenario",
        type: "ScenarioKind",
        meaning: "Replay behavior: one of the five scenario kinds.",
    },
    {
        field: "gap_ms",
        type: "string, non negative integer",
        meaning: "Gap window in milliseconds on the sequential path.",
    },
    {
        field: "lifecycle",
        type: "LifecycleState",
        meaning: "Current state on the lifecycle rail.",
    },
    {
        field: "ticket_hash",
        type: "string, 64 hex",
        meaning: "SHA-256 of the canonical ticket JSON with ticket_hash omitted.",
    },
];
