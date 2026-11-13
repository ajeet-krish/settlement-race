/**
 * Pure timing logic for the race view: virtual clock interpolation, the
 * sequential lane's exposure risk window, and playhead position.
 *
 * Everything here is a pure function over the event stream: no DOM, no
 * timers, no clients. Wall time is elapsed real milliseconds since playback
 * started; virtual stamps are bigint milliseconds on the engine's
 * deterministic clock, so displayed time never becomes a float.
 *
 * Playback model: each interval between two events takes wall time
 * proportional to its virtual span (clamped to a readable band), so the
 * readout sweeps through the stream like a stopwatch and the exposure
 * window counts up at human speed. Speed multiplies playback rate, so 2x
 * crosses every interval twice as fast and 0.5x half as fast. Wall time
 * passed in is always expressed at the speed passed in: when the speed
 * changes mid playback the caller runs the accumulated value through
 * rescaleWallMs, which preserves the segment position exactly, so the
 * displayed clock holds steady instead of rewinding or jumping over time
 * already shown.
 */

import type { RaceEvent } from "../../engine/scenarioEngine";
import { parse_cents } from "../../lib/money";

/** Wall milliseconds one virtual millisecond takes at 1x playback. */
export const WALL_MS_PER_VIRTUAL_MS = 1;

/** Smallest wall time any segment takes, so tight event bursts stay readable. */
export const MIN_SEGMENT_WALL_MS = 100;

/** Largest wall time a single segment takes, so extreme gaps stay watchable. */
export const MAX_SEGMENT_WALL_MS = 8_000;

/**
 * Wall time a segment takes at 1x, proportional to its virtual span. This
 * is the heart of readable pacing: a 6 second exposure window really
 * takes about 6 seconds to watch at 1x, instead of every event interval
 * collapsing into the same fixed slice. Tiny segments clamp up so they
 * stay visible; giant ones clamp down so a run never drags.
 */
function segmentWallMs(deltaVirtualMs: bigint): number {
    const raw = Number(deltaVirtualMs) * WALL_MS_PER_VIRTUAL_MS;
    if (!Number.isFinite(raw)) {
        return MAX_SEGMENT_WALL_MS;
    }
    return Math.min(
        MAX_SEGMENT_WALL_MS,
        Math.max(MIN_SEGMENT_WALL_MS, raw),
    );
}

/** Total wall time at 1x for the whole stream, all segments summed. */
export function streamWallMs(events: readonly RaceEvent[]): number {
    let total = 0;
    for (let i = 0; i < events.length - 1; i++) {
        total += segmentWallMs(
            events[i + 1]!.virtual_ts_ms - events[i]!.virtual_ts_ms,
        );
    }
    return total;
}

/** Lifecycle of the sequential lane's exposure window. */
export type RiskWindowStatus = "open" | "closed" | "never";

/**
 * The sequential lane's exposure window, measured from the leg 1 release
 * to whatever closes it:
 *
 * - LEG2_RELEASED closes it with a full payment, stamped late when the
 *   record carries data.late.
 * - DEFAULT_DECLARED closes it with a default. A LEG2_PARTIAL payment
 *   does not close the window: money has moved, but the unpaid remainder
 *   keeps principal exposure alive until the default arrives.
 * - status "never" means leg 1 was never released, so no window opened.
 *
 * Null fields are honest unknowns: open_at, close_at, and duration_ms are
 * null until the events that define them exist, and amount_label_input is
 * null until the leg 1 funding record can be read.
 */
export interface RiskWindow {
    status: RiskWindowStatus;
    open_at: bigint | null;
    close_at: bigint | null;
    duration_ms: bigint | null;
    /** Leg 1 USD cents for the amount label, when parsable. */
    amount_label_input: bigint | null;
    /** Which event closed the window, or null while open or never. */
    closed_by: "LEG2_RELEASED" | "DEFAULT_DECLARED" | null;
    /** True when the closing LEG2_RELEASED record was stamped late. */
    late: boolean;
}

/** Playhead position across the lane's markers. */
export interface PlayheadState {
    /** Index of the most recently reached marker (0 when nothing reached). */
    index: number;
    /** Progress into the segment toward the next marker, 0 to 1. */
    progress: number;
}

/**
 * Displayed virtual clock for a stream of events after wallElapsedMs of
 * playback at the given speed.
 *
 * Each segment between consecutive events takes wall time proportional to
 * its virtual span (see segmentWallMs), so the readout sweeps through the
 * stream like a stopwatch: the exposure window between leg 1 and leg 2
 * counts up at human speed rather than flashing. Monotonic in wall time,
 * clamps to the last event's stamp once the stream is crossed, and
 * returns 0n for zero or one event (an interval needs two endpoints).
 *
 * wallElapsedMs must be expressed at speed (see rescaleWallMs): feeding
 * the same wall value at two different speeds shows two different points,
 * which is only correct while the wall accumulator belongs to that speed.
 */
export function displayVirtualMs(
    events: readonly RaceEvent[],
    wallElapsedMs: number,
    speed: number,
): bigint {
    if (events.length <= 1) {
        return 0n;
    }
    const scale = speed > 0 ? speed : 0;
    if (scale === 0) {
        return events[0]!.virtual_ts_ms;
    }
    const wall = wallElapsedMs > 0 ? wallElapsedMs : 0;
    let walked = 0;
    for (let i = 0; i < events.length - 1; i++) {
        const segWall =
            segmentWallMs(
                events[i + 1]!.virtual_ts_ms - events[i]!.virtual_ts_ms,
            ) / scale;
        if (wall < walked + segWall) {
            const from = events[i]!.virtual_ts_ms;
            const to = events[i + 1]!.virtual_ts_ms;
            const fraction = segWall <= 0 ? 0 : (wall - walked) / segWall;
            return BigInt(
                Math.round(Number(from) + fraction * Number(to - from)),
            );
        }
        walked += segWall;
    }
    return events[events.length - 1]!.virtual_ts_ms;
}

/**
 * Reduced motion variant of displayVirtualMs: same segment mapping (and
 * the same speed-change contract through rescaleWallMs), but the clock
 * snaps to the stamp of the segment's first event instead of
 * interpolating, so the readout only changes when a marker is crossed.
 */
export function snappedDisplayVirtualMs(
    events: readonly RaceEvent[],
    wallElapsedMs: number,
    speed: number,
): bigint {
    if (events.length <= 1) {
        return 0n;
    }
    const scale = speed > 0 ? speed : 0;
    if (scale === 0) {
        return events[0]!.virtual_ts_ms;
    }
    const wall = wallElapsedMs > 0 ? wallElapsedMs : 0;
    let walked = 0;
    for (let i = 0; i < events.length - 1; i++) {
        const segWall =
            segmentWallMs(
                events[i + 1]!.virtual_ts_ms - events[i]!.virtual_ts_ms,
            ) / scale;
        if (wall < walked + segWall) {
            return events[i]!.virtual_ts_ms;
        }
        walked += segWall;
    }
    return events[events.length - 1]!.virtual_ts_ms;
}

/**
 * Rescale an accumulated wall time when playback speed changes, so the
 * segment position (wall * speed) is preserved at the instant of the
 * switch: slowing down must not rewind the clock and speeding up must not
 * jump it forward over time already shown. The offered speeds (0.5, 1, 2)
 * are powers of two, so the arithmetic is exact and the displayed value
 * before and after the change is identical. Non-positive speeds or an
 * unchanged speed return the value untouched.
 */
export function rescaleWallMs(
    wallElapsedMs: number,
    fromSpeed: number,
    toSpeed: number,
): number {
    if (fromSpeed <= 0 || toSpeed <= 0 || fromSpeed === toSpeed) {
        return wallElapsedMs;
    }
    return (wallElapsedMs * fromSpeed) / toSpeed;
}

/**
 * Exposure risk window of the sequential lane, computed from the stream.
 * All lanes' events may be passed: records are filtered to SEQUENTIAL
 * here, so callers never have to pre-slice.
 *
 * See RiskWindow for the closing rules. Returns status "never" when no
 * LEG1_RELEASED record exists.
 */
export function riskWindow(
    sequentialEvents: readonly RaceEvent[],
): RiskWindow {
    const seq = sequentialEvents.filter((e) => e.lane === "SEQUENTIAL");
    const never: RiskWindow = {
        status: "never",
        open_at: null,
        close_at: null,
        duration_ms: null,
        amount_label_input: null,
        closed_by: null,
        late: false,
    };
    const openIndex = seq.findIndex((e) => e.event === "LEG1_RELEASED");
    if (openIndex === -1) {
        return never;
    }
    const open_at = seq[openIndex]!.virtual_ts_ms;

    let close_at: bigint | null = null;
    let closed_by: RiskWindow["closed_by"] = null;
    let late = false;
    for (let i = openIndex + 1; i < seq.length; i++) {
        const event = seq[i]!;
        if (event.event === "LEG2_RELEASED") {
            close_at = event.virtual_ts_ms;
            closed_by = "LEG2_RELEASED";
            late = event.provenance.data.late === true;
            break;
        }
        if (event.event === "DEFAULT_DECLARED") {
            close_at = event.virtual_ts_ms;
            closed_by = "DEFAULT_DECLARED";
            break;
        }
    }

    const amount_label_input = leg1FundedCents(seq);
    if (close_at === null) {
        return {
            status: "open",
            open_at,
            close_at: null,
            duration_ms: null,
            amount_label_input,
            closed_by: null,
            late: false,
        };
    }
    return {
        status: "closed",
        open_at,
        close_at,
        duration_ms: close_at - open_at,
        amount_label_input,
        closed_by,
        late,
    };
}

/** Leg 1 USD cents from the first matching funding record, or null. */
function leg1FundedCents(events: readonly RaceEvent[]): bigint | null {
    for (const event of events) {
        if (event.event !== "LEG_FUNDED") {
            continue;
        }
        if (event.provenance.data.leg !== "LEG1_USD") {
            continue;
        }
        const raw = event.provenance.data.amount_cents;
        if (typeof raw !== "string") {
            return null;
        }
        try {
            return parse_cents(raw);
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * Current marker index and progress into the next segment for a displayed
 * virtual time. Index is the most recently reached marker; progress runs
 * from 0 at that marker toward 1 at the next one, and stays 0 at the last
 * marker or before the first stamp. Empty streams report { 0, 0 }.
 */
export function playheadState(
    events: readonly RaceEvent[],
    displayMs: bigint,
): PlayheadState {
    if (events.length === 0) {
        return { index: 0, progress: 0 };
    }
    let index = 0;
    while (index < events.length - 1) {
        const nextStamp = events[index + 1]!.virtual_ts_ms;
        if (nextStamp > displayMs) {
            break;
        }
        index++;
    }
    const current = events[index]!.virtual_ts_ms;
    const nextEvent = events[index + 1];
    if (nextEvent === undefined || displayMs <= current) {
        return { index, progress: 0 };
    }
    const span = nextEvent.virtual_ts_ms - current;
    if (span <= 0n) {
        return { index, progress: 0 };
    }
    const progress = Number(displayMs - current) / Number(span);
    if (progress < 0) {
        return { index, progress: 0 };
    }
    if (progress > 1) {
        return { index, progress: 1 };
    }
    return { index, progress };
}

/**
 * Format virtual milliseconds as a second string with millisecond
 * precision, for example 1234n becomes "1.234". Time only, never money:
 * the float here is presentation of integer milliseconds.
 */
export function formatVirtualSeconds(ms: bigint): string {
    return (Number(ms) / 1000).toFixed(3);
}
