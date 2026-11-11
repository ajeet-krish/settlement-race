import { describe, expect, it } from "vitest";
import { VirtualClock } from "../clock";

describe("VirtualClock", () => {
    it("starts at zero by default", () => {
        expect(new VirtualClock().now()).toBe(0n);
    });

    it("accepts an initial time", () => {
        expect(new VirtualClock(1_000n).now()).toBe(1_000n);
    });

    it("rejects a negative initial time", () => {
        expect(() => new VirtualClock(-1n)).toThrow();
    });

    it("advances forward", () => {
        const clock = new VirtualClock();
        clock.advance(100n);
        expect(clock.now()).toBe(100n);
        clock.advance(2_500n);
        expect(clock.now()).toBe(2_500n);
    });

    it("throws on time regression", () => {
        const clock = new VirtualClock();
        clock.advance(100n);
        expect(() => clock.advance(99n)).toThrow(/regression/);
        expect(clock.now()).toBe(100n);
    });

    it("allows an equal advance (no regression)", () => {
        const clock = new VirtualClock();
        clock.advance(100n);
        expect(() => clock.advance(100n)).not.toThrow();
        expect(clock.now()).toBe(100n);
    });

    it("runs callbacks when the clock reaches them", () => {
        const clock = new VirtualClock();
        const calls: string[] = [];
        clock.schedule(50n, () => calls.push("early"));
        clock.schedule(100n, () => calls.push("late"));

        clock.advance(49n);
        expect(calls).toEqual([]);
        expect(clock.pendingCount).toBe(2);

        clock.advance(50n);
        expect(calls).toEqual(["early"]);
        expect(clock.pendingCount).toBe(1);

        clock.advance(200n);
        expect(calls).toEqual(["early", "late"]);
        expect(clock.pendingCount).toBe(0);
    });

    it("runs due callbacks in time order, not schedule order", () => {
        const clock = new VirtualClock();
        const calls: string[] = [];
        clock.schedule(30n, () => calls.push("b"));
        clock.schedule(10n, () => calls.push("a"));
        clock.schedule(20n, () => calls.push("c"));
        clock.advance(1_000n);
        expect(calls).toEqual(["a", "c", "b"]);
    });

    it("runs a callback scheduled in the past on the next advance", () => {
        const clock = new VirtualClock(500n);
        const calls: number[] = [];
        clock.schedule(100n, () => calls.push(1));
        clock.advance(600n);
        expect(calls).toEqual([1]);
    });

    it("keeps time monotonic across many advances", () => {
        const clock = new VirtualClock();
        for (let i = 0; i < 100; i++) {
            clock.advance(BigInt(i * 10));
        }
        expect(clock.now()).toBe(990n);
        expect(() => clock.advance(989n)).toThrow();
    });

    it("breaks ties between equal timestamps by insertion order", () => {
        const clock = new VirtualClock();
        const calls: string[] = [];
        clock.schedule(100n, () => calls.push("first"));
        clock.schedule(100n, () => calls.push("second"));
        clock.schedule(50n, () => calls.push("early"));
        clock.schedule(100n, () => calls.push("third"));
        clock.advance(100n);
        expect(calls).toEqual(["early", "first", "second", "third"]);
        expect(clock.pendingCount).toBe(0);
    });

    it("runs a callback scheduled from inside a callback on the next advance", () => {
        const clock = new VirtualClock();
        const calls: string[] = [];
        clock.schedule(100n, () => {
            calls.push("outer");
            clock.schedule(100n, () => calls.push("inner"));
        });
        clock.advance(100n);
        expect(calls).toEqual(["outer"]);
        expect(clock.pendingCount).toBe(1);
        // An equal advance still runs due callbacks, so the inner callback
        // fires here rather than recursively inside the outer one.
        clock.advance(100n);
        expect(calls).toEqual(["outer", "inner"]);
        expect(clock.pendingCount).toBe(0);
    });

    it("rejects scheduling at a negative virtual time", () => {
        const clock = new VirtualClock();
        expect(() => clock.schedule(-1n, () => undefined)).toThrow(
            /non negative/,
        );
        expect(clock.pendingCount).toBe(0);
    });
});
