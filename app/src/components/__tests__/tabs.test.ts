import { describe, expect, it } from "vitest";
import { TABS, TAB_LABELS, nextTabIndex } from "../tabs";

describe("tab model", () => {
    it("lists four tabs with sentence case labels", () => {
        expect(TABS).toEqual(["race", "tickets", "provenance", "learn"]);
        expect(Object.keys(TAB_LABELS)).toEqual([...TABS]);
        expect(TAB_LABELS).toEqual({
            race: "Race",
            tickets: "Tickets",
            provenance: "Provenance",
            learn: "Learn",
        });
    });
});

describe("nextTabIndex", () => {
    it("wraps arrow keys at both ends", () => {
        expect(nextTabIndex(0, "ArrowRight", 4)).toBe(1);
        expect(nextTabIndex(3, "ArrowRight", 4)).toBe(0);
        expect(nextTabIndex(0, "ArrowLeft", 4)).toBe(3);
        expect(nextTabIndex(2, "ArrowLeft", 4)).toBe(1);
    });

    it("jumps to the ends and ignores unhandled keys", () => {
        expect(nextTabIndex(2, "Home", 4)).toBe(0);
        expect(nextTabIndex(2, "End", 4)).toBe(3);
        expect(nextTabIndex(2, "Tab", 4)).toBeNull();
        expect(nextTabIndex(2, "Enter", 4)).toBeNull();
    });

    it("refuses out of range input", () => {
        expect(nextTabIndex(-1, "ArrowRight", 4)).toBeNull();
        expect(nextTabIndex(4, "ArrowRight", 4)).toBeNull();
        expect(nextTabIndex(0, "ArrowRight", 0)).toBeNull();
    });
});
