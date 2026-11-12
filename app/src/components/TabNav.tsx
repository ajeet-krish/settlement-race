import { useRef, type KeyboardEvent } from "react";
import { TABS, TAB_LABELS, nextTabIndex, type TabId } from "./tabs";

interface TabNavProps {
    active: TabId;
    onChange: (id: TabId) => void;
}

/**
 * Roving tabindex tab strip: only the selected tab is in the tab order,
 * arrow keys plus Home and End move selection and focus together.
 */
export default function TabNav({ active, onChange }: TabNavProps) {
    const buttons = useRef<Array<HTMLButtonElement | null>>([]);

    function handleKeyDown(
        event: KeyboardEvent<HTMLButtonElement>,
        index: number,
    ): void {
        const next = nextTabIndex(index, event.key, TABS.length);
        if (next === null) {
            return;
        }
        const id = TABS[next];
        if (id === undefined) {
            return;
        }
        event.preventDefault();
        onChange(id);
        buttons.current[next]?.focus();
    }

    return (
        <nav className="tabnav" aria-label="Sections">
            <div className="tablist" role="tablist" aria-label="Sections">
                {TABS.map((id, index) => {
                    const selected = id === active;
                    return (
                        <button
                            key={id}
                            ref={(node) => {
                                buttons.current[index] = node;
                            }}
                            type="button"
                            role="tab"
                            id={`tab-${id}`}
                            className={`tab${selected ? " tab-selected" : ""}`}
                            aria-selected={selected}
                            aria-controls={`panel-${id}`}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => onChange(id)}
                            onKeyDown={(event) => handleKeyDown(event, index)}
                        >
                            {TAB_LABELS[id]}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
