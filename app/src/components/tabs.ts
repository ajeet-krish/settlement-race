/**
 * Tab model for the shell. Kept as pure data and pure functions so the
 * roving tabindex keyboard math is testable without a DOM.
 */

/** The four sections of the shell. */
export type TabId = "race" | "tickets" | "provenance" | "learn";

/** Tabs in presentation order. */
export const TABS: readonly TabId[] = [
    "race",
    "tickets",
    "provenance",
    "learn",
];

/** Visible label for each tab, sentence case. */
export const TAB_LABELS: Readonly<Record<TabId, string>> = {
    race: "Race",
    tickets: "Tickets",
    provenance: "Provenance",
    learn: "Theory",
};

/**
 * Roving tabindex math: map an arrow, Home, or End key to the index of
 * the tab that should take focus. Returns null for keys the tablist
 * does not handle, and wraps at both ends.
 */
export function nextTabIndex(
    current: number,
    key: string,
    count: number,
): number | null {
    if (count <= 0 || current < 0 || current >= count) {
        return null;
    }
    switch (key) {
        case "ArrowRight":
            return (current + 1) % count;
        case "ArrowLeft":
            return (current - 1 + count) % count;
        case "Home":
            return 0;
        case "End":
            return count - 1;
        default:
            return null;
    }
}
