import { lazy, Suspense, useEffect, useState } from "react";
import AppShell from "./components/AppShell";
import { TABS, type TabId } from "./components/tabs";
import "./styles/theme.css";
import "./styles/shell.css";
// Imported after the stylesheets so component css lands later in the cascade.
// The race panel stays a static import: its live path is needed at first
// paint. The other three panels are lazy chunks behind a Suspense fallback,
// and their stylesheets ride along with those chunks, still after shell.css.
import RacePanel from "./components/RacePanel";
const LearnPanel = lazy(() => import("./components/learn/LearnPanel"));
const ProvenancePanel = lazy(() => import("./components/ProvenancePanel"));
const TicketsPanel = lazy(() => import("./components/TicketsPanel"));
import type { ChainStatus, RaceSource } from "./components/race/raceTypes";
import type { RaceEvent } from "./engine/scenarioEngine";
import { getScenario, type ScenarioSpec } from "./engine/scenarios";
import {
    createRaceSource,
    raceModeCopy,
    type RaceMode,
    type RaceSourceState,
} from "./lib/raceSource";
import type { ScenarioKind } from "./lib/ticket";

/**
 * Notice carried when the app auto fell back to the offline demo because
 * live mode could not find demo-accounts.json. One short pair of
 * sentences: why the switch happened and what is running now. The setup
 * guidance for the file stays one toggle away in live mode, so this copy
 * never repeats it.
 */
export const AUTO_FALLBACK_NOTICE =
    "Live demo keys are not shipped with the public site. Running the offline demo instead.";

/**
 * The shell's mode session: which ledger the race view drives, the
 * source state for that mode, the notice slot above the controls
 * (runNotice, read by noticeForSession once the source is ready), and
 * the once per session auto fallback latch. The mode story (switches,
 * source resolutions, run notices) lives in this one value so every
 * transition is a pure function with tests; the race stream itself
 * (events, chain pill, running) stays outside as separate state because
 * a run drives it incrementally.
 */
export interface ModeSession {
    /** Which settlement backend the race view drives. */
    mode: RaceMode;
    /** Source state for the current mode: loading, missing, error, ready. */
    source: RaceSourceState;
    /**
     * Notice for a ready source: the auto fallback explanation or a run
     * failure. Consumed (set to null) by a run start and by a mode switch.
     */
    runNotice: string | null;
    /**
     * True once the auto fallback fired this session. Never resets on a
     * mode switch, so the fallback can fire at most once per session and
     * a later manual choice of live mode keeps showing the guidance.
     */
    fellBack: boolean;
}

/** Fresh session: live mode loading its source, no notice, no fallback. */
export function createModeSession(mode: RaceMode = "live"): ModeSession {
    return {
        mode,
        source: { status: "loading" },
        runNotice: null,
        fellBack: false,
    };
}

/**
 * Fold one resolved source state into the session. One special case:
 * when live mode resolves to missing-accounts and this session has not
 * fallen back yet, switch to offline, keep the source loading (the
 * source effect reloads offline and resolves ready), latch fellBack so
 * the fallback can never fire again, and carry AUTO_FALLBACK_NOTICE in
 * runNotice. Every other resolution is stored as is: a live success
 * keeps live, a load error keeps live so its message shows (only the
 * typed missing-accounts state, thrown for the absent file's 404, means
 * the file was deliberately not shipped), and a live resolution after a
 * previous fallback stores the guidance instead of falling back twice.
 */
export function applySourceResolved(
    session: ModeSession,
    resolved: RaceSourceState,
): ModeSession {
    if (
        session.mode === "live" &&
        resolved.status === "missing-accounts" &&
        !session.fellBack
    ) {
        return {
            mode: "offline",
            source: { status: "loading" },
            runNotice: AUTO_FALLBACK_NOTICE,
            fellBack: true,
        };
    }
    return { ...session, source: resolved };
}

/**
 * Apply a visitor mode switch: restart the source through loading and
 * drop the carried notice, while the fallback latch survives. The same
 * mode and a switch during a run are no-ops, returned as the input
 * reference so callers can compare and skip the reset.
 */
export function applyModeSwitch(
    session: ModeSession,
    next: RaceMode,
    running: boolean,
): ModeSession {
    if (next === session.mode || running) {
        return session;
    }
    return {
        ...session,
        mode: next,
        source: { status: "loading" },
        runNotice: null,
    };
}

/** A run starts: whatever notice the session carried is consumed. */
export function applyRunStart(session: ModeSession): ModeSession {
    return { ...session, runNotice: null };
}

/**
 * Notice above the controls, in precedence order: the loading line for
 * the active mode first, then the setup guidance for a missing accounts
 * file, then a load error, and only a ready source falls through to the
 * run notice slot, where the auto fallback explanation sits until a run
 * or a mode switch consumes it.
 */
export function noticeForSession(session: ModeSession): string | null {
    if (session.source.status === "loading") {
        return raceModeCopy(session.mode).loading;
    }
    if (session.source.status === "missing-accounts") {
        return session.source.guidance;
    }
    if (session.source.status === "error") {
        return session.source.message;
    }
    return session.runNotice;
}

/** RacePanel transport prop: only a ready source reads as live wiring. */
export function panelSource(session: ModeSession): RaceSource {
    return session.source.status === "ready" ? "live" : "disconnected";
}

/**
 * Shell plus the wired race view: tab state, the tickets view rebuilt
 * from the same accumulated events as the race tab (scenario spec and
 * demo account wallets passed through), the provenance view fed from
 * those same events, the mounted educational layer, and a RacePanel fed
 * from createRaceSource. One mode switch picks the ledger: live loads
 * demo accounts and drives devnet, offline runs the same engine against
 * an in-memory mock. The source loads for the active mode (on mount and
 * again after every switch) and reports one of four states (loading,
 * missing accounts with guidance, ready, error); a run accumulates
 * engine events, flips the chain pill from the verification result, and
 * starts fresh on every press with a new engine instance underneath.
 * When the deployed site (which never ships demo-accounts.json) resolves
 * live to missing-accounts, the session auto falls back to the offline
 * demo at most once per session with AUTO_FALLBACK_NOTICE above the
 * controls; a later manual switch back to live stays live and shows the
 * setup guidance instead. The three non-race panels are lazy chunks
 * behind a Suspense fallback, so the initial bundle carries only the
 * race path while each other panel's code arrives as its own chunk. All
 * four stay mounted, hidden by the tab, so switching away never throws
 * a panel's state away.
 */
export default function App() {
    const [active, setActive] = useState<TabId>("race");
    const [session, setSession] = useState<ModeSession>(createModeSession);
    const [events, setEvents] = useState<RaceEvent[]>([]);
    const [streamScenario, setStreamScenario] = useState<ScenarioSpec | null>(
        null,
    );
    const [chainStatus, setChainStatus] = useState<ChainStatus>("PENDING");
    const [running, setRunning] = useState(false);

    // One source per mode: live loads demo accounts and the connection
    // once per mount and again after every switch back; offline resolves
    // straight to a mock backed ready state. Accounts and the connection
    // live in memory only, never in storage. The loader resolves to a
    // state object, so the catch only guards an unexpected rejection.
    // The alive flag cancels a stale load when the mode changes mid
    // flight, so a late live answer cannot overwrite offline state. The
    // session captured here is the one this effect was created for:
    // deps are the mode alone, and while alive nothing else in the
    // session moves (a run cannot start without a ready source, and the
    // fallback latch only flips together with the mode). A resolution
    // that auto falls back changes the mode, which resets the race
    // fields the same way a visitor's switch does and restarts this
    // effect for offline.
    useEffect(() => {
        let alive = true;
        const loading = createRaceSource(
            session.mode === "offline" ? { mode: "offline" } : {},
        );
        void loading
            .then((state) => {
                if (!alive) {
                    return;
                }
                const next = applySourceResolved(session, state);
                setSession(next);
                if (next.mode !== session.mode) {
                    setEvents([]);
                    setChainStatus("PENDING");
                }
            })
            .catch(() => {
                if (!alive) {
                    return;
                }
                setSession((current) => ({
                    ...current,
                    source: {
                        status: "error",
                        message:
                            session.mode === "offline"
                                ? "The offline demo could not start."
                                : "Demo accounts could not be loaded.",
                    },
                }));
            });
        return () => {
            alive = false;
        };
    }, [session.mode]);

    // Notice shown above the controls: setup state first (worded for
    // the active mode), then whatever the last run or the automatic
    // fallback to offline reported.
    const notice = noticeForSession(session);

    // A mode switch clears the race: events, the chain pill, and any
    // run or fallback notice belong to the previous mode's ledger, and
    // the source restarts through the effect above, beginning from
    // loading so a stale ready never accepts a run under the new mode.
    // The scenario selection survives, because picking a card again
    // would be busy work for a switch that changes nothing about the
    // picker. Switching mid run is refused: the in flight run would keep
    // streaming into the reset event list.
    function handleModeChange(next: RaceMode): void {
        const updated = applyModeSwitch(session, next, running);
        if (updated === session) {
            return;
        }
        setSession(updated);
        setEvents([]);
        setChainStatus("PENDING");
    }

    async function handleRun(kind: ScenarioKind): Promise<void> {
        if (session.source.status !== "ready" || running) {
            return;
        }
        const source = session.source;
        const spec = getScenario(kind);
        // A second run starts clean: empty stream, fresh chain pill, and
        // the source builds a new engine with a new scenario id base.
        // Starting also consumes the carried notice, so the auto
        // fallback explanation leaves the moment a run begins.
        setEvents([]);
        setStreamScenario(spec);
        setChainStatus("PENDING");
        setRunning(true);
        setSession(applyRunStart(session));
        try {
            const outcome = await source.runScenario(spec, (event) => {
                setEvents((current) => [...current, event]);
            });
            setChainStatus(
                outcome.chain_ok === true
                    ? "VALID"
                    : outcome.chain_ok === false
                      ? "BROKEN"
                      : "PENDING",
            );
            const error = outcome.error;
            if (error !== undefined) {
                setSession((current) => ({ ...current, runNotice: error }));
            }
        } catch (err) {
            // runScenario never rejects today; keep one guard so a future
            // failure still surfaces in the panel instead of vanishing.
            const message = err instanceof Error ? err.message : String(err);
            setSession((current) => ({ ...current, runNotice: message }));
        } finally {
            setRunning(false);
        }
    }

    return (
        <AppShell active={active} onTabChange={setActive}>
            {TABS.map((id) => {
                const selected = id === active;
                return (
                    <section
                        key={id}
                        className={id === "race" ? "panel panel-race" : id === "learn" ? "panel panel-learn" : id === "provenance" ? "panel panel-provenance" : id === "tickets" ? "panel panel-tickets" : "panel"}
                        role="tabpanel"
                        id={`panel-${id}`}
                        aria-labelledby={`tab-${id}`}
                        tabIndex={0}
                        hidden={!selected}
                    >
                        <Suspense fallback={<PanelFallback />}>
                            {id === "race" ? (
                                <RacePanel
                                    // Both ready states map to "live": the
                                    // engine source is wired either way, and
                                    // the mode badge names the ledger behind it.
                                    source={panelSource(session)}
                                    mode={session.mode}
                                    onModeChange={handleModeChange}
                                    events={events}
                                    scenario={streamScenario}
                                    onRun={handleRun}
                                    chainStatus={chainStatus}
                                    notice={notice}
                                    running={running}
                                />
                            ) : id === "learn" ? (
                                <LearnPanel />
                            ) : id === "provenance" ? (
                                <ProvenancePanel
                                    events={events}
                                    chainStatus={chainStatus}
                                    mode={session.mode}
                                />
                            ) : (
                                <TicketsPanel
                                    events={events}
                                    scenario={streamScenario}
                                    partyAWallet={
                                        session.source.status === "ready"
                                            ? session.source.accounts.partyA
                                                  .pubkey
                                            : null
                                    }
                                    partyBWallet={
                                        session.source.status === "ready"
                                            ? session.source.accounts.partyB
                                                  .pubkey
                                            : null
                                    }
                                />
                            )}
                        </Suspense>
                    </section>
                );
            })}
        </AppShell>
    );
}

/**
 * Suspense fallback for a panel chunk still on the wire: one quiet mono
 * line in the loading copy tone the race source already uses (Loading
 * demo accounts..., Starting offline demo...), announced politely so a
 * screen reader hears the wait. The pulse only runs for visitors who
 * have not asked for reduced motion; theme.css's global rule flattens
 * it either way.
 */
function PanelFallback() {
    return (
        <p className="panel-loading" role="status">
            Loading view...
        </p>
    );
}
