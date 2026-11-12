import type { RailStatus, RailView } from "./ticketView";

export interface LifecycleRailProps {
    rail: RailView;
}

/** Screen reader words for the visual progress of a step. */
const STATUS_TEXT: Readonly<Record<RailStatus, string>> = {
    done: "reached",
    current: "current step",
    ahead: "not reached yet",
};

/** Plain words for the lane chips under the rail. */
function stateWord(state: string | null): string {
    return state ?? "no events yet";
}

/**
 * The lifecycle rail: four stations (NEW, ACK, PAYING, terminal) in
 * order, the run's actual state marked with aria-current, each station
 * carrying its transition rule and who causes it from tradeops section
 * 2.1. Static markup only: no animation, so reduced motion needs no
 * special case beyond theme.css's global rule.
 */
export default function LifecycleRail({ rail }: LifecycleRailProps) {
    return (
        <section className="tkt-card" aria-labelledby="tkt-rail-title">
            <div className="tkt-card-head">
                <div>
                    <p className="tkt-eyebrow">Lifecycle rail</p>
                    <h3 id="tkt-rail-title" className="tkt-card-title">
                        Ticket lifecycle
                    </h3>
                </div>
                <p className="tkt-rail-lede">
                    Mapped from this run's provenance events: acknowledgements
                    light ACK, the race start lights PAYING, and the terminal
                    record lights the last station.
                </p>
            </div>

            <ol className="tkt-rail" aria-label="Ticket lifecycle steps">
                {rail.steps.map((step) => (
                    <li
                        key={step.id}
                        className={`tkt-step tkt-step-${step.status} tkt-tone-${step.tone}`}
                        aria-current={
                            step.status === "current" ? "step" : undefined
                        }
                    >
                        <span className="tkt-step-top">
                            <span
                                className="tkt-step-node"
                                aria-hidden="true"
                            />
                            <span className="tkt-step-num" aria-hidden="true">
                                {String(step.index + 1).padStart(2, "0")}
                            </span>
                        </span>
                        <span className="tkt-step-label">{step.label}</span>
                        <span className="tkt-visually-hidden">
                            {STATUS_TEXT[step.status]}
                        </span>
                        <span className="tkt-step-rule">{step.rule}</span>
                        <span className="tkt-step-cause">{step.cause}</span>
                    </li>
                ))}
            </ol>

            <div className="tkt-chips">
                <p className="tkt-chip tkt-chip-sequential">
                    Sequential path: {stateWord(rail.sequentialState)}
                </p>
                <p className="tkt-chip tkt-chip-atomic">
                    Atomic path: {stateWord(rail.atomicState)}
                </p>
            </div>
        </section>
    );
}
