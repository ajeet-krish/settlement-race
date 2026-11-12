import { useMemo } from "react";
import type { RaceEvent } from "../engine/scenarioEngine";
import type { ScenarioSpec } from "../engine/scenarios";
import LifecycleRail from "./tickets/LifecycleRail";
import SchemaReference from "./tickets/SchemaReference";
import TicketHeaderCard from "./tickets/TicketHeaderCard";
import { deriveTicketView, railFromEvents } from "./tickets/ticketView";
import "../styles/tickets.css";

export interface TicketsPanelProps {
    /**
     * Events accumulated by the race tab, in stream order. The panel
     * derives both the rebuilt ticket and the lifecycle rail from this
     * stream, so the race view stays the single source of run data.
     */
    events?: readonly RaceEvent[];
    /** Scenario spec of the last run, needed to rebuild the notionals. */
    scenario?: ScenarioSpec | null;
    /** Party A wallet the run signed with (demo accounts, when loaded). */
    partyAWallet?: string | null;
    /** Party B wallet the run raced against (demo accounts, when loaded). */
    partyBWallet?: string | null;
}

/**
 * Tickets view: the run's trade ticket as a slip, the lifecycle rail
 * mapped from provenance, and the schema reference. Everything derives
 * from props (events, scenario, wallets); the component holds no run
 * state of its own, so a new run or a mode switch re-derives cleanly.
 * When nothing has run yet the panel shows the invite instead of a
 * half built ticket.
 */
export default function TicketsPanel({
    events = [],
    scenario = null,
    partyAWallet = null,
    partyBWallet = null,
}: TicketsPanelProps) {
    const view = useMemo(
        () =>
            deriveTicketView({
                scenario,
                partyAWallet,
                partyBWallet,
                events,
            }),
        [scenario, partyAWallet, partyBWallet, events],
    );
    const rail = useMemo(() => railFromEvents(events), [events]);

    return (
        <div className="tkt">
            <header className="tkt-head">
                <div>
                    <h2 className="panel-heading">Tickets</h2>
                    <p className="tkt-lede">
                        The single trade ticket both settlement lanes raced on,
                        rebuilt from the run's scenario and provenance events,
                        then checked against the recorded ticket hash. Money
                        stays in integer cents, on devnet play money only.
                    </p>
                </div>
            </header>

            {view === null ? (
                <div className="tkt-empty" role="note">
                    <p className="tkt-empty-title">
                        Run a scenario to see its trade ticket
                    </p>
                    <p className="tkt-empty-body">
                        Open the Race tab, pick one of the five scenarios, and
                        press Run. The ticket both parties acknowledged appears
                        here with its lifecycle rail.
                    </p>
                </div>
            ) : (
                <>
                    <TicketHeaderCard view={view} />
                    {rail !== null ? <LifecycleRail rail={rail} /> : null}
                    <SchemaReference />
                </>
            )}
        </div>
    );
}
