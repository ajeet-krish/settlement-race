/**
 * Pure logic tests for the tickets view: ticket reconstruction from a
 * run's spec and event stream (field values against the scenario
 * catalogue, hash against the engine's own TICKET_CREATED record),
 * lifecycle rail mapping for all five scenario outcomes plus partial
 * streams, rate formatting, and the empty state derivation. The engine
 * runs here against the in memory MockProgramClient, exactly as the
 * offline source does, so the event sequences are the real ones. No
 * DOM library: nothing renders.
 */

import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import {
    RACE_ID,
    ScenarioEngine,
    type RaceEvent,
} from "../../../engine/scenarioEngine";
import {
    DEFAULT_GAP_MS,
    LEG1_USD_CENTS,
    LEG2_CAD_CENTS,
    SCENARIOS,
    getScenario,
    type ScenarioSpec,
} from "../../../engine/scenarios";
import type { AnchorWallet } from "../../../lib/anchorClient";
import { MockProgramClient } from "../../../lib/mockClient";
import { ticketHash, validateTicket } from "../../../lib/ticket";
import { makeEvent } from "../../race/__tests__/eventFixtures";
import {
    TICKET_FIELD_DOCS,
    buildRunTicket,
    deriveTicketView,
    formatRateScaled,
    railFromEvents,
    recordedTicketHash,
    shortHash,
    truncateWallet,
} from "../ticketView";

const PARTY_A_KP = Keypair.generate();
const PARTY_B_KP = Keypair.generate();
const DRIVER_KP = Keypair.generate();
const PARTY_A_WALLET = PARTY_A_KP.publicKey.toBase58();
const PARTY_B_WALLET = PARTY_B_KP.publicKey.toBase58();

/** Run one scenario through the real engine with the offline client. */
async function runEvents(spec: ScenarioSpec): Promise<RaceEvent[]> {
    const wallet: AnchorWallet = {
        publicKey: PARTY_A_KP.publicKey,
        signTransaction: async (tx) => tx,
        signAllTransactions: async (txs) => txs,
    };
    const engine = new ScenarioEngine({
        client: new MockProgramClient(),
        driver: DRIVER_KP,
        partyA: PARTY_A_KP.publicKey,
        partyB: PARTY_B_KP.publicKey,
        wallet,
        anchor_head: true,
    });
    const events: RaceEvent[] = [];
    for await (const event of engine.run(spec)) {
        events.push(event);
    }
    return events;
}

/** The shared setup prefix every engine run replays, in stream order. */
function setupEvents(): RaceEvent[] {
    return [
        makeEvent({ event: "TICKET_CREATED", ts: 0n, data: { ticket_id: RACE_ID } }),
        makeEvent({ event: "ACK_A", ts: 100n }),
        makeEvent({ event: "ACK_B", ts: 200n }),
        makeEvent({ event: "RACE_STARTED", ts: 1000n }),
    ];
}

describe("ticket derivation from the run", () => {
    for (const spec of SCENARIOS) {
        it(`rebuilds the canonical ticket for ${spec.kind}`, async () => {
            const events = await runEvents(spec);
            const view = deriveTicketView({
                scenario: spec,
                partyAWallet: PARTY_A_WALLET,
                partyBWallet: PARTY_B_WALLET,
                events,
            });
            expect(view).not.toBeNull();
            if (view === null) {
                throw new Error("expected a ticket view");
            }

            // The rebuilt hash is the hash both lanes stored: proof the
            // mirror of the engine's constants did not drift.
            expect(view.hashCheck).toBe("match");
            expect(view.recordedHash).toBe(view.ticket.ticket_hash);
            expect(view.ticket.ticket_hash).toBe(recordedTicketHash(events));

            const ticket = view.ticket;
            expect(ticket.ticket_id).toBe(RACE_ID);
            expect(ticket.schema_version).toBe(1);
            expect(ticket.symbol).toBe("USD/CAD");
            expect(ticket.side).toBe("BUY_CAD");
            expect(ticket.settlement_path).toBe("SEQUENTIAL");
            expect(ticket.lifecycle).toBe("NEW");
            expect(ticket.trade_date).toBe("2026-11-11");
            expect(ticket.value_date).toBe("2026-11-13");
            expect(ticket.party_a).toEqual({
                desk_id: "DESK-A",
                wallet: PARTY_A_WALLET,
            });
            expect(ticket.party_b).toEqual({
                desk_id: "DESK-B",
                wallet: PARTY_B_WALLET,
            });

            // Notionals and gap come straight from the scenario catalogue.
            expect(ticket.base_amount_cents).toBe(LEG1_USD_CENTS.toString());
            expect(ticket.base_amount_cents).toBe(
                spec.leg1_usd_cents.toString(),
            );
            expect(ticket.quote_amount_cents).toBe(LEG2_CAD_CENTS.toString());
            expect(ticket.quote_amount_cents).toBe(
                spec.leg2_cad_cents.toString(),
            );
            expect(ticket.gap_ms).toBe(DEFAULT_GAP_MS);
            expect(ticket.gap_ms).toBe(spec.gap_ms);
            expect(ticket.scenario).toBe(spec.kind);

            // Rate: integer math over the catalogue amounts.
            expect(ticket.rate_scale).toBe(1_000_000);
            expect(ticket.rate_scaled).toBe(
                (
                    (spec.leg2_cad_cents * 1_000_000n) /
                    spec.leg1_usd_cents
                ).toString(),
            );

            // The rebuild is a valid ticket whose own hash is consistent.
            expect(() => validateTicket(ticket)).not.toThrow();
            expect(ticketHash(ticket)).toBe(ticket.ticket_hash);
        });
    }

    it("returns null when the run has produced no events yet", () => {
        expect(
            deriveTicketView({
                scenario: getScenario("honest"),
                partyAWallet: PARTY_A_WALLET,
                partyBWallet: PARTY_B_WALLET,
                events: [],
            }),
        ).toBeNull();
    });

    it("returns null without a scenario or a wallet", () => {
        const events = [makeEvent({ event: "TICKET_CREATED", ts: 0n })];
        expect(
            deriveTicketView({
                scenario: null,
                partyAWallet: PARTY_A_WALLET,
                partyBWallet: PARTY_B_WALLET,
                events,
            }),
        ).toBeNull();
        expect(
            deriveTicketView({
                scenario: getScenario("honest"),
                partyAWallet: null,
                partyBWallet: PARTY_B_WALLET,
                events,
            }),
        ).toBeNull();
        expect(
            deriveTicketView({
                scenario: getScenario("honest"),
                partyAWallet: PARTY_A_WALLET,
                partyBWallet: "",
                events,
            }),
        ).toBeNull();
    });
});

describe("hash check labeling", () => {
    const scenario = getScenario("honest");

    it("reports a mismatch when the record carries a different hash", () => {
        const events = [
            makeEvent({
                event: "TICKET_CREATED",
                ts: 0n,
                data: { ticket_id: RACE_ID, ticket_hash: "0".repeat(64) },
            }),
        ];
        const view = deriveTicketView({
            scenario,
            partyAWallet: PARTY_A_WALLET,
            partyBWallet: PARTY_B_WALLET,
            events,
        });
        expect(view?.hashCheck).toBe("mismatch");
        expect(view?.recordedHash).toBe("0".repeat(64));
    });

    it("reports absent when no TICKET_CREATED record exists", () => {
        const events = [makeEvent({ event: "ACK_A", ts: 100n })];
        const view = deriveTicketView({
            scenario,
            partyAWallet: PARTY_A_WALLET,
            partyBWallet: PARTY_B_WALLET,
            events,
        });
        expect(view?.hashCheck).toBe("absent");
        expect(view?.recordedHash).toBeNull();
        expect(recordedTicketHash(events)).toBeNull();
    });

    it("reads the first TICKET_CREATED record in stream order", () => {
        const events = [
            makeEvent({
                event: "TICKET_CREATED",
                ts: 0n,
                data: { ticket_hash: "a".repeat(64) },
            }),
            makeEvent({
                event: "TICKET_CREATED",
                ts: 1n,
                data: { ticket_hash: "b".repeat(64) },
            }),
        ];
        expect(recordedTicketHash(events)).toBe("a".repeat(64));
    });
});

describe("lifecycle rail mapping", () => {
    for (const spec of SCENARIOS) {
        it(`maps the ${spec.kind} outcome onto the terminal station`, async () => {
            const events = await runEvents(spec);
            const rail = railFromEvents(events);
            expect(rail).not.toBeNull();
            if (rail === null) {
                throw new Error("expected a rail view");
            }

            // The ticket's own path is the sequential one, so its state
            // and the highlighted station follow the spec's contract.
            expect(rail.sequentialState).toBe(
                spec.expected_sequential_terminal,
            );
            expect(rail.current).toBe(spec.expected_sequential_terminal);
            expect(rail.atomicState).toBe(spec.expected_atomic_terminal);
            expect(rail.terminal).toBe(spec.expected_sequential_terminal);
            expect(rail.steps).toHaveLength(4);

            // Exactly one current station, the terminal one, with the
            // three earlier stations already reached.
            const current = rail.steps.filter((s) => s.status === "current");
            expect(current).toHaveLength(1);
            expect(current[0]?.id).toBe("TERMINAL");
            expect(rail.steps[0]?.status).toBe("done");
            expect(rail.steps[1]?.status).toBe("done");
            expect(rail.steps[2]?.status).toBe("done");
            expect(rail.steps[3]?.label).toBe(
                spec.expected_sequential_terminal,
            );
            expect(rail.steps[3]?.tone).toBe(
                spec.expected_sequential_terminal === "SETTLED"
                    ? "teal"
                    : "clay",
            );
        });
    }

    it("holds at NEW before any acknowledgement", () => {
        const rail = railFromEvents([
            makeEvent({ event: "TICKET_CREATED", ts: 0n }),
        ]);
        expect(rail?.current).toBe("NEW");
        expect(rail?.steps[0]?.status).toBe("current");
        expect(rail?.steps[1]?.status).toBe("ahead");
        expect(rail?.atomicState).toBeNull();
    });

    it("keeps NEW on the first acknowledgement alone", () => {
        const rail = railFromEvents([
            makeEvent({ event: "TICKET_CREATED", ts: 0n }),
            makeEvent({ event: "ACK_A", ts: 100n }),
        ]);
        expect(rail?.current).toBe("NEW");
        expect(rail?.steps[0]?.status).toBe("current");
    });

    it("flips to ACK on the second acknowledgement", () => {
        const rail = railFromEvents([
            makeEvent({ event: "TICKET_CREATED", ts: 0n }),
            makeEvent({ event: "ACK_A", ts: 100n }),
            makeEvent({ event: "ACK_B", ts: 200n }),
        ]);
        expect(rail?.current).toBe("ACK");
        expect(rail?.steps[1]?.status).toBe("current");
        expect(rail?.steps[0]?.status).toBe("done");
        expect(rail?.steps[2]?.status).toBe("ahead");
    });

    it("opens the amber PAYING exposure phase on race start", () => {
        const rail = railFromEvents(setupEvents());
        expect(rail?.current).toBe("PAYING");
        expect(rail?.steps[2]?.status).toBe("current");
        expect(rail?.steps[2]?.tone).toBe("amber");
        expect(rail?.steps[3]?.label).toBe("TERMINAL");
        expect(rail?.steps[3]?.status).toBe("ahead");
        expect(rail?.terminal).toBeNull();
    });

    it("reads each terminal event kind onto the terminal station", () => {
        const settled = railFromEvents([
            ...setupEvents(),
            makeEvent({ event: "LEG2_RELEASED", ts: 4000n }),
        ]);
        expect(settled?.current).toBe("SETTLED");
        expect(settled?.steps[3]?.tone).toBe("teal");

        const defaulted = railFromEvents([
            ...setupEvents(),
            makeEvent({ event: "DEFAULT_DECLARED", ts: 8000n }),
        ]);
        expect(defaulted?.current).toBe("DEFAULTED");
        expect(defaulted?.steps[3]?.tone).toBe("clay");

        const failed = railFromEvents([
            ...setupEvents(),
            makeEvent({ event: "FAILED_MARKED", ts: 8000n }),
        ]);
        expect(failed?.current).toBe("FAILED");
        expect(failed?.steps[3]?.tone).toBe("clay");
    });

    it("reads ATOMIC_REVERTED onto FAILED for the atomic lane", () => {
        // tradeops section 2.1: PAYING plus ATOMIC_REVERTED is FAILED,
        // even when the engine's follow-up FAILED_MARKED never arrives.
        const rail = railFromEvents([
            ...setupEvents(),
            makeEvent({ event: "ATOMIC_REVERTED", ts: 5000n, lane: "ATOMIC" }),
        ]);
        expect(rail?.atomicState).toBe("FAILED");
        expect(rail?.sequentialState).toBe("PAYING");
        expect(rail?.current).toBe("PAYING");
    });

    it("keeps a status_snapshot authoritative over the record's own transition", () => {
        const rail = railFromEvents([
            ...setupEvents(),
            makeEvent({
                event: "ATOMIC_REVERTED",
                ts: 5000n,
                lane: "ATOMIC",
                status_snapshot: { sequential: "PAYING", atomic: "PAYING" },
            }),
        ]);
        expect(rail?.atomicState).toBe("PAYING");
    });

    it("maps a run without events to the empty state", () => {
        expect(railFromEvents([])).toBeNull();
    });
});

describe("rate formatting", () => {
    it("formats the ticket scale as six decimal places", () => {
        expect(formatRateScaled("1350000")).toBe("1.350000");
        expect(formatRateScaled("1000000")).toBe("1.000000");
        expect(formatRateScaled("12")).toBe("0.000012");
        expect(formatRateScaled("0")).toBe("0.000000");
    });

    it("formats a caller supplied integer scale", () => {
        expect(formatRateScaled("135", 100)).toBe("1.35");
    });

    it("rejects anything that is not an integer string", () => {
        expect(() => formatRateScaled("1.5")).toThrow();
        expect(() => formatRateScaled("1e6")).toThrow();
        expect(() => formatRateScaled("-1350000")).toThrow();
        expect(() => formatRateScaled("")).toThrow();
    });

    it("rejects a non positive scale", () => {
        expect(() => formatRateScaled("1350000", 0)).toThrow();
    });
});

describe("display helpers", () => {
    it("shortens a 64 hex hash with a visible ellipsis marker", () => {
        const hash = "a".repeat(64);
        const short = shortHash(hash);
        expect(short).toContain("...");
        expect(short.length).toBeLessThan(hash.length);
        expect(shortHash("abc")).toBe("abc");
    });

    it("truncates a base58 wallet the same way", () => {
        const wallet = PARTY_A_WALLET;
        const short = truncateWallet(wallet);
        expect(short).toContain("...");
        expect(short.length).toBeLessThan(wallet.length);
        expect(truncateWallet("short")).toBe("short");
    });
});

describe("schema reference data", () => {
    it("covers every key of a built ticket", () => {
        const ticket = buildRunTicket(
            getScenario("honest"),
            PARTY_A_WALLET,
            PARTY_B_WALLET,
        );
        for (const key of Object.keys(ticket)) {
            const covered = TICKET_FIELD_DOCS.some(
                (doc) => doc.field === key || doc.field.startsWith(`${key}.`),
            );
            expect(covered, `field ${key} missing from the reference`).toBe(
                true,
            );
        }
    });

    it("lists every row of the tradeops field table", () => {
        expect(TICKET_FIELD_DOCS).toHaveLength(22);
        const names = TICKET_FIELD_DOCS.map((doc) => doc.field);
        expect(names).toContain("party_a.wallet");
        expect(names).toContain("ticket_hash");
        expect(names).toContain("rate_scale");
    });
});
