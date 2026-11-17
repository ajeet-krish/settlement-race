import type { Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import App, {
    AUTO_FALLBACK_NOTICE,
    applyModeSwitch,
    applyRunStart,
    applySourceResolved,
    createModeSession,
    noticeForSession,
    panelSource,
    type ModeSession,
} from "../App";
import RacePanel from "../components/RacePanel";
import type { RaceEvent } from "../engine/scenarioEngine";
import { getScenario } from "../engine/scenarios";
import { DEMO_ACCOUNTS_MISSING_GUIDANCE } from "../lib/demoAccounts";
import {
    createRaceSource,
    type RaceSourceReady,
    type RaceSourceState,
} from "../lib/raceSource";

/**
 * Auto fallback to the offline demo: the mode session transitions the
 * shell actually runs. The node environment has no DOM library (the
 * established judgment call for these component suites), so the
 * behavior lives in the pure session functions exported from App.tsx.
 * This file drives them through the exact sequences the source effect
 * and the handlers issue; the visitor visible outcome (notice text,
 * Run gating, badge) is then asserted on RacePanel markup rendered
 * with the props App derives from the session through panelSource and
 * noticeForSession. The ready sources in the fixtures come from the
 * real createRaceSource factory, so the offline run asserted here is
 * the same path handleRun drives.
 */

/** The resolved live source a deployed build gets for the absent file. */
const MISSING: RaceSourceState = {
    status: "missing-accounts",
    guidance: DEMO_ACCOUNTS_MISSING_GUIDANCE,
};

/**
 * Ready sources for both modes from the real factory: offline first,
 * then live reusing those (offline generated) accounts behind an
 * injected connection stub, so nothing here touches the network.
 */
async function readyStates(): Promise<{
    live: RaceSourceReady;
    offline: RaceSourceReady;
}> {
    const offline = await createRaceSource({ mode: "offline" });
    if (offline.status !== "ready") {
        throw new Error(`expected offline ready, got ${offline.status}`);
    }
    const live = await createRaceSource({
        loadAccounts: async () => offline.accounts,
        connection: {
            getAccountInfo: async () => null,
        } as unknown as Connection,
    });
    if (live.status !== "ready") {
        throw new Error(`expected live ready, got ${live.status}`);
    }
    return { live, offline };
}

/** The Run button's opening tag, for disabled and hint assertions. */
function runButton(markup: string): string {
    const match = markup.match(/<button[^>]*timeline-run[^>]*>/);
    if (match === null) {
        throw new Error("Run button not found in markup");
    }
    return match[0];
}

/**
 * RacePanel markup with exactly the props App derives for a session:
 * panelSource for the transport, session.mode, and noticeForSession.
 * A supplied scenario stands in for the visitor having picked a card.
 */
function panelMarkup(
    session: ModeSession,
    scenario: ReturnType<typeof getScenario> | null = null,
): string {
    return renderToStaticMarkup(
        <RacePanel
            source={panelSource(session)}
            mode={session.mode}
            notice={noticeForSession(session)}
            onModeChange={() => {}}
            scenario={scenario}
        />,
    );
}

/** Drive the shell sequence: live resolves absent, then offline loads. */
async function fellBackSession(): Promise<ModeSession> {
    const states = await readyStates();
    const fell = applySourceResolved(createModeSession(), MISSING);
    return applySourceResolved(fell, states.offline);
}

describe("auto fallback to the offline demo", () => {
    it("switches an initial missing accounts load to offline with the notice, a ready source, and an enabled Run", async () => {
        const states = await readyStates();
        const initial = createModeSession();
        expect(initial.mode).toBe("live");
        expect(initial.fellBack).toBe(false);

        // Live resolves to the absent file: the session leaves live
        // mode, latches the once per session flag, keeps the source
        // loading for the offline reload, and picks up the notice.
        const fell = applySourceResolved(initial, MISSING);
        expect(fell.mode).toBe("offline");
        expect(fell.fellBack).toBe(true);
        expect(fell.source).toEqual({ status: "loading" });
        expect(fell.runNotice).toBe(AUTO_FALLBACK_NOTICE);

        // The effect reloads offline and the mock ready state lands.
        const ready = applySourceResolved(fell, states.offline);
        expect(ready.mode).toBe("offline");
        expect(ready.source.status).toBe("ready");
        expect(panelSource(ready)).toBe("live");
        expect(noticeForSession(ready)).toBe(AUTO_FALLBACK_NOTICE);

        // Visitor visible outcome: fallback notice as an alert, the
        // offline badge, and Run gated only on the scenario card.
        const markup = panelMarkup(ready, getScenario("honest"));
        expect(markup).toContain(AUTO_FALLBACK_NOTICE);
        expect(markup).toContain('role="alert"');
        expect(markup).toContain("mode-badge-offline");
        expect(markup).not.toContain(DEMO_ACCOUNTS_MISSING_GUIDANCE);
        expect(runButton(markup)).not.toContain("disabled");

        // Run works end to end on the same offline source the session
        // holds: events stream in order and mock verification passes.
        const events: RaceEvent[] = [];
        const outcome = await states.offline.runScenario(
            getScenario("honest"),
            (event) => {
                events.push(event);
            },
        );
        expect(outcome.chain_ok).toBe(true);
        expect(outcome.error).toBeUndefined();
        expect(events.length).toBeGreaterThan(10);
        expect(events[0]?.event).toBe("TICKET_CREATED");
        expect(events.at(-1)?.event).toBe("CHAIN_ANCHORED");
    });

    it("keeps live mode and shows the guidance when the visitor returns to live after a fallback", async () => {
        const fell = applySourceResolved(createModeSession(), MISSING);
        expect(fell.fellBack).toBe(true);

        // The manual switch back to live consumes the fallback notice,
        // keeps the latch, and restarts the source through loading.
        const live = applyModeSwitch(fell, "live", false);
        expect(live.mode).toBe("live");
        expect(live.runNotice).toBeNull();
        expect(live.fellBack).toBe(true);
        expect(live.source).toEqual({ status: "loading" });

        // The reload finds the same absent file: this time the session
        // stays live and surfaces the setup guidance instead of
        // falling back a second time.
        const resolved = applySourceResolved(live, MISSING);
        expect(resolved.mode).toBe("live");
        expect(resolved.fellBack).toBe(true);
        expect(resolved.source.status).toBe("missing-accounts");
        expect(noticeForSession(resolved)).toBe(DEMO_ACCOUNTS_MISSING_GUIDANCE);

        const markup = panelMarkup(resolved);
        expect(markup).toContain(DEMO_ACCOUNTS_MISSING_GUIDANCE);
        expect(markup).not.toContain(AUTO_FALLBACK_NOTICE);
        expect(markup).toContain('role="note"');
        expect(markup).toContain('title="Engine source not connected yet"');
        expect(runButton(markup)).toContain("disabled");

        // The latch survives any number of further switches: another
        // round trip through offline still cannot arm the fallback.
        const offlineAgain = applyModeSwitch(resolved, "offline", false);
        expect(offlineAgain.fellBack).toBe(true);
        expect(applyModeSwitch(offlineAgain, "live", false).fellBack).toBe(
            true,
        );
    });

    it("does not switch modes when the live load succeeds", async () => {
        const states = await readyStates();
        const ready = applySourceResolved(createModeSession(), states.live);

        expect(ready.mode).toBe("live");
        expect(ready.fellBack).toBe(false);
        expect(ready.source).toBe(states.live);
        expect(ready.runNotice).toBeNull();
        expect(noticeForSession(ready)).toBeNull();
        expect(panelSource(ready)).toBe("live");

        const markup = panelMarkup(ready, getScenario("honest"));
        expect(markup).not.toContain(AUTO_FALLBACK_NOTICE);
        expect(markup).not.toContain('class="race-notice"');
        expect(markup).not.toContain('class="race-disconnected"');
        expect(runButton(markup)).not.toContain("disabled");
    });

    it.each([
        "Demo accounts request failed with HTTP 500.",
        "Demo accounts could not be fetched from the app server.",
        "demo-accounts.json is not valid JSON.",
    ])(
        "keeps live mode for the load error %s, so only the absent file state falls back",
        (message) => {
            const failed = applySourceResolved(createModeSession(), {
                status: "error",
                message,
            });
            expect(failed.mode).toBe("live");
            expect(failed.fellBack).toBe(false);
            expect(noticeForSession(failed)).toBe(message);
        },
    );

    it("carries the fallback notice until a run starts or the mode switches", async () => {
        const ready = await fellBackSession();
        expect(noticeForSession(ready)).toBe(AUTO_FALLBACK_NOTICE);

        // A run start consumes the notice: the ready source then shows
        // nothing above the controls, and the latch stays armed.
        const started = applyRunStart(ready);
        expect(started.runNotice).toBeNull();
        expect(started.fellBack).toBe(true);
        expect(noticeForSession(started)).toBeNull();
        const markup = panelMarkup(started, getScenario("honest"));
        expect(markup).not.toContain(AUTO_FALLBACK_NOTICE);
        expect(markup).not.toContain('class="race-notice"');
        expect(runButton(markup)).not.toContain("disabled");

        // A mode switch consumes it too, while a switch refused during
        // a run leaves the session exactly as it was.
        const switched = applyModeSwitch(ready, "live", false);
        expect(switched.runNotice).toBeNull();
        expect(applyModeSwitch(ready, "live", true)).toBe(ready);
    });

    it("keeps the fallback copy free of em dashes, en dashes, and double hyphens", () => {
        expect(AUTO_FALLBACK_NOTICE).not.toMatch(/[\u2014\u2013]|--/);
        expect(AUTO_FALLBACK_NOTICE.length).toBeGreaterThan(0);
    });

    it("renders the shell with the live loading line before any source resolves", () => {
        const markup = renderToStaticMarkup(<App />);
        expect(markup).toContain("Settlement Race");
        expect(markup).toContain("Loading demo accounts...");
        expect(markup).toContain("Devnet live");
        expect(markup).toContain('title="Engine source not connected yet"');
        expect(markup).not.toContain(AUTO_FALLBACK_NOTICE);
    });
});
