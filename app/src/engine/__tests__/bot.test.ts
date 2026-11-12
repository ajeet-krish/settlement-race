import { describe, expect, it } from "vitest";
import { SCENARIOS, getScenario } from "../scenarios";
import { behaviorFor, leg2Action, paysAfterGap, paysAfterLeg1 } from "../bot";

describe("bot", () => {
    it("mirrors each spec's bot_behavior field", () => {
        for (const spec of SCENARIOS) {
            expect(behaviorFor(spec.kind)).toBe(spec.bot_behavior);
        }
        expect(behaviorFor("atomic_revert")).toBe("none");
    });

    it("pays after leg 1 only for the paying behaviors", () => {
        expect(paysAfterLeg1(getScenario("honest"))).toBe(true);
        expect(paysAfterLeg1(getScenario("late_payment"))).toBe(true);
        expect(paysAfterLeg1(getScenario("partial_payment"))).toBe(true);
        expect(paysAfterLeg1(getScenario("default_after_leg1"))).toBe(false);
        expect(paysAfterLeg1(getScenario("atomic_revert"))).toBe(false);
    });

    it("picks the leg 2 action and the gap payment per scenario", () => {
        expect(leg2Action(getScenario("honest"))).toEqual({ kind: "full" });
        expect(leg2Action(getScenario("late_payment"))).toEqual({ kind: "full" });
        expect(leg2Action(getScenario("default_after_leg1"))).toEqual({ kind: "refuse" });
        expect(leg2Action(getScenario("atomic_revert"))).toEqual({
            kind: "partial",
            amount_bps: 9000,
        });
        expect(leg2Action(getScenario("partial_payment"))).toEqual({
            kind: "partial",
            amount_bps: 6000,
        });
        expect(paysAfterGap(getScenario("late_payment"))).toBe(true);
        for (const spec of SCENARIOS) {
            if (spec.kind !== "late_payment") {
                expect(paysAfterGap(spec)).toBe(false);
            }
        }
    });
});
