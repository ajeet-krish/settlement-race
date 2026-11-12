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
import type { ChainStatus } from "./components/race/raceTypes";
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
 * Shell plus the wired race view: tab state, the tickets view rebuilt
 * from the same accumulated events as the race tab (scenario spec and
 * demo account wallets passed through), the provenance view fed from
 * those same events, the mounted educational layer, and a RacePanel fed
 * from createRaceSource. One mode switch picks the ledger: live loads
 * demo accounts and drives devnet, offline runs the same engine
 * against an in-memory mock. The source loads for the active mode (on
 * mount and again after every switch) and reports one of four states
 * (loading, missing accounts with guidance, ready, error); a run
 * accumulates engine events, flips the chain pill from the
 * verification result, and starts fresh on every press with a new
 * engine instance underneath. The three non-race panels are lazy
 * chunks behind a Suspense fallback, so the initial bundle carries
 * only the race path while each other panel's code arrives as its
 * own chunk. All four stay mounted, hidden by the tab, so switching
 * away never throws a panel's state away.
 */
export default function App() {
    const [active, setActive] = useState<TabId>("race");
    const [mode, setMode] = useState<RaceMode>("live");
    const [source, setSource] = useState<RaceSourceState>({ status: "loading" });
    const [events, setEvents] = useState<RaceEvent[]>([]);
    const [streamScenario, setStreamScenario] = useState<ScenarioSpec | null>(
        null,
    );
    const [chainStatus, setChainStatus] = useState<ChainStatus>("PENDING");
    const [running, setRunning] = useState(false);
    const [runNotice, setRunNotice] = useState<string | null>(null);

    // One source per mode: live loads demo accounts and the connection
    // once per mount and again after every switch back; offline resolves
    // straight to a mock backed ready state. Accounts and the connection
    // live in memory only, never in storage. The loader resolves to a
    // state object, so the catch only guards an unexpected rejection.
    // The alive flag cancels a stale load when the mode changes mid
    // flight, so a late live answer cannot overwrite offline state.
    useEffect(() => {
        let alive = true;
        const loading = createRaceSource(
            mode === "offline" ? { mode: "offline" } : {},
        );
        void loading
            .then((state) => {
                if (alive) {
                    setSource(state);
                }
            })
            .catch(() => {
                if (alive) {
                    setSource({
                        status: "error",
                        message:
                            mode === "offline"
                                ? "The offline demo could not start."
                                : "Demo accounts could not be loaded.",
                    });
                }
            });
        return () => {
            alive = false;
        };
    }, [mode]);

    // Notice shown above the controls: setup state first (worded for
    // the active mode), then whatever the last run reported.
    const notice =
        source.status === "loading"
            ? raceModeCopy(mode).loading
            : source.status === "missing-accounts"
              ? source.guidance
              : source.status === "error"
                ? source.message
                : runNotice;

    // A mode switch clears the race: events, the chain pill, and any
    // run notice belong to the previous mode's ledger, and the source
    // restarts through the effect above, beginning from loading so a
    // stale ready never accepts a run under the new mode. The scenario
    // selection survives, because picking a card again would be busy
    // work for a switch that changes nothing about the picker. Switching
    // mid run is refused: the in flight run would keep streaming into
    // the reset event list.
    function handleModeChange(next: RaceMode): void {
        if (next === mode || running) {
            return;
        }
        setMode(next);
        setSource({ status: "loading" });
        setEvents([]);
        setChainStatus("PENDING");
        setRunNotice(null);
    }

    async function handleRun(kind: ScenarioKind): Promise<void> {
        if (source.status !== "ready" || running) {
            return;
        }
        const spec = getScenario(kind);
        // A second run starts clean: empty stream, fresh chain pill, and
        // the source builds a new engine with a new scenario id base.
        setEvents([]);
        setStreamScenario(spec);
        setChainStatus("PENDING");
        setRunNotice(null);
        setRunning(true);
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
            if (outcome.error !== undefined) {
                setRunNotice(outcome.error);
            }
        } catch (err) {
            // runScenario never rejects today; keep one guard so a future
            // failure still surfaces in the panel instead of vanishing.
            setRunNotice(err instanceof Error ? err.message : String(err));
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
                                    source={
                                        source.status === "ready"
                                            ? "live"
                                            : "disconnected"
                                    }
                                    mode={mode}
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
                                    mode={mode}
                                />
                            ) : (
                                <TicketsPanel
                                    events={events}
                                    scenario={streamScenario}
                                    partyAWallet={
                                        source.status === "ready"
                                            ? source.accounts.partyA.pubkey
                                            : null
                                    }
                                    partyBWallet={
                                        source.status === "ready"
                                            ? source.accounts.partyB.pubkey
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
