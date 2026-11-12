import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the panel width override. shell.css's .panel cap reads a custom
 * property, and .panel-race and .panel-learn each set that property on
 * the element itself, so those panels may be wider than 44rem no matter
 * which stylesheet is imported first. A literal competing max-width
 * declaration would depend on import order and is what this test exists
 * to catch.
 */
describe("panel max width", () => {
    const shellCss = readFileSync(
        new URL("../shell.css", import.meta.url),
        "utf8",
    );
    const raceCss = readFileSync(
        new URL("../race.css", import.meta.url),
        "utf8",
    );
    const learnCss = readFileSync(
        new URL("../learn.css", import.meta.url),
        "utf8",
    );

    it("reads the cap from a custom property with a 44rem fallback", () => {
        expect(shellCss).toMatch(
            /\.panel\s*\{\s*max-width:\s*var\(--panel-max,\s*44rem\);/,
        );
    });

    it("sets the override on the race modifier, not a competing declaration", () => {
        const modifier = /\.panel-race\s*\{[^}]*\}/.exec(raceCss);
        expect(modifier).not.toBeNull();
        expect(modifier?.[0]).toContain("--panel-max: 78rem");
        // A max-width here would win or lose purely on import order.
        expect(modifier?.[0]).not.toContain("max-width");
    });

    it("sets the override on the learn modifier, not a competing declaration", () => {
        const modifier = /\.panel-learn\s*\{[^}]*\}/.exec(learnCss);
        expect(modifier).not.toBeNull();
        expect(modifier?.[0]).toContain("--panel-max: 66rem");
        // Same import order hazard as the race modifier.
        expect(modifier?.[0]).not.toContain("max-width");
    });

    it("puts both classes on the same element for the race and learn panels", () => {
        const appTsx = readFileSync(
            new URL("../../App.tsx", import.meta.url),
            "utf8",
        );
        // The custom property only helps because the element carrying
        // .panel-race or .panel-learn also carries .panel, which reads it.
        expect(appTsx).toContain('"panel panel-race"');
        expect(appTsx).toContain('"panel panel-learn"');
        expect(appTsx).toContain(': "panel"}');
    });
});
