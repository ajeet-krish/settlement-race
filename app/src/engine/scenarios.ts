/**
 * Scenario catalogue: the five replays the race UI offers.
 *
 * Amounts are integer cents (bigint), the gap is a decimal string of
 * milliseconds, and fund_bps is the integer basis points encoding of the
 * leg2_funding_multiplier (10000 bps equals full funding, 9000 bps equals
 * 0.9). Expected terminals say how each path ends when the engine drives the
 * scenario honestly.
 */

import type { LifecycleState, ScenarioKind } from "../lib/ticket";

/** What the misbehaving bot does during a scenario run. */
export type BotBehavior =
    | "honest"
    | "default_after_leg1"
    | "late_payment"
    | "partial_payment"
    | "none";

/** Static definition of one race scenario. */
export interface ScenarioSpec {
    kind: ScenarioKind;
    label: string;
    description: string;
    /** Gap window between the legs, decimal milliseconds string. */
    gap_ms: string;
    /** Leg 1 notional in USD cents. */
    leg1_usd_cents: bigint;
    /** Leg 2 notional in CAD cents. */
    leg2_cad_cents: bigint;
    /**
     * Basis points of leg 2 party B funds, applied identically in both lanes
     * so they start equal: 10000 means full funding, 9000 means 0.9
     * (the atomic_revert case), 6000 means 0.6 (the partial_payment case).
     */
    fund_bps: number;
    bot_behavior: BotBehavior;
    /** Terminal lifecycle of the sequential (pay first) path. */
    expected_sequential_terminal: LifecycleState;
    /** Terminal lifecycle of the atomic (delivery-versus-payment) path. */
    expected_atomic_terminal: LifecycleState;
}

/** USD 10,000.00 in cents. */
export const LEG1_USD_CENTS = 1_000_000n;
/** CAD 13,500.00 in cents, the 1.350000 counter leg. */
export const LEG2_CAD_CENTS = 1_350_000n;
/** Default gap window: 5 seconds of virtual time. */
export const DEFAULT_GAP_MS = "5000";

/** All five scenarios in presentation order. */
export const SCENARIOS: readonly ScenarioSpec[] = [
    {
        kind: "honest",
        label: "Honest both sides",
        description:
            "Both sides pay on time; sequential settles after the gap, atomic in one transaction.",
        gap_ms: DEFAULT_GAP_MS,
        leg1_usd_cents: LEG1_USD_CENTS,
        leg2_cad_cents: LEG2_CAD_CENTS,
        fund_bps: 10000,
        bot_behavior: "honest",
        expected_sequential_terminal: "SETTLED",
        expected_atomic_terminal: "SETTLED",
    },
    {
        kind: "default_after_leg1",
        label: "Default after leg 1",
        description:
            "Party B takes the USD leg and never pays CAD; sequential defaults, atomic settles.",
        gap_ms: DEFAULT_GAP_MS,
        leg1_usd_cents: LEG1_USD_CENTS,
        leg2_cad_cents: LEG2_CAD_CENTS,
        fund_bps: 10000,
        bot_behavior: "default_after_leg1",
        expected_sequential_terminal: "DEFAULTED",
        expected_atomic_terminal: "SETTLED",
    },
    {
        kind: "late_payment",
        label: "Late payment",
        description:
            "Party B pays only at gap expiry; sequential settles late, atomic has no window.",
        gap_ms: DEFAULT_GAP_MS,
        leg1_usd_cents: LEG1_USD_CENTS,
        leg2_cad_cents: LEG2_CAD_CENTS,
        fund_bps: 10000,
        bot_behavior: "late_payment",
        expected_sequential_terminal: "SETTLED",
        expected_atomic_terminal: "SETTLED",
    },
    {
        kind: "atomic_revert",
        label: "Atomic revert",
        description:
            "Leg two is funded at 90 percent; sequential partially pays then defaults, atomic reverts.",
        gap_ms: DEFAULT_GAP_MS,
        leg1_usd_cents: LEG1_USD_CENTS,
        leg2_cad_cents: LEG2_CAD_CENTS,
        fund_bps: 9000,
        bot_behavior: "none",
        expected_sequential_terminal: "DEFAULTED",
        expected_atomic_terminal: "FAILED",
    },
    {
        kind: "partial_payment",
        label: "Partial payment",
        description:
            "Party B pays 60 percent of CAD then stops; sequential defaults, atomic reverts.",
        gap_ms: DEFAULT_GAP_MS,
        leg1_usd_cents: LEG1_USD_CENTS,
        leg2_cad_cents: LEG2_CAD_CENTS,
        fund_bps: 6000,
        bot_behavior: "partial_payment",
        expected_sequential_terminal: "DEFAULTED",
        expected_atomic_terminal: "FAILED",
    },
];

/** Look up one scenario by kind. */
export function getScenario(kind: ScenarioKind): ScenarioSpec {
    const found = SCENARIOS.find((spec) => spec.kind === kind);
    if (found === undefined) {
        throw new Error(`getScenario: unknown scenario kind: ${kind}`);
    }
    return found;
}
