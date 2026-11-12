import { useEffect, useState } from "react";
import AppShell from "./components/AppShell";
import { TABS, type TabId } from "./components/tabs";
import "./styles/theme.css";
import "./styles/shell.css";
// Imported after the stylesheets so race.css lands later in the cascade.
import RacePanel from "./components/RacePanel";
import type { ChainStatus } from "./components/race/raceTypes";
import type { RaceEvent } from "./engine/scenarioEngine";
import { getScenario, type ScenarioSpec } from "./engine/scenarios";
import { createRaceSource, type RaceSourceState } from "./lib/raceSource";
import type { ScenarioKind } from "./lib/ticket";

/** Placeholder copy for each tab until its slice lands. */
interface PanelCopy {
    heading: string;
    body: string;
}

const PANELS: Record<TabId, PanelCopy> = {
    race: {
        heading: "Race",
        body: "The side-by-side race view: sequential pay-first against atomic delivery versus payment, replaying five scenarios against one clock.",
    },
    tickets: {
        heading: "Tickets",
        body: "Trade ticket lifecycle viewer: follow each ticket from NEW to its terminal state, with every money amount in integer cents.",
    },
    provenance: {
        heading: "Provenance",
        body: "Hash-chained provenance with a verify step that checks every link against the chain head.",
    },
    learn: {
        heading: "Learn",
        body: "Why CLS exists: the principal risk window that delivery versus payment was built to close.",
    },
};

/**
 * Shell plus the wired race view: tab state, placeholder panels for
 * tickets, provenance, and the educational layer, and a RacePanel fed
 * from createRaceSource. The source loads once on mount and reports one
 * of four states (loading, missing accounts with guidance, ready, error);
 * a run accumulates engine events, flips the chain pill from the
 * verification result, and starts fresh on every press with a new
 * engine instance underneath.
 */
export default function App() {
    const [active, setActive] = useState<TabId>("race");
    const [source, setSource] = useState<RaceSourceState>({ status: "loading" });
    const [events, setEvents] = useState<RaceEvent[]>([]);
    const [streamScenario, setStreamScenario] = useState<ScenarioSpec | null>(
        null,
    );
    const [chainStatus, setChainStatus] = useState<ChainStatus>("PENDING");
    const [running, setRunning] = useState(false);
    const [runNotice, setRunNotice] = useState<string | null>(null);

    // One source per mount: accounts and the connection live in memory
    // only, never in storage. The loader resolves to a state object, so
    // the catch only guards an unexpected rejection.
    useEffect(() => {
        let alive = true;
        void createRaceSource()
            .then((state) => {
                if (alive) {
                    setSource(state);
                }
            })
            .catch(() => {
                if (alive) {
                    setSource({
                        status: "error",
                        message: "Demo accounts could not be loaded.",
                    });
                }
            });
        return () => {
            alive = false;
        };
    }, []);

    // Notice shown above the controls: setup state first, then whatever
    // the last run reported.
    const notice =
        source.status === "loading"
            ? "Loading demo accounts..."
            : source.status === "missing-accounts"
              ? source.guidance
              : source.status === "error"
                ? source.message
                : runNotice;

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
                const copy = PANELS[id];
                const selected = id === active;
                return (
                    <section
                        key={id}
                        className={id === "race" ? "panel panel-race" : "panel"}
                        role="tabpanel"
                        id={`panel-${id}`}
                        aria-labelledby={`tab-${id}`}
                        tabIndex={0}
                        hidden={!selected}
                    >
                        {id === "race" ? (
                            <RacePanel
                                source={
                                    source.status === "ready"
                                        ? "live"
                                        : "disconnected"
                                }
                                events={events}
                                scenario={streamScenario}
                                onRun={handleRun}
                                chainStatus={chainStatus}
                                notice={notice}
                                running={running}
                            />
                        ) : (
                            <>
                                <p className="panel-status">Next slice</p>
                                <h2 className="panel-heading">{copy.heading}</h2>
                                <p className="panel-body">{copy.body}</p>
                            </>
                        )}
                    </section>
                );
            })}
        </AppShell>
    );
}
