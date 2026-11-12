/**
 * Balance derivation for the race view, computed from provenance events.
 *
 * The panel reads the sequential (pay first) path only, because that is
 * the lane where money moves step by step: the atomic lane either moves
 * both legs inside one transaction or reverts with nothing moved, which
 * its status chips and event log already tell. Parsing is conservative:
 * only the amount fields the engine actually records are read, and any
 * value that cannot be derived yet comes back null so the UI shows
 * "awaiting event" instead of guessing.
 *
 * Money stays integer cents (bigint) end to end; formatting happens in
 * the component with money.fmt.
 */

import type { RaceEvent } from "../../engine/scenarioEngine";
import { parse_cents } from "../../lib/money";

/** One party's token deltas in cents, or null while awaiting an event. */
export interface PartyDelta {
    /** tUSD delta, negative when the party paid USD out. */
    t_usd: bigint | null;
    /** tCAD delta, negative when the party paid CAD out. */
    t_cad: bigint | null;
}

/** Derived race balances and the quantified default loss. */
export interface RaceBalances {
    party_a: PartyDelta;
    party_b: PartyDelta;
    /** True when DEFAULT_DECLARED closed the sequential lane. */
    defaulted: boolean;
    /** Party A's lost leg 1 USD cents when defaulted, else null. */
    loss_usd: bigint | null;
}

/**
 * Parse one integer cents field out of a provenance record's data.
 * Returns undefined when the field is absent (the event never happened)
 * and null when it is present but not a parsable integer string (the
 * event happened but the amount cannot be trusted yet).
 */
function parseCentsField(
    data: Record<string, string | number | boolean>,
    key: string,
): bigint | null | undefined {
    const raw = data[key];
    if (raw === undefined) {
        return undefined;
    }
    if (typeof raw === "number") {
        return Number.isInteger(raw) ? BigInt(raw) : null;
    }
    if (typeof raw !== "string") {
        return null;
    }
    try {
        return parse_cents(raw);
    } catch {
        return null;
    }
}

/**
 * Derive party A and party B tUSD and tCAD deltas plus the default loss
 * from an event stream.
 *
 * Rules, sequential lane only:
 *
 * - A's tUSD drops by the funded leg 1 amount once Party A funds it, and
 *   that outlay stands whether the run settles or defaults.
 * - A's tCAD rises by the paid CAD recorded on a release, partial, or
 *   default record, and is 0 before any payment record exists.
 * - B's tUSD rises by leg 1 only once LEG1_RELEASED moves it to B.
 * - B's tCAD drops by the CAD he funds into escrow; on default the unpaid
 *   remainder returns to B, so his net outlay becomes the paid amount.
 * - With no events at all every field is null, which the panel renders as
 *   "awaiting event".
 *
 * All events may be passed: records are filtered to SEQUENTIAL here.
 */
export function partyBalances(events: readonly RaceEvent[]): RaceBalances {
    if (events.length === 0) {
        return {
            party_a: { t_usd: null, t_cad: null },
            party_b: { t_usd: null, t_cad: null },
            defaulted: false,
            loss_usd: null,
        };
    }

    const seq = events.filter((e) => e.lane === "SEQUENTIAL");
    let leg1: bigint | null | undefined;
    let cadFunded: bigint | null | undefined;
    let paid: bigint | null | undefined;
    let leg1Released = false;
    let defaulted = false;

    for (const event of seq) {
        const data = event.provenance.data;
        if (event.event === "LEG_FUNDED") {
            if (data.leg === "LEG1_USD" && leg1 === undefined) {
                leg1 = parseCentsField(data, "amount_cents") ?? null;
            }
            if (data.leg === "LEG2_CAD" && cadFunded === undefined) {
                cadFunded = parseCentsField(data, "amount_cents") ?? null;
            }
        }
        if (
            event.event === "LEG2_RELEASED" ||
            event.event === "LEG2_PARTIAL" ||
            event.event === "DEFAULT_DECLARED"
        ) {
            const recorded = parseCentsField(data, "paid_cad_cents");
            paid = recorded === undefined ? null : recorded;
        }
        if (event.event === "LEG1_RELEASED") {
            leg1Released = true;
        }
        if (event.event === "DEFAULT_DECLARED") {
            defaulted = true;
        }
    }

    const aUsd: bigint | null =
        leg1 === undefined ? 0n : leg1 === null ? null : -leg1;
    const aCad: bigint | null = paid === undefined ? 0n : paid;
    let bUsd: bigint | null;
    if (!leg1Released) {
        bUsd = 0n;
    } else if (leg1 === undefined || leg1 === null) {
        bUsd = null;
    } else {
        bUsd = leg1;
    }
    let bCad: bigint | null;
    if (cadFunded === undefined) {
        bCad = 0n;
    } else if (cadFunded === null) {
        bCad = null;
    } else if (defaulted) {
        bCad = paid === undefined || paid === null ? null : -paid;
    } else {
        bCad = -cadFunded;
    }

    return {
        party_a: { t_usd: aUsd, t_cad: aCad },
        party_b: { t_usd: bUsd, t_cad: bCad },
        defaulted,
        loss_usd: defaulted ? leg1 ?? null : null,
    };
}
