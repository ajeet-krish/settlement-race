/**
 * Counterparty bot: the scripted Party B behavior the scenario engine
 * replays while it drives both lanes of one ticket.
 *
 * This module only answers questions: it never moves money and never reads
 * the clock. Amounts stay integer cents (bigint) in scenarios.ts and integer
 * basis points here, so no float can reach a payout decision. Timing (when a
 * decision fires relative to the gap window) belongs to the engine.
 */

import type { ScenarioKind } from "../lib/ticket";
import type { BotBehavior, ScenarioSpec } from "./scenarios";

/**
 * Re-exported from scenarios.ts so `behaviorFor` and `ScenarioSpec.bot_behavior`
 * stay one type. The members are honest, default_after_leg1, late_payment,
 * partial_payment, none (the architecture doc sketch defaultAfterLeg1,
 * latePayment, partialPayment refers to the same values, spelled as the spec
 * spells them).
 */
export type { BotBehavior };

/** What party B does with leg 2 after leg 1 has released. */
export type Leg2Action =
    | { kind: "full" }
    | { kind: "partial"; amount_bps: number }
    | { kind: "refuse" };

/**
 * Scripted behavior for one scenario kind.
 *
 * Mirrors ScenarioSpec.bot_behavior for every entry in SCENARIOS: honest maps
 * to honest, default_after_leg1 maps to default_after_leg1, late_payment maps
 * to late_payment, atomic_revert maps to none, partial_payment maps to
 * partial_payment. atomic_revert is "none" because the bot makes no choice
 * there: the engine drives the mechanical partial payment at fund_bps itself.
 */
export function behaviorFor(kind: ScenarioKind): BotBehavior {
    switch (kind) {
        case "honest":
            return "honest";
        case "default_after_leg1":
            return "default_after_leg1";
        case "late_payment":
            return "late_payment";
        case "atomic_revert":
            return "none";
        case "partial_payment":
            return "partial_payment";
    }
}

/**
 * True when party B pays leg 2 after the engine releases leg 1 on the
 * sequential lane.
 *
 * honest pays on time, late_payment pays after the gap expiry, and
 * partial_payment pays part of the leg. default_after_leg1 pays nothing.
 * atomic_revert (bot_behavior "none") returns false too: the engine drives
 * the mechanical partial payment itself, so the bot never acts.
 */
export function paysAfterLeg1(spec: ScenarioSpec): boolean {
    switch (behaviorFor(spec.kind)) {
        case "honest":
        case "late_payment":
        case "partial_payment":
            return true;
        case "default_after_leg1":
        case "none":
            return false;
    }
}

/**
 * Party B's leg 2 action once leg 1 releases on the sequential lane.
 *
 * honest and late_payment pay the full leg, with late_payment paying only
 * after the gap expiry (the engine owns that timing). default_after_leg1
 * refuses. atomic_revert and partial_payment pay the mechanical partial at
 * the spec's fund_bps (9000 and 6000), an integer basis points value.
 */
export function leg2Action(spec: ScenarioSpec): Leg2Action {
    switch (spec.kind) {
        case "honest":
            return { kind: "full" };
        case "late_payment":
            return { kind: "full" };
        case "default_after_leg1":
            return { kind: "refuse" };
        case "atomic_revert":
        case "partial_payment":
            return { kind: "partial", amount_bps: spec.fund_bps };
    }
}

/**
 * True only for late_payment: party B pays after the gap expiry but before
 * declare_default runs, so the payment is still accepted and the provenance
 * record is stamped late. Every other scenario pays before the gap, refuses,
 * or never reaches a payment.
 */
export function paysAfterGap(spec: ScenarioSpec): boolean {
    return behaviorFor(spec.kind) === "late_payment";
}

/**
 * The three scripted decisions the scenario engine asks for while it drives
 * one lane. Chunk B wires these into ScenarioEngine.
 */
export interface BotDecision {
    /** Whether the bot pays leg 2 after leg 1 releases. */
    paysAfterLeg1(spec: ScenarioSpec): boolean;
    /** What the bot does with leg 2 after leg 1 releases. */
    leg2Action(spec: ScenarioSpec): Leg2Action;
    /** Whether the bot pays in the gap window before declare_default. */
    paysAfterGap(spec: ScenarioSpec): boolean;
}

/** The scripted decisions defined in this module. */
export const botDecision: BotDecision = { paysAfterLeg1, leg2Action, paysAfterGap };
