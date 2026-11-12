import { describe, expect, it, vi } from "vitest";

/**
 * Pure formula coverage for nextScenarioIdBase. The base is module
 * scoped state (lastScenarioIdBase), so every case that needs the exact
 * documented formula ((now mod 1_000_000) * 2 + 1) re-imports a fresh
 * raceSource module through vi.resetModules; a static import would carry
 * the bump history of earlier cases in this file.
 */

/** Fresh raceSource instance, then one base call on its empty session. */
async function freshBase(nowMs: number): Promise<bigint> {
    vi.resetModules();
    const mod = await import("../raceSource");
    return mod.nextScenarioIdBase(nowMs);
}

describe("nextScenarioIdBase: documented formula", () => {
    it("returns ((now mod 1e6) * 2 + 1) exactly on a fresh session", async () => {
        const nowMs = 1_700_000_123_456;
        const base = await freshBase(nowMs);

        const expected = (BigInt(nowMs) % 1_000_000n) * 2n + 1n;
        expect(base).toBe(246_913n);
        expect(base).toBe(expected);
        expect(base % 2n).toBe(1n);
    });

    it("is odd and exact at the modulus boundaries", async () => {
        const cases: Array<[number, bigint]> = [
            [0, 1n],
            [1, 3n],
            [999_999, 1_999_999n],
            [1_000_000, 1n],
            [2_500_000_999_999, 1_999_999n],
        ];
        for (const [nowMs, expected] of cases) {
            const base = await freshBase(nowMs);
            expect(base, `nowMs=${nowMs}`).toBe(expected);
            expect(base % 2n, `nowMs=${nowMs}`).toBe(1n);
        }
    });

    it("never hands out the same base twice in one session", async () => {
        vi.resetModules();
        const mod = await import("../raceSource");
        const first = mod.nextScenarioIdBase(1_700_000_999_999);
        const second = mod.nextScenarioIdBase(1_700_000_999_999);
        const earlier = mod.nextScenarioIdBase(1_700_000_123_456);

        expect(first).toBe(1_999_999n);
        expect(second).toBe(first + 2n);
        // A time going backwards (or a repeat) still steps strictly up.
        expect(earlier).toBe(second + 2n);
        expect(earlier > second).toBe(true);
        expect(earlier % 2n).toBe(1n);
    });
});
