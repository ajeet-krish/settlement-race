import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceEvent } from "../engine/scenarioEngine";
import type { ScenarioSpec } from "../engine/scenarios";
import { raceModeCopy, type RaceMode } from "../lib/raceSource";
import type { ScenarioKind } from "../lib/ticket";
import BalancePanel from "./race/BalancePanel";
import ChainStatusIndicator from "./race/ChainStatusIndicator";
import EventLog from "./race/EventLog";
import RaceTrack from "./race/RaceTrack";
import ScenarioPicker from "./race/ScenarioPicker";
import TimelineControl from "./race/TimelineControl";
import {
    displayVirtualMs,
    rescaleWallMs,
    snappedDisplayVirtualMs,
    streamWallMs,
} from "./race/raceTiming";
import type { ChainStatus, RaceSource, RaceSpeed } from "./race/raceTypes";
import "../styles/race.css";

/** How the panel learns about reduced motion playback. */
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Wall time per clock tick while playing, in milliseconds. */
const TICK_MS = 50;

function prefersReducedMotion(): boolean {
    return (
        typeof window !== "undefined" &&
        window.matchMedia(REDUCED_MOTION_QUERY).matches
    );
}

export interface RacePanelProps {
    /**
     * Whether the live engine source is wired in. Defaults to
     * "disconnected", which shows the setup notice and keeps Run
     * disabled until demo accounts load; "live" enables runs through
     * onRun.
     */
    source?: RaceSource;
    /**
     * Which ledger the engine source drives right now: "live" (the
     * default) sends devnet transactions, "offline" runs the same
     * engine against an in-memory mock. Drives the mode switch, the
     * header badge, and the evidence word on the chain pill.
     */
    mode?: RaceMode;
    /**
     * Switch between live devnet and the offline demo. Absent (the
     * default) hides the switch, which keeps standalone renders to the
     * transport contract only.
     */
    onModeChange?: (mode: RaceMode) => void;
    /** Events yielded so far, in shared chain order. */
    events?: readonly RaceEvent[];
    /** Scenario the stream belongs to, when the caller already knows it. */
    scenario?: ScenarioSpec | null;
    /** Start a run of the given scenario kind. */
    onRun?: (kind: ScenarioKind) => void;
    /** Provenance chain verification pill state, fed by a later slice. */
    chainStatus?: ChainStatus;
    /**
     * Setup guidance or run failure to show as a slip above the
     * controls. Null keeps the default disconnected copy when the
     * source is off and shows nothing once live.
     */
    notice?: string | null;
    /** True while a run is in flight; keeps Run disabled. */
    running?: boolean;
}

/**
 * Composition root of the race view: scenario picker, disconnected empty
 * state, transport bar, twin lane track, balances, and event log. The
 * header also carries the mode switch (live devnet against offline
 * demo), the mode badge, and the evidence word on the chain pill, all
 * driven by the mode prop so the panel never decides which ledger it is
 * on. The panel owns only presentation playback state (play, speed, wall
 * elapsed); everything engine or account related arrives through props,
 * so wiring demo accounts and the Anchor client never touches this file's
 * logic. The displayed clock interpolates with raceTiming and snaps to
 * event stamps when the user prefers reduced motion. Wall elapsed is
 * stored in the units of the current speed: a speed change rescales it
 * through rescaleWallMs so the displayed clock never rewinds or jumps
 * over time already shown.
 */
export default function RacePanel({
    source = "disconnected",
    mode = "live",
    onModeChange,
    events = [],
    scenario = null,
    onRun,
    chainStatus = "PENDING",
    notice = null,
    running = false,
}: RacePanelProps) {
    const [selected, setSelected] = useState<ScenarioSpec | null>(scenario);
    const [speed, setSpeed] = useState<RaceSpeed>(1);
    const [playing, setPlaying] = useState(false);
    const [wallMs, setWallMs] = useState(0);
    const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
    const previousLength = useRef(0);
    const modeCopy = raceModeCopy(mode);

    // Follow the scenario prop when a caller states one explicitly.
    useEffect(() => {
        setSelected(scenario);
    }, [scenario]);

    // Track the operating system's reduced motion preference live.
    useEffect(() => {
        const query = window.matchMedia(REDUCED_MOTION_QUERY);
        const listener = () => setReducedMotion(query.matches);
        query.addEventListener("change", listener);
        return () => query.removeEventListener("change", listener);
    }, []);

    // A shorter stream means a new run replaced the old one: rewind.
    // An in flight run keeps its playback running, because Run already
    // started the clock on purpose; only an outside reset pauses it.
    useEffect(() => {
        if (events.length === 0 || events.length < previousLength.current) {
            setWallMs(0);
            if (!running) {
                setPlaying(false);
            }
        }
        previousLength.current = events.length;
    }, [events.length, running]);

    // Wall time the current stream needs to cross at this speed.
    const streamEndMs =
        events.length > 1 ? streamWallMs(events) / speed : 0;

    useEffect(() => {
        if (!playing) {
            return;
        }
        const id = window.setInterval(() => {
            setWallMs((wall) => wall + TICK_MS);
        }, TICK_MS);
        return () => window.clearInterval(id);
    }, [playing]);

    // Auto pause at the end of a finished stream. A live run keeps the
    // clock running while later events still arrive, because wall time
    // cannot know how long the next transaction takes; once the run
    // finishes and the playhead crosses the stream, playback stops. A
    // run that produced no stream stops as soon as the clock ticks.
    useEffect(() => {
        if (!playing || running) {
            return;
        }
        if (events.length <= 1) {
            if (wallMs > 0) {
                setPlaying(false);
            }
            return;
        }
        if (wallMs >= streamEndMs) {
            setPlaying(false);
        }
    }, [playing, running, events.length, wallMs, streamEndMs]);

    const displayMs = useMemo(() => {
        const interpolate = reducedMotion
            ? snappedDisplayVirtualMs
            : displayVirtualMs;
        return interpolate(events, wallMs, speed);
    }, [events, wallMs, speed, reducedMotion]);

    // Switching speed rescales the accumulated wall time so the segment
    // position holds still at the instant of the change: 2x to 0.5x keeps
    // the clock where it was instead of rewinding it, and 0.5x to 2x does
    // not jump it forward over time already shown. Both state updates land
    // in one render, so the readout and the accumulator agree.
    function handleSpeedChange(next: RaceSpeed): void {
        if (next === speed) {
            return;
        }
        setWallMs((wall) => rescaleWallMs(wall, speed, next));
        setSpeed(next);
    }

    // A reset restarts at wall 0, which is segment position 0 at any
    // speed, so resets never need a rescale; only a speed change does.
    function handleRun(): void {
        if (selected === null) {
            return;
        }
        setWallMs(0);
        setPlaying(true);
        onRun?.(selected.kind);
    }

    function handleTogglePlay(): void {
        if (!playing && events.length > 1 && wallMs >= streamEndMs) {
            setWallMs(0);
        }
        setPlaying((current) => !current);
    }

    return (
        <div className="race">
            <div className="race-head">
                <div>
                    <h2 className="panel-heading">Race</h2>
                    <p className="race-lede">
                        Sequential pay first against atomic delivery versus
                        payment, replayed on one shared virtual clock.
                    </p>
                </div>
                <div className="race-head-side">
                    {onModeChange !== undefined && (
                        <div
                            className="race-mode"
                            role="group"
                            aria-label="Settlement source"
                        >
                            <button
                                type="button"
                                className={`race-mode-btn${
                                    mode === "live" ? " race-mode-active" : ""
                                }`}
                                aria-pressed={mode === "live"}
                                disabled={running}
                                title={
                                    running
                                        ? "A run is in progress"
                                        : "Switch to live devnet"
                                }
                                onClick={() => onModeChange("live")}
                            >
                                Live devnet
                            </button>
                            <button
                                type="button"
                                className={`race-mode-btn${
                                    mode === "offline"
                                        ? " race-mode-active"
                                        : ""
                                }`}
                                aria-pressed={mode === "offline"}
                                disabled={running}
                                title={
                                    running
                                        ? "A run is in progress"
                                        : "Switch to the offline demo"
                                }
                                onClick={() => onModeChange("offline")}
                            >
                                Offline demo
                            </button>
                        </div>
                    )}
                    <div className="race-head-status">
                        <p className={`mode-badge mode-badge-${mode}`}>
                            {modeCopy.badge}
                        </p>
                        <ChainStatusIndicator status={chainStatus} mode={mode} />
                    </div>
                </div>
            </div>

            {modeCopy.note !== null ? (
                <p className="race-mode-note">{modeCopy.note}</p>
            ) : null}

            <ScenarioPicker selected={selected} onSelect={setSelected} />

            {source === "disconnected" ? (
                <p className="race-disconnected" role="note">
                    {notice ?? "Demo accounts are not ready yet"}
                </p>
            ) : notice !== null ? (
                <p className="race-notice" role="alert">
                    {notice}
                </p>
            ) : null}

            <TimelineControl
                source={source}
                hasScenario={selected !== null}
                canPlay={events.length > 1}
                playing={playing}
                running={running}
                speed={speed}
                displayMs={displayMs}
                onRun={handleRun}
                onTogglePlay={handleTogglePlay}
                onSpeedChange={handleSpeedChange}
            />

            <RaceTrack
                events={events}
                displayMs={displayMs}
                scenario={selected}
            />

            <div className="race-lower">
                <BalancePanel events={events} />
                <EventLog events={events} />
            </div>
        </div>
    );
}
