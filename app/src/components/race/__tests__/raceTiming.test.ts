import { describe, expect, it } from "vitest";
import {
    SEGMENT_WALL_MS,
    displayVirtualMs,
    formatVirtualSeconds,
    playheadState,
    rescaleWallMs,
    riskWindow,
    snappedDisplayVirtualMs,
} from "../raceTiming";
import { makeEvent } from "./eventFixtures";

describe("displayVirtualMs", () => {
    it("returns 0n for a zero event stream", () => {
        expect(displayVirtualMs([], 0, 1)).toBe(0n);
        expect(displayVirtualMs([], 9_500, 2)).toBe(0n);
    });

    it("returns 0n for a single event (no interval to walk)", () => {
        const events = [makeEvent({ event: "TICKET_CREATED", ts: 5_000n })];
        expect(displayVirtualMs(events, 0, 1)).toBe(0n);
        expect(displayVirtualMs(events, 9_999, 2)).toBe(0n);
    });

    it("interpolates linearly between consecutive stamps", () => {
        const events = [
            makeEvent({ event: "RACE_STARTED", ts: 0n }),
            makeEvent({ event: "LEG1_RELEASED", ts: 1_000n }),
        ];
        expect(displayVirtualMs(events, 0, 1)).toBe(0n);
        expect(displayVirtualMs(events, SEGMENT_WALL_MS / 4, 1)).toBe(250n);
        expect(displayVirtualMs(events, SEGMENT_WALL_MS / 2, 1)).toBe(500n);
        expect(displayVirtualMs(events, SEGMENT_WALL_MS, 1)).toBe(1_000n);
    });

    it("scales playback with speed: 2x twice as fast, 0.5x half as fast", () => {
        const events = [
            makeEvent({ event: "RACE_STARTED", ts: 0n }),
            makeEvent({ event: "LEG1_RELEASED", ts: 1_000n }),
        ];
        const wall = SEGMENT_WALL_MS / 2;
        expect(displayVirtualMs(events, wall, 2)).toBe(1_000n);
        expect(displayVirtualMs(events, wall, 1)).toBe(500n);
        expect(displayVirtualMs(events, wall, 0.5)).toBe(250n);
    });

    it("clamps to the last event once the stream is crossed", () => {
        const events = [
            makeEvent({ event: "RACE_STARTED", ts: 1_000n }),
            makeEvent({ event: "LEG1_RELEASED", ts: 2_000n }),
            makeEvent({ event: "LEG2_RELEASED", ts: 4_000n }),
        ];
        expect(displayVirtualMs(events, 1_000_000, 1)).toBe(4_000n);
        expect(displayVirtualMs(events, 1_000_000, 2)).toBe(4_000n);
    });

    it("stays monotonic in wall time across a stream with duplicate stamps", () => {
        const events = [
            makeEvent({ event: "TICKET_CREATED", ts: 0n }),
            makeEvent({ event: "ACK_A", ts: 0n }),
            makeEvent({ event: "LEG1_RELEASED", ts: 2_000n }),
            makeEvent({ event: "LEG2_PARTIAL", ts: 2_000n }),
            makeEvent({ event: "DEFAULT_DECLARED", ts: 7_000n }),
        ];
        let previous = -1n;
        for (let wall = 0; wall <= 5_000; wall += 100) {
            const value = displayVirtualMs(events, wall, 1);
            expect(value >= previous).toBe(true);
            previous = value;
        }
        expect(previous).toBe(7_000n);
    });
});

describe("snappedDisplayVirtualMs", () => {
    const events = [
        makeEvent({ event: "RACE_STARTED", ts: 1_000n }),
        makeEvent({ event: "LEG1_RELEASED", ts: 2_000n }),
        makeEvent({ event: "LEG2_RELEASED", ts: 5_000n }),
    ];

    it("holds each segment's first stamp instead of interpolating", () => {
        expect(snappedDisplayVirtualMs(events, 0, 1)).toBe(1_000n);
        expect(snappedDisplayVirtualMs(events, SEGMENT_WALL_MS - 1, 1)).toBe(
            1_000n,
        );
        expect(snappedDisplayVirtualMs(events, SEGMENT_WALL_MS, 1)).toBe(2_000n);
        expect(snappedDisplayVirtualMs(events, 2 * SEGMENT_WALL_MS, 1)).toBe(
            5_000n,
        );
    });

    it("clamps to the last stamp and handles empty and single streams", () => {
        expect(snappedDisplayVirtualMs(events, 1_000_000, 2)).toBe(5_000n);
        expect(snappedDisplayVirtualMs([], 500, 1)).toBe(0n);
        expect(
            snappedDisplayVirtualMs(
                [makeEvent({ event: "TICKET_CREATED", ts: 300n })],
                500,
                1,
            ),
        ).toBe(0n);
    });
});

describe("rescaleWallMs", () => {
    it("preserves the segment position for every speed pair", () => {
        const pairs: ReadonlyArray<readonly [number, number]> = [
            [2, 0.5],
            [0.5, 2],
            [1, 2],
            [2, 1],
            [1, 0.5],
            [0.5, 1],
        ];
        for (const wall of [0, 1, 137, 500, 1_234, 10_000]) {
            for (const [from, to] of pairs) {
                expect(rescaleWallMs(wall, from, to)).toBe((wall * from) / to);
            }
        }
    });

    it("returns the value untouched for equal or non-positive speeds", () => {
        expect(rescaleWallMs(500, 2, 2)).toBe(500);
        expect(rescaleWallMs(500, 0, 2)).toBe(500);
        expect(rescaleWallMs(500, 2, 0)).toBe(500);
        expect(rescaleWallMs(0, 2, 0.5)).toBe(0);
    });
});

describe("speed changes mid playback", () => {
    const stream = [
        makeEvent({ event: "RACE_STARTED", ts: 0n }),
        makeEvent({ event: "LEG1_RELEASED", ts: 1_500n }),
        makeEvent({ event: "LEG2_PARTIAL", ts: 3_000n }),
        makeEvent({ event: "DEFAULT_DECLARED", ts: 7_000n }),
    ];
    const switches: ReadonlyArray<readonly [number, number]> = [
        [2, 0.5],
        [0.5, 2],
    ];
    const offsets = [0, 137, 250, 499, 500, 812, 1_250, 1_999, 2_400];

    it("never decreases the displayed clock at the instant of a switch", () => {
        // Sanity: the offsets really do show different times, so the
        // monotonicity assertions below are not vacuous.
        const shown = offsets.map((wall) => displayVirtualMs(stream, wall, 2));
        expect(new Set(shown).size).toBeGreaterThan(1);

        for (const [from, to] of switches) {
            for (const wall of offsets) {
                const before = displayVirtualMs(stream, wall, from);
                const rescaled = rescaleWallMs(wall, from, to);
                const after = displayVirtualMs(stream, rescaled, to);
                // Slowing down must not rewind the clock.
                expect(after >= before).toBe(true);
                // Speeding up must not jump it forward over time already
                // shown: the switch itself holds the displayed value.
                expect(after).toBe(before);
            }
        }
    });

    it("reaches the final event when playback continues after a switch", () => {
        for (const [from, to] of switches) {
            let wall = 0;
            // Play the first half of the stream at the original speed.
            const halfWall = ((stream.length - 1) * SEGMENT_WALL_MS) / from / 2;
            while (wall < halfWall) {
                wall += 50;
            }
            wall = rescaleWallMs(wall, from, to);
            const endWall = ((stream.length - 1) * SEGMENT_WALL_MS) / to;
            let previous = displayVirtualMs(stream, wall, to);
            // Keep ticking at the new speed: never rewind, always arrive.
            while (wall < endWall) {
                wall += 50;
                const value = displayVirtualMs(stream, wall, to);
                expect(value >= previous).toBe(true);
                previous = value;
            }
            expect(wall).toBeGreaterThanOrEqual(endWall);
            expect(previous).toBe(7_000n);
        }
    });

    it("keeps the reduced motion snap monotonic across a switch", () => {
        for (const [from, to] of switches) {
            const wall = 640;
            const before = snappedDisplayVirtualMs(stream, wall, from);
            const rescaled = rescaleWallMs(wall, from, to);
            // The snap sits in the same segment before and after the switch.
            expect(snappedDisplayVirtualMs(stream, rescaled, to)).toBe(before);

            const endWall = ((stream.length - 1) * SEGMENT_WALL_MS) / to;
            let previous = before;
            let current = rescaled;
            while (current < endWall) {
                current += 50;
                const value = snappedDisplayVirtualMs(stream, current, to);
                expect(value >= previous).toBe(true);
                previous = value;
            }
            expect(previous).toBe(7_000n);
        }
    });
});

describe("riskWindow", () => {
    const funded = makeEvent({
        event: "LEG_FUNDED",
        ts: 900n,
        data: { leg: "LEG1_USD", amount_cents: "1000000" },
    });
    const leg1 = makeEvent({ event: "LEG1_RELEASED", ts: 2_000n });

    it("reports never when leg 1 was never released", () => {
        const window = riskWindow([
            makeEvent({ event: "TICKET_CREATED", ts: 0n }),
            funded,
        ]);
        expect(window.status).toBe("never");
        expect(window.open_at).toBeNull();
        expect(window.close_at).toBeNull();
        expect(window.duration_ms).toBeNull();
        expect(window.amount_label_input).toBeNull();
    });

    it("reports open with leg 1 amount while nothing closed the window", () => {
        const window = riskWindow([funded, leg1]);
        expect(window.status).toBe("open");
        expect(window.open_at).toBe(2_000n);
        expect(window.close_at).toBeNull();
        expect(window.duration_ms).toBeNull();
        expect(window.amount_label_input).toBe(1_000_000n);
        expect(window.closed_by).toBeNull();
        expect(window.late).toBe(false);
    });

    it("closes on LEG2_RELEASED with the window duration", () => {
        const window = riskWindow([
            funded,
            leg1,
            makeEvent({ event: "LEG2_RELEASED", ts: 7_000n }),
        ]);
        expect(window.status).toBe("closed");
        expect(window.open_at).toBe(2_000n);
        expect(window.close_at).toBe(7_000n);
        expect(window.duration_ms).toBe(5_000n);
        expect(window.closed_by).toBe("LEG2_RELEASED");
        expect(window.late).toBe(false);
    });

    it("marks a late closing payment", () => {
        const window = riskWindow([
            funded,
            leg1,
            makeEvent({
                event: "LEG2_RELEASED",
                ts: 9_000n,
                data: { late: true },
            }),
        ]);
        expect(window.status).toBe("closed");
        expect(window.closed_by).toBe("LEG2_RELEASED");
        expect(window.late).toBe(true);
        expect(window.duration_ms).toBe(7_000n);
    });

    it("keeps the window open through a partial payment and closes it on default", () => {
        const partial = makeEvent({
            event: "LEG2_PARTIAL",
            ts: 4_000n,
            data: { amount_cents: "810000", paid_cad_cents: "810000" },
        });
        const partialOnly = riskWindow([funded, leg1, partial]);
        expect(partialOnly.status).toBe("open");
        expect(partialOnly.close_at).toBeNull();

        const withDefault = riskWindow([
            funded,
            leg1,
            partial,
            makeEvent({ event: "DEFAULT_DECLARED", ts: 8_000n }),
        ]);
        expect(withDefault.status).toBe("closed");
        expect(withDefault.closed_by).toBe("DEFAULT_DECLARED");
        expect(withDefault.duration_ms).toBe(6_000n);
        expect(withDefault.late).toBe(false);
    });

    it("filters to the sequential lane even when given the whole stream", () => {
        const window = riskWindow([
            makeEvent({ event: "TICKET_CREATED", ts: 0n, lane: "ATOMIC" }),
            makeEvent({
                event: "LEG1_RELEASED",
                ts: 1_500n,
                lane: "ATOMIC",
            }),
            funded,
            leg1,
        ]);
        expect(window.status).toBe("open");
        expect(window.open_at).toBe(2_000n);
    });
});

describe("playheadState", () => {
    const events = [
        makeEvent({ event: "RACE_STARTED", ts: 1_000n }),
        makeEvent({ event: "LEG1_RELEASED", ts: 3_000n }),
        makeEvent({ event: "LEG2_RELEASED", ts: 5_000n }),
    ];

    it("reports 0, 0 for an empty stream", () => {
        expect(playheadState([], 4_000n)).toEqual({ index: 0, progress: 0 });
    });

    it("reports the first marker with no progress before its stamp", () => {
        expect(playheadState(events, 500n)).toEqual({ index: 0, progress: 0 });
        expect(playheadState(events, 1_000n)).toEqual({ index: 0, progress: 0 });
    });

    it("reports progress into the next segment between markers", () => {
        expect(playheadState(events, 2_000n)).toEqual({
            index: 0,
            progress: 0.5,
        });
        expect(playheadState(events, 4_500n)).toEqual({
            index: 1,
            progress: 0.75,
        });
    });

    it("parks on the last marker with no progress past the end", () => {
        expect(playheadState(events, 5_000n)).toEqual({
            index: 2,
            progress: 0,
        });
        expect(playheadState(events, 99_000n)).toEqual({
            index: 2,
            progress: 0,
        });
    });

    it("handles duplicate stamps without dividing by zero", () => {
        const twin = [
            makeEvent({ event: "RACE_STARTED", ts: 1_000n }),
            makeEvent({ event: "LEG1_RELEASED", ts: 1_000n }),
            makeEvent({ event: "LEG2_RELEASED", ts: 4_000n }),
        ];
        expect(playheadState(twin, 1_000n)).toEqual({ index: 1, progress: 0 });
        expect(playheadState(twin, 2_500n)).toEqual({
            index: 1,
            progress: 0.5,
        });
    });
});

describe("formatVirtualSeconds", () => {
    it("formats integer milliseconds with millisecond precision", () => {
        expect(formatVirtualSeconds(0n)).toBe("0.000");
        expect(formatVirtualSeconds(1_234n)).toBe("1.234");
        expect(formatVirtualSeconds(5_000n)).toBe("5.000");
    });
});
