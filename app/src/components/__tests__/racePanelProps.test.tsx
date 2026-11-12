import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RacePanel, { type RacePanelProps } from "../RacePanel";
import { getScenario } from "../../engine/scenarios";

/**
 * Props contract of RacePanel, rendered through react-dom/server (already
 * a dependency) so no DOM testing library is introduced: the node test
 * environment stays DOM free and the assertions read static markup.
 * Effects never run during server rendering, which is exactly what these
 * cases need: they pin prop to markup mapping only (default copy,
 * notice branching, run button gating, chain pill passthrough).
 */

function render(props: RacePanelProps = {}): string {
    return renderToStaticMarkup(<RacePanel {...props} />);
}

/** The Run button's opening tag, for disabled and hint assertions. */
function runButton(markup: string): string {
    const match = markup.match(/<button[^>]*timeline-run[^>]*>/);
    if (match === null) {
        throw new Error("Run button not found in markup");
    }
    return match[0];
}

describe("RacePanel props contract", () => {
    it("renders the disconnected default copy, a disabled Run, and the default chain pill", () => {
        const markup = render();

        expect(markup).toContain("Demo accounts are not ready yet");
        expect(markup).toContain('role="note"');
        expect(runButton(markup)).toContain("disabled");
        expect(markup).toContain('title="Engine source not connected yet"');
        expect(markup).toContain('chain-pill-pending');
        expect(markup).toContain("chain pending");
    });

    it("shows the supplied notice instead of the default copy while disconnected", () => {
        const markup = render({
            source: "disconnected",
            notice: "Run npx tsx scripts/setup-devnet.ts first",
        });

        expect(markup).toContain("Run npx tsx scripts/setup-devnet.ts first");
        expect(markup).not.toContain("Demo accounts are not ready yet");
        // While disconnected the slip keeps role="note" (alert is the
        // live branch, covered below), so the branch contract is pinned.
        expect(markup).toContain('role="note"');
        expect(markup).not.toContain('role="alert"');
        expect(runButton(markup)).toContain("disabled");
    });

    it("drops the disconnected copy when live, and gates Run on a selected scenario", () => {
        const markup = render({
            source: "live",
            notice: "Run failed: BadState: clock already advanced",
        });

        expect(markup).toContain("Run failed: BadState: clock already advanced");
        expect(markup).not.toContain("Demo accounts are not ready yet");
        // The live branch escalates a run failure to role="alert".
        expect(markup).toContain('role="alert"');
        expect(markup).not.toContain('role="note"');
        // Live but no scenario card selected yet: Run stays disabled
        // with the picker hint rather than the disconnected hint.
        expect(runButton(markup)).toContain("disabled");
        expect(markup).toContain('title="Choose a scenario first"');
    });

    it("renders neither notice block when live with no notice", () => {
        const markup = render({ source: "live" });

        expect(markup).not.toContain('class="race-disconnected"');
        expect(markup).not.toContain('class="race-notice"');
        expect(markup).not.toContain("Demo accounts are not ready yet");
    });

    it("passes chainStatus through to the pill wording and class", () => {
        const valid = render({ source: "live", chainStatus: "VALID" });
        expect(valid).toContain("chain-pill-valid");
        expect(valid).toContain("chain valid");

        const broken = render({ source: "live", chainStatus: "BROKEN" });
        expect(broken).toContain("chain-pill-broken");
        expect(broken).toContain("chain broken");
    });

    it("keeps Run enabled in markup semantics for live plus a scenario", () => {
        // A scenario prop selects a card, so hasScenario flips the hint
        // while source live keeps the button interactive (not disabled).
        const markup = render({
            source: "live",
            scenario: getScenario("honest"),
        });
        expect(runButton(markup)).not.toContain("disabled");
        expect(markup).toContain("picker-card-selected");
    });
});

describe("RacePanel mode switch", () => {
    it("renders the live switch, devnet badge, and devnet evidence with no note", () => {
        const markup = render({
            source: "live",
            chainStatus: "VALID",
            mode: "live",
            onModeChange: () => {},
        });

        expect(markup).toContain('aria-label="Settlement source"');
        expect(markup).toContain('aria-pressed="true"');
        expect(markup).toContain("Live devnet");
        expect(markup).toContain("Offline demo");
        expect(markup).toContain("Devnet live");
        expect(markup).toContain("chain valid (devnet)");
        expect(markup).not.toContain('class="race-mode-note"');
    });

    it("renders the offline badge, mock evidence, and the tradeoff note", () => {
        const markup = render({
            source: "live",
            chainStatus: "VALID",
            mode: "offline",
            onModeChange: () => {},
        });

        expect(markup).toContain("mode-badge-offline");
        expect(markup).toContain("chain valid (mock)");
        expect(markup).toContain('class="race-mode-note"');
        expect(markup).toContain("in-memory ledger");
        expect(markup).toContain("no transactions");
    });

    it("hides the switch when no handler is supplied, keeping the badge", () => {
        const markup = render({ source: "live" });

        expect(markup).not.toContain('aria-label="Settlement source"');
        expect(markup).toContain("Devnet live");
    });
});
