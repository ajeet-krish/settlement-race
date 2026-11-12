import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guards the panel width override. shell.css's .panel cap reads a custom
 * property, and .panel-race sets that property on the element itself, so
 * the race panel may be wider than 44rem no matter which stylesheet is
 * imported first. A literal competing max-width declaration would depend
 * on import order and is what this test exists to catch.
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

    it("reads the cap from a custom property with a 44rem fallback", () => {
        expect(shellCss).toMatch(
            /\.panel\s*\{\s*max-width:\s*var\(--panel-max,\s*44rem\);/,
        );
    });

    it("sets the override on the modifier, not a competing declaration", () => {
        const modifier = /\.panel-race\s*\{[^}]*\}/.exec(raceCss);
        expect(modifier).not.toBeNull();
        expect(modifier?.[0]).toContain("--panel-max: 78rem");
        // A max-width here would win or lose purely on import order.
        expect(modifier?.[0]).not.toContain("max-width");
    });

    it("puts both classes on the same element for the race panel only", () => {
        const appTsx = readFileSync(
            new URL("../../App.tsx", import.meta.url),
            "utf8",
        );
        // The custom property only helps because the element carrying
        // .panel-race also carries .panel, which reads it.
        expect(appTsx).toContain('"panel panel-race"');
        expect(appTsx).toContain(': "panel"}');
    });
});
