import { SCENARIOS, type ScenarioSpec } from "../../engine/scenarios";

interface ScenarioPickerProps {
    /** Currently selected spec, or null before any choice. */
    selected: ScenarioSpec | null;
    /** Called when the user selects a scenario card. */
    onSelect: (spec: ScenarioSpec) => void;
    /** Catalogue to offer; defaults to the five engine scenarios. */
    scenarios?: readonly ScenarioSpec[];
}

/**
 * Scenario catalogue as selectable cards: label, description, and the two
 * expected outcomes as chips (sequential terminal, atomic terminal).
 * Selection stays available while the engine source is disconnected so
 * the demo can be set up before it runs.
 */
export default function ScenarioPicker({
    selected,
    onSelect,
    scenarios = SCENARIOS,
}: ScenarioPickerProps) {
    return (
        <section className="picker" aria-label="Scenario picker">
            <h3 className="picker-title">Choose a scenario</h3>
            <ul className="picker-list">
                {scenarios.map((spec) => {
                    const isSelected = selected?.kind === spec.kind;
                    return (
                        <li key={spec.kind}>
                            <button
                                type="button"
                                className={`picker-card${
                                    isSelected ? " picker-card-selected" : ""
                                }`}
                                aria-pressed={isSelected}
                                onClick={() => onSelect(spec)}
                            >
                                <span className="picker-label">{spec.label}</span>
                                <span className="picker-desc">{spec.description}</span>
                                <span className="picker-chips">
                                    <span className="picker-chip picker-chip-seq">
                                        Sequential:{" "}
                                        {spec.expected_sequential_terminal}
                                    </span>
                                    <span className="picker-chip picker-chip-atomic">
                                        Atomic: {spec.expected_atomic_terminal}
                                    </span>
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
