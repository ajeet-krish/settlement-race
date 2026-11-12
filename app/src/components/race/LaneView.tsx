import { Fragment, type CSSProperties } from "react";
import type { RaceEvent } from "../../engine/scenarioEngine";
import type { SettlementPathName } from "../../lib/ticket";
import {
    EVENT_ABBREV,
    eventLabel,
    finalStatusFor,
    laneStatus,
    shortSig,
} from "./raceLabels";
import RiskWindowBlock from "./RiskWindowBlock";
import { formatVirtualSeconds, playheadState, riskWindow } from "./raceTiming";

interface LaneViewProps {
    /** Which settlement path this column renders. */
    lane: SettlementPathName;
    /** Full stream; records are filtered to this lane inside. */
    events: readonly RaceEvent[];
    /** Displayed virtual clock in milliseconds. */
    displayMs: bigint;
}

/**
 * One lane of the race: status header plus a vertical event timeline of
 * markers (abbreviation, label, virtual timestamp, short signature, and a
 * status chip on finals). The sequential lane carries the hatched risk
 * window block directly beneath its leg 1 marker so the exposure interval
 * physically occupies the timeline it spans; the atomic lane carries the
 * contrasting no exposure strip. A rail fills with playback progress and
 * only the reached markers are lit.
 */
export default function LaneView({ lane, events, displayMs }: LaneViewProps) {
    const laneEvents = events.filter((e) => e.lane === lane);
    const status = laneStatus(events, lane);
    const head = playheadState(laneEvents, displayMs);
    const isSequential = lane === "SEQUENTIAL";
    const risk = isSequential ? riskWindow(events) : null;
    const playheadPercent =
        laneEvents.length > 1
            ? ((head.index + head.progress) / (laneEvents.length - 1)) * 100
            : 0;

    return (
        <section
            className={`lane lane-${lane.toLowerCase()}`}
            aria-label={isSequential ? "Sequential lane" : "Atomic lane"}
        >
            <header className="lane-head">
                <div>
                    <h3 className="lane-name">
                        {isSequential ? "Sequential" : "Atomic"}
                    </h3>
                    <p className="lane-tag">
                        {isSequential
                            ? "Pay first, then wait"
                            : "Both legs or neither"}
                    </p>
                </div>
                <span
                    className={`lane-status lane-status-${status.toLowerCase()}`}
                >
                    {status}
                </span>
            </header>
            <ol
                className="lane-events"
                style={{ "--playhead": `${playheadPercent}%` } as CSSProperties}
            >
                {laneEvents.length === 0 ? (
                    <li className="lane-empty">No events yet.</li>
                ) : null}
                {laneEvents.map((event, index) => {
                    const state =
                        index < head.index
                            ? "past"
                            : index === head.index
                              ? "current"
                              : "future";
                    const sig = shortSig(event.tx_sig);
                    const finalStatus = finalStatusFor(event, lane);
                    return (
                        <Fragment key={event.seq}>
                            <li
                                className={`lane-marker lane-marker-${state}`}
                            >
                                <span
                                    className={`marker-abbrev marker-abbrev-${state}`}
                                    aria-hidden="true"
                                >
                                    {EVENT_ABBREV[event.event]}
                                </span>
                                <span className="marker-body">
                                    <span className="marker-label">
                                        {eventLabel(event)}
                                    </span>
                                    <span className="marker-meta">
                                        <span className="marker-time">
                                            {formatVirtualSeconds(
                                                event.virtual_ts_ms,
                                            )}{" "}
                                            s
                                        </span>
                                        {sig !== null ? (
                                            <span className="marker-sig">
                                                {sig}
                                            </span>
                                        ) : null}
                                        {finalStatus !== null ? (
                                            <span
                                                className={`marker-final marker-final-${finalStatus.toLowerCase()}`}
                                            >
                                                {finalStatus}
                                            </span>
                                        ) : null}
                                    </span>
                                </span>
                                {isSequential &&
                                event.event === "LEG1_RELEASED" &&
                                risk !== null ? (
                                    <RiskWindowBlock
                                        window={risk}
                                        displayMs={displayMs}
                                    />
                                ) : null}
                            </li>
                        </Fragment>
                    );
                })}
            </ol>
            {isSequential && risk !== null && risk.status === "never" ? (
                <p className="risk-never">
                    No exposure recorded: leg 1 not released.
                </p>
            ) : null}
            {!isSequential ? (
                <p className="no-window">
                    No exposure window: both legs or neither
                </p>
            ) : null}
        </section>
    );
}
