/**
 * Virtual clock for the race engine.
 *
 * The demo never sleeps in real time: scenarios advance a monotonic virtual
 * clock in milliseconds so the sequential gap plays out deterministically and
 * repeatably. Time only moves forward; an advance to an earlier instant is a
 * programming error and throws.
 */

type ScheduledCallback = () => void;

interface ScheduledEntry {
    at_ms: bigint;
    /** Insertion order, used to break ties between equal timestamps. */
    order: number;
    fn: ScheduledCallback;
}

export class VirtualClock {
    private currentMs: bigint;
    private scheduled: ScheduledEntry[] = [];
    private nextOrder = 0;

    constructor(initialMs: bigint = 0n) {
        if (initialMs < 0n) {
            throw new Error(
                `VirtualClock: initial time must be non negative: ${initialMs.toString()}`,
            );
        }
        this.currentMs = initialMs;
    }

    /** Current virtual time in milliseconds. */
    now(): bigint {
        return this.currentMs;
    }

    /**
     * Move virtual time forward to to_ms.
     *
     * Monotonic: moving backwards throws. Equal advances are allowed (no op
     * for time itself) but still run any callbacks due at that instant.
     * Callbacks scheduled at or before the new time run in (time, insertion)
     * order after the clock has moved. Callbacks scheduled from inside a
     * callback run on the next advance, not recursively.
     *
     * @throws Error when to_ms is earlier than the current time.
     */
    advance(to_ms: bigint): void {
        if (to_ms < this.currentMs) {
            throw new Error(
                `VirtualClock: time regression from ${this.currentMs.toString()} to ${to_ms.toString()}`,
            );
        }
        this.currentMs = to_ms;

        const due: ScheduledEntry[] = [];
        const pending: ScheduledEntry[] = [];
        for (const entry of this.scheduled) {
            if (entry.at_ms <= this.currentMs) {
                due.push(entry);
            } else {
                pending.push(entry);
            }
        }
        this.scheduled = pending;
        due.sort((a, b) => {
            if (a.at_ms !== b.at_ms) {
                return a.at_ms < b.at_ms ? -1 : 1;
            }
            return a.order - b.order;
        });
        for (const entry of due) {
            entry.fn();
        }
    }

    /**
     * Schedule fn to run the next time advance reaches at_ms or later.
     * Scheduling in the past is allowed: the callback runs on the next
     * advance.
     */
    schedule(at_ms: bigint, fn: ScheduledCallback): void {
        if (at_ms < 0n) {
            throw new Error(
                `VirtualClock: schedule time must be non negative: ${at_ms.toString()}`,
            );
        }
        this.scheduled.push({ at_ms, order: this.nextOrder, fn });
        this.nextOrder += 1;
    }

    /** Number of callbacks still waiting to run. */
    get pendingCount(): number {
        return this.scheduled.length;
    }
}
