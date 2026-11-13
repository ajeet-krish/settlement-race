import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import * as content from "../learnContent";
import {
    CITATIONS,
    CLS_LIMITS_BOX,
    COMPARISON_ROWS,
    HOOK,
    LEARN_SECTIONS,
    RAILS,
} from "../learnContent";
import LearnPanel from "../LearnPanel";

/**
 * Content structure of the Learn view. No DOM library: the structure
 * assertions read the pure data in learnContent, and the mount check
 * renders static markup through react-dom/server, which is already a
 * dependency. These tests pin the educational contract: required
 * sections in narrative order, the mandated honesty box topics, the
 * six by three comparison table, and citation integrity against
 * docs/research.md section 10.
 */

const REQUIRED_SECTION_IDS = [
    "risk-window",
    "what-cls-does",
    "honest-limits",
    "atomic-settlement",
    "comparison",
    "trust",
] as const;

/** Recursively gather every string in a content value. */
function collectStrings(value: unknown, out: string[]): void {
    if (typeof value === "string") {
        out.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            collectStrings(entry, out);
        }
        return;
    }
    if (value !== null && typeof value === "object") {
        for (const entry of Object.values(value)) {
            collectStrings(entry, out);
        }
    }
}

describe("learn content structure", () => {
    it("lists the required sections in narrative order, without duplicates", () => {
        const ids = LEARN_SECTIONS.map((section) => section.id);
        const positions = REQUIRED_SECTION_IDS.map((id) => ids.indexOf(id));

        expect(positions.every((position) => position >= 0)).toBe(true);
        // Ascending positions prove the required sections keep order.
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("covers every mandated topic in the CLS honesty box", () => {
        const text = [
            CLS_LIMITS_BOX.title,
            CLS_LIMITS_BOX.intro,
            ...CLS_LIMITS_BOX.items.flatMap((item) => [item.term, item.body]),
            CLS_LIMITS_BOX.footer,
        ]
            .join(" ")
            .toLowerCase();

        expect(text).toContain("multilateral netting");
        expect(text).toContain("n = g");
        expect(text).toContain("intraday credit");
        expect(text).toContain("central bank money");
        expect(text).toContain("legal finality");
        expect(text).toMatch(/simulated|scripted|staged/);
        expect(text).toContain("toy scale");
        expect(text).toContain("play money");
        expect(text).toContain("devnet");
    });

    it("builds the comparison table from three rails and six dimensions", () => {
        expect(RAILS.map((rail) => rail.key)).toEqual([
            "wire",
            "cls",
            "stable",
        ]);
        expect(COMPARISON_ROWS.map((row) => row.label)).toEqual([
            "Settlement mechanism",
            "Risk exposure",
            "Finality",
            "Netting",
            "Availability",
            "Status in this demo",
        ]);
        for (const row of COMPARISON_ROWS) {
            expect(row.cells.wire.trim()).not.toBe("");
            expect(row.cells.cls.trim()).not.toBe("");
            expect(row.cells.stable.trim()).not.toBe("");
        }
    });

    it("resolves every inline citation token to a listed source", () => {
        const strings: string[] = [];
        for (const value of Object.values(content)) {
            collectStrings(value, strings);
        }

        const used = new Set<number>();
        for (const text of strings) {
            for (const match of text.matchAll(/\[(\d+)\]/g)) {
                used.add(Number(match[1]));
            }
        }

        const defined = new Set(Object.keys(CITATIONS).map(Number));
        expect(used.size).toBeGreaterThan(20);
        // No token points at a missing source, and no source rots unused.
        expect([...used].filter((num) => !defined.has(num))).toEqual([]);
        expect([...defined].filter((num) => !used.has(num))).toEqual([]);
    });

    it("mounts the thesis, nav anchors, honesty box, and comparison region", () => {
        const markup = renderToStaticMarkup(<LearnPanel />);

        expect(markup).toContain(HOOK);
        for (const section of LEARN_SECTIONS) {
            expect(markup).toContain(`href="#${section.id}"`);
            expect(markup).toContain(`id="${section.id}"`);
        }
        expect(markup).toContain("What CLS does that this does not");
        expect(markup).toContain("N = G");
        expect(markup).toContain('role="table"');
        expect(markup).toContain('aria-labelledby="learn-table-caption"');
        // Narrow screens restack the table into labelled blocks, so every
        // rail value carries its rail name in the markup.
        expect(markup).toContain('class="learn-cell-label"');
        expect(markup).toContain('id="cite-14"');
    });
});
