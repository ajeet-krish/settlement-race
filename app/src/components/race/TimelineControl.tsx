import { formatVirtualSeconds } from "./raceTiming";
import type { RaceSource, RaceSpeed } from "./raceTypes";

/** Speed steps in presentation order. */
const SPEEDS: readonly RaceSpeed[] = [0.5, 1, 2];

interface TimelineControlProps {
    /** Engine wiring state; controls whether a run can start at all. */
    source: RaceSource;
    /** True once a scenario card is selected. */
    hasScenario: boolean;
    /** True when there is a stream with more than one event to play. */
    canPlay: boolean;
    /** Whether the clock is currently advancing. */
    playing: boolean;
    /** True while a run is in flight; keeps Run disabled. */
    running: boolean;
    /** Current playback speed multiplier. */
    speed: RaceSpeed;
    /** Displayed virtual clock in milliseconds. */
    displayMs: bigint;
    /** Start a run of the selected scenario. */
    onRun: () => void;
    /** Toggle playback; restarts from zero when the stream is crossed. */
    onTogglePlay: () => void;
    /** Change the playback speed multiplier. */
    onSpeedChange: (speed: RaceSpeed) => void;
}

/**
 * Transport bar for the race: run the scenario, play or pause the shared
 * clock, pick a speed, and read the virtual time. The run button is
 * disabled with an explanatory tooltip while the engine source is
 * disconnected, while a run is in flight, and when no scenario card is
 * selected; the clock readout only changes through raceTiming's
 * interpolation, which snaps under reduced motion.
 */
export default function TimelineControl({
    source,
    hasScenario,
    canPlay,
    playing,
    running,
    speed,
    displayMs,
    onRun,
    onTogglePlay,
    onSpeedChange,
}: TimelineControlProps) {
    const runDisabled = source === "disconnected" || !hasScenario || running;
    const runHint = running
        ? "A run is in progress"
        : source === "disconnected"
          ? "Engine source not connected yet"
          : hasScenario
            ? ""
            : "Choose a scenario first";

    return (
        <div className="timeline" role="group" aria-label="Race controls">
            <span
                className="timeline-run-wrap"
                title={runHint === "" ? undefined : runHint}
            >
                <button
                    type="button"
                    className="timeline-run"
                    disabled={runDisabled}
                    onClick={onRun}
                >
                    {running ? "Running..." : "Run scenario"}
                </button>
            </span>
            <button
                type="button"
                className="timeline-play"
                disabled={!canPlay}
                onClick={onTogglePlay}
            >
                {playing ? "Pause" : "Play"}
            </button>
            <div
                className="timeline-speeds"
                role="group"
                aria-label="Playback speed"
            >
                {SPEEDS.map((step) => (
                    <button
                        key={step}
                        type="button"
                        className={`timeline-speed${
                            speed === step ? " timeline-speed-active" : ""
                        }`}
                        aria-pressed={speed === step}
                        onClick={() => onSpeedChange(step)}
                    >
                        {step}x
                    </button>
                ))}
            </div>
            <p className="timeline-clock" aria-label="Shared virtual clock">
                {formatVirtualSeconds(displayMs)} s
            </p>
        </div>
    );
}
