import { describe, expect, it } from "vitest";
import { eventLabel, finalStatusFor, laneStatus, shortSig } from "../raceLabels";
import { makeEvent } from "./eventFixtures";

describe("shortSig", () => {
    it("keeps the first four and last four characters", () => {
        expect(shortSig("5Xj2QwErTyUiOpAsDfGhJkLm9kLm87654321")).toBe(
            "5Xj2...4321",
        );
    });

    it("returns short signatures unchanged and null when absent", () => {
        expect(shortSig("abc9")).toBe("abc9");
        expect(shortSig(undefined)).toBeNull();
        expect(shortSig(null)).toBeNull();
    });
});

describe("eventLabel", () => {
    it("names the funded leg on funding records", () => {
        const cad = makeEvent({
            event: "LEG_FUNDED",
            ts: 0n,
            data: { leg: "LEG2_CAD", amount_cents: "1350000" },
        });
        const usd = makeEvent({
            event: "LEG_FUNDED",
            ts: 0n,
            data: { leg: "LEG1_USD", amount_cents: "1000000" },
        });
        expect(eventLabel(cad)).toBe("Party B funds CAD leg");
        expect(eventLabel(usd)).toBe("Party A funds USD leg");
    });

    it("uses sentence case labels for plain events", () => {
        expect(
            eventLabel(makeEvent({ event: "LEG1_RELEASED", ts: 0n })),
        ).toBe("Leg 1 released");
        expect(
            eventLabel(makeEvent({ event: "DEFAULT_DECLARED", ts: 0n })),
        ).toBe("Default declared");
    });
});

describe("laneStatus", () => {
    it("reports NEW before any lane activity", () => {
        expect(laneStatus([], "SEQUENTIAL")).toBe("NEW");
        expect(laneStatus([], "ATOMIC")).toBe("NEW");
    });

    it("derives PAYING from the newest lane event", () => {
        const events = [
            makeEvent({ event: "RACE_STARTED", ts: 1_000n }),
            makeEvent({ event: "LEG1_RELEASED", ts: 2_000n }),
        ];
        expect(laneStatus(events, "SEQUENTIAL")).toBe("PAYING");
    });

    it("prefers the newest status snapshot for the lane", () => {
        const events = [
            makeEvent({ event: "ATOMIC_SETTLED", ts: 1_000n, lane: "ATOMIC" }),
            makeEvent({
                event: "DEFAULT_DECLARED",
                ts: 8_000n,
                status_snapshot: { sequential: "DEFAULTED", atomic: "SETTLED" },
            }),
        ];
        expect(laneStatus(events, "SEQUENTIAL")).toBe("DEFAULTED");
        expect(laneStatus(events, "ATOMIC")).toBe("SETTLED");
    });

    it("derives FAILED from the failure marker", () => {
        const events = [
            makeEvent({
                event: "ATOMIC_REVERTED",
                ts: 1_000n,
                lane: "ATOMIC",
            }),
            makeEvent({ event: "FAILED_MARKED", ts: 2_000n, lane: "ATOMIC" }),
        ];
        expect(laneStatus(events, "ATOMIC")).toBe("FAILED");
    });
});

describe("finalStatusFor", () => {
    it("chips terminal events without snapshots", () => {
        const settled = makeEvent({ event: "ATOMIC_SETTLED", ts: 1n, lane: "ATOMIC" });
        const inFlight = makeEvent({ event: "LEG1_RELEASED", ts: 1n });
        expect(finalStatusFor(settled, "ATOMIC")).toBe("SETTLED");
        expect(finalStatusFor(inFlight, "SEQUENTIAL")).toBeNull();
    });

    it("reads this lane's value from a status snapshot", () => {
        const final = makeEvent({
            event: "LEG2_RELEASED",
            ts: 7_000n,
            status_snapshot: { sequential: "SETTLED", atomic: "FAILED" },
        });
        expect(finalStatusFor(final, "SEQUENTIAL")).toBe("SETTLED");
        expect(finalStatusFor(final, "ATOMIC")).toBe("FAILED");
    });
});
