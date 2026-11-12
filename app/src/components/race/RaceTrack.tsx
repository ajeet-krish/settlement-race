import type { RaceEvent } from "../../engine/scenarioEngine";
import type { ScenarioSpec } from "../../engine/scenarios";
import LaneView from "./LaneView";
import { formatVirtualSeconds } from "./raceTiming";

interface RaceTrackProps {
    /** Full event stream, shared by both lanes. */
    events: readonly RaceEvent[];
    /** Displayed virtual clock in milliseconds. */
    displayMs: bigint;
    /** Selected scenario, shown in the header with its gap window. */
    scenario: ScenarioSpec | null;
}

/**
 * The race itself: a header carrying the shared virtual clock as a big
 * mono readout (plus the selected scenario and its gap), then the two
 * lanes side by side, sequential amber against atomic teal. Under 48rem
 * the lanes stack so each timeline keeps a readable width.
 */
export default function RaceTrack({ events, displayMs, scenario }: RaceTrackProps) {
    const gapSeconds =
        scenario === null
            ? null
            : formatVirtualSeconds(BigInt(Math.round(Number(scenario.gap_ms))));

    return (
        <section className="track" aria-label="Race track">
            <header className="track-head">
                <div>
                    <p className="track-clock-label">Shared virtual clock</p>
                    <p className="track-clock">
                        {formatVirtualSeconds(displayMs)} s
                    </p>
                </div>
                <div className="track-scenario">
                    {scenario === null ? (
                        <span className="track-scenario-empty">
                            No scenario selected
                        </span>
                    ) : (
                        <>
                            <span className="track-scenario-label">
                                {scenario.label}
                            </span>
                            <span className="track-scenario-gap">
                                gap {gapSeconds} s
                            </span>
                        </>
                    )}
                </div>
            </header>
            <div className="track-lanes">
                <LaneView lane="SEQUENTIAL" events={events} displayMs={displayMs} />
                <LaneView lane="ATOMIC" events={events} displayMs={displayMs} />
            </div>
        </section>
    );
}
