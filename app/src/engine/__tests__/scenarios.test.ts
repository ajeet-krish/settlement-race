import { describe, expect, it } from "vitest";
import { SCENARIOS, DEFAULT_GAP_MS, getScenario } from "../scenarios";
import type { LifecycleState } from "../../lib/ticket";

const TERMINALS: readonly LifecycleState[] = [
    "NEW",
    "ACK",
    "PAYING",
    "SETTLED",
    "FAILED",
    "DEFAULTED",
];

describe("scenarios", () => {
    it("defines all five scenarios exactly once", () => {
        expect(SCENARIOS).toHaveLength(5);
        const kinds = SCENARIOS.map((spec) => spec.kind);
        expect(new Set(kinds).size).toBe(5);
        expect(kinds).toContain("honest");
        expect(kinds).toContain("default_after_leg1");
        expect(kinds).toContain("late_payment");
        expect(kinds).toContain("atomic_revert");
        expect(kinds).toContain("partial_payment");
    });

    it("uses integer cent amounts and a string gap", () => {
        for (const spec of SCENARIOS) {
            expect(typeof spec.leg1_usd_cents).toBe("bigint");
            expect(typeof spec.leg2_cad_cents).toBe("bigint");
            expect(spec.leg1_usd_cents).toBeGreaterThan(0n);
            expect(spec.leg2_cad_cents).toBeGreaterThan(0n);
            expect(spec.gap_ms).toMatch(/^\d+$/);
        }
    });

    it("prices scenario funding in basis points", () => {
        expect(getScenario("atomic_revert").fund_bps).toBe(9000);
        expect(getScenario("honest").fund_bps).toBe(10000);
        expect(getScenario("partial_payment").fund_bps).toBe(6000);
    });

    it("keeps every expected terminal inside the lifecycle set", () => {
        for (const spec of SCENARIOS) {
            expect(TERMINALS).toContain(spec.expected_sequential_terminal);
            expect(TERMINALS).toContain(spec.expected_atomic_terminal);
        }
    });

    it("ends the atomic lane in failure and the sequential lane in default on revert", () => {
        const revert = getScenario("atomic_revert");
        expect(revert.expected_atomic_terminal).toBe("FAILED");
        expect(revert.expected_sequential_terminal).toBe("DEFAULTED");
        expect(revert.bot_behavior).toBe("none");
    });

    it("keeps partial payment defaulted with a partial sequential payment", () => {
        const partial = getScenario("partial_payment");
        expect(partial.expected_sequential_terminal).toBe("DEFAULTED");
        expect(partial.expected_atomic_terminal).toBe("FAILED");
        expect(partial.bot_behavior).toBe("partial_payment");
    });

    it("getScenario throws on an unknown kind", () => {
        expect(() =>
            getScenario("no_such_scenario" as never),
        ).toThrow(/unknown scenario/);
    });

    it("keeps fund_bps an integer basis points value inside 0 to 10000", () => {
        for (const spec of SCENARIOS) {
            expect(Number.isInteger(spec.fund_bps)).toBe(true);
            expect(spec.fund_bps).toBeGreaterThanOrEqual(0);
            expect(spec.fund_bps).toBeLessThanOrEqual(10000);
        }
    });

    it("settles the atomic lane only at full funding and keeps spec fields in the documented sets", () => {
        const behaviors = [
            "honest",
            "default_after_leg1",
            "late_payment",
            "partial_payment",
            "none",
        ];
        for (const spec of SCENARIOS) {
            // Atomic delivery-versus-payment succeeds only when leg 2 is
            // funded to 10000 bps; anything less reverts the whole tx.
            const atomicSettles = spec.expected_atomic_terminal === "SETTLED";
            expect(atomicSettles).toBe(spec.fund_bps === 10000);
            expect(behaviors).toContain(spec.bot_behavior);
            expect(spec.gap_ms).toBe(DEFAULT_GAP_MS);
        }
    });
});
