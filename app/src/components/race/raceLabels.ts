/**
 * Presentational helpers over race events: marker abbreviations, human
 * labels, short transaction hashes, and per lane status derivation.
 *
 * All pure, all string work, so the components stay render only.
 */

import type { RaceEvent } from "../../engine/scenarioEngine";
import type { EventType } from "../../lib/provenance";
import type { LifecycleState, SettlementPathName } from "../../lib/ticket";

/** Short mono abbreviation for each event kind, used on timeline markers. */
export const EVENT_ABBREV: Readonly<Record<EventType, string>> = {
    TICKET_CREATED: "TKT",
    ACK_A: "AKA",
    ACK_B: "AKB",
    LEG_FUNDED: "FND",
    RACE_STARTED: "GO",
    LEG1_RELEASED: "L1",
    LEG2_RELEASED: "L2",
    LEG2_PARTIAL: "L2P",
    DEFAULT_DECLARED: "DEF",
    ATOMIC_SETTLED: "STL",
    ATOMIC_REVERTED: "RVT",
    FAILED_MARKED: "FLD",
    CLOCK_ADVANCED: "CLK",
    CHAIN_ANCHORED: "ANC",
};

/** Default sentence case label for each event kind. */
const EVENT_LABELS: Readonly<Record<EventType, string>> = {
    TICKET_CREATED: "Ticket created",
    ACK_A: "Party A acknowledges",
    ACK_B: "Party B acknowledges",
    LEG_FUNDED: "Leg funded",
    RACE_STARTED: "Race started",
    LEG1_RELEASED: "Leg 1 released",
    LEG2_RELEASED: "Leg 2 released",
    LEG2_PARTIAL: "Leg 2 partial payment",
    DEFAULT_DECLARED: "Default declared",
    ATOMIC_SETTLED: "Atomic settlement",
    ATOMIC_REVERTED: "Atomic attempt reverted",
    FAILED_MARKED: "Atomic lane marked failed",
    CLOCK_ADVANCED: "Virtual clock advanced",
    CHAIN_ANCHORED: "Chain head anchored",
};

/** Lifecycle values a status snapshot may legally carry. */
const LIFECYCLES: readonly string[] = [
    "NEW",
    "ACK",
    "PAYING",
    "SETTLED",
    "FAILED",
    "DEFAULTED",
];

function isLifecycle(value: string): value is LifecycleState {
    return LIFECYCLES.includes(value);
}

/** Human label for one event; funding records name the funded leg. */
export function eventLabel(event: RaceEvent): string {
    if (event.event === "LEG_FUNDED") {
        return event.provenance.data.leg === "LEG2_CAD"
            ? "Party B funds CAD leg"
            : "Party A funds USD leg";
    }
    return EVENT_LABELS[event.event];
}

/**
 * First four and last four characters of a transaction signature, for
 * example "5Xj2...9kLm". Returns null when the record carries no
 * signature, which is honest for a reverted transaction.
 */
export function shortSig(sig: string | undefined | null): string | null {
    if (!sig) {
        return null;
    }
    if (sig.length <= 8) {
        return sig;
    }
    return `${sig.slice(0, 4)}...${sig.slice(-4)}`;
}

/**
 * Terminal status of one lane as of the latest event, for the lane header
 * and marker chips: the last status snapshot wins, otherwise the newest
 * lane event's terminal meaning is derived, otherwise NEW before the race
 * and PAYING once money is moving.
 */
export function laneStatus(
    events: readonly RaceEvent[],
    lane: SettlementPathName,
): LifecycleState {
    const laneEvents = events.filter((e) => e.lane === lane);
    for (let i = laneEvents.length - 1; i >= 0; i--) {
        const snapshot = laneEvents[i]!.status_snapshot;
        if (snapshot === undefined) {
            continue;
        }
        const value = lane === "SEQUENTIAL" ? snapshot.sequential : snapshot.atomic;
        if (isLifecycle(value)) {
            return value;
        }
    }
    const last = laneEvents[laneEvents.length - 1];
    if (last === undefined) {
        return "NEW";
    }
    return derivedStatus(last);
}

/**
 * Status chip for a final marker, or null while the event is still in
 * flight. Snapshots win; terminal events without snapshots derive it.
 */
export function finalStatusFor(
    event: RaceEvent,
    lane: SettlementPathName,
): LifecycleState | null {
    const snapshot = event.status_snapshot;
    if (snapshot !== undefined) {
        const value = lane === "SEQUENTIAL" ? snapshot.sequential : snapshot.atomic;
        if (isLifecycle(value)) {
            return value;
        }
    }
    switch (event.event) {
        case "LEG2_RELEASED":
        case "ATOMIC_SETTLED":
            return "SETTLED";
        case "DEFAULT_DECLARED":
            return "DEFAULTED";
        case "FAILED_MARKED":
            return "FAILED";
        default:
            return null;
    }
}

/** Derive a lane status from its newest event when no snapshot exists. */
function derivedStatus(event: RaceEvent): LifecycleState {
    switch (event.event) {
        case "FAILED_MARKED":
            return "FAILED";
        case "DEFAULT_DECLARED":
            return "DEFAULTED";
        case "LEG2_RELEASED":
        case "ATOMIC_SETTLED":
            return "SETTLED";
        case "RACE_STARTED":
        case "LEG1_RELEASED":
        case "LEG2_PARTIAL":
        case "ATOMIC_REVERTED":
            return "PAYING";
        default:
            return "NEW";
    }
}
