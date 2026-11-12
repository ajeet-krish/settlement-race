import { useEffect, useRef } from "react";
import type { RaceEvent } from "../../engine/scenarioEngine";
import { shortSig } from "./raceLabels";
import { formatVirtualSeconds } from "./raceTiming";

interface EventLogProps {
    /** Append only stream, already in chain order. */
    events: readonly RaceEvent[];
}

/**
 * Append only view of the shared provenance chain: one row per event
 * with sequence, lane, event kind, virtual time, short signature, and
 * both lane statuses when the record carries a snapshot. Newest rows sit
 * at the bottom and the list follows them with an instant jump, which
 * keeps scrolling out of the animation path entirely, so reduced motion
 * needs no separate branch.
 */
export default function EventLog({ events }: EventLogProps) {
    const listRef = useRef<HTMLOListElement | null>(null);

    useEffect(() => {
        const list = listRef.current;
        if (list === null) {
            return;
        }
        list.scrollTop = list.scrollHeight;
    }, [events.length]);

    return (
        <section className="log" aria-label="Event log">
            <h3 className="log-title">Event log</h3>
            {events.length === 0 ? (
                <p className="log-empty">No events yet.</p>
            ) : (
                <ol className="log-list" ref={listRef}>
                    {events.map((event) => {
                        const sig = shortSig(event.tx_sig);
                        const sigText =
                            sig !== null
                                ? sig
                                : event.event === "ATOMIC_REVERTED"
                                  ? "tx reverted"
                                  : "no signature";
                        const snapshot = event.status_snapshot;
                        return (
                            <li key={event.seq} className="log-row">
                                <span className="log-seq">
                                    {event.seq.toString().padStart(2, "0")}
                                </span>
                                <span
                                    className={`log-lane log-lane-${event.lane.toLowerCase()}`}
                                >
                                    {event.lane === "SEQUENTIAL" ? "SEQ" : "ATM"}
                                </span>
                                <span className="log-event">{event.event}</span>
                                <span className="log-ts">
                                    {formatVirtualSeconds(event.virtual_ts_ms)} s
                                </span>
                                <span className="log-sig">{sigText}</span>
                                {snapshot !== undefined ? (
                                    <span className="log-status">
                                        SEQ {snapshot.sequential} / ATM{" "}
                                        {snapshot.atomic}
                                    </span>
                                ) : (
                                    <span className="log-status" />
                                )}
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}
