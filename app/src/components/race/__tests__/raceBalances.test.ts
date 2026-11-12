import { describe, expect, it } from "vitest";
import { partyBalances } from "../raceBalances";
import { makeEvent } from "./eventFixtures";

/** Both funding records, sequential lane, scenario catalogue amounts. */
function fundedStream() {
    return [
        makeEvent({ event: "TICKET_CREATED", ts: 0n }),
        makeEvent({
            event: "LEG_FUNDED",
            ts: 700n,
            data: { leg: "LEG1_USD", amount_cents: "1000000" },
        }),
        makeEvent({
            event: "LEG_FUNDED",
            ts: 800n,
            data: { leg: "LEG2_CAD", amount_cents: "1350000" },
        }),
    ];
}

describe("partyBalances", () => {
    it("reports awaiting event for every field on an empty stream", () => {
        const balances = partyBalances([]);
        expect(balances.party_a).toEqual({ t_usd: null, t_cad: null });
        expect(balances.party_b).toEqual({ t_usd: null, t_cad: null });
        expect(balances.defaulted).toBe(false);
        expect(balances.loss_usd).toBeNull();
    });

    it("derives funding deltas once both legs are funded", () => {
        const balances = partyBalances(fundedStream());
        expect(balances.party_a.t_usd).toBe(-1_000_000n);
        expect(balances.party_a.t_cad).toBe(0n);
        expect(balances.party_b.t_usd).toBe(0n);
        expect(balances.party_b.t_cad).toBe(-1_350_000n);
        expect(balances.defaulted).toBe(false);
        expect(balances.loss_usd).toBeNull();
    });

    it("credits the full leg 2 payment to A on settlement", () => {
        const balances = partyBalances([
            ...fundedStream(),
            makeEvent({ event: "LEG1_RELEASED", ts: 2_000n }),
            makeEvent({
                event: "LEG2_RELEASED",
                ts: 7_000n,
                data: { paid_cad_cents: "1350000" },
            }),
        ]);
        expect(balances.party_a.t_usd).toBe(-1_000_000n);
        expect(balances.party_a.t_cad).toBe(1_350_000n);
        expect(balances.party_b.t_usd).toBe(1_000_000n);
        expect(balances.party_b.t_cad).toBe(-1_350_000n);
        expect(balances.defaulted).toBe(false);
    });

    it("quantifies the loss and partial refund on a default", () => {
        const balances = partyBalances([
            ...fundedStream(),
            makeEvent({ event: "LEG1_RELEASED", ts: 2_000n }),
            makeEvent({
                event: "LEG2_PARTIAL",
                ts: 4_000n,
                data: { amount_cents: "810000", paid_cad_cents: "810000" },
            }),
            makeEvent({
                event: "DEFAULT_DECLARED",
                ts: 8_000n,
                data: { paid_cad_cents: "810000" },
                status_snapshot: { sequential: "DEFAULTED", atomic: "SETTLED" },
            }),
        ]);
        expect(balances.defaulted).toBe(true);
        expect(balances.loss_usd).toBe(1_000_000n);
        expect(balances.party_a.t_usd).toBe(-1_000_000n);
        expect(balances.party_a.t_cad).toBe(810_000n);
        expect(balances.party_b.t_usd).toBe(1_000_000n);
        expect(balances.party_b.t_cad).toBe(-810_000n);
    });

    it("leaves the amount null when a funding record is unparsable", () => {
        const balances = partyBalances([
            makeEvent({
                event: "LEG_FUNDED",
                ts: 100n,
                data: { leg: "LEG1_USD", amount_cents: "not-a-cent" },
            }),
        ]);
        expect(balances.party_a.t_usd).toBeNull();
        expect(balances.party_a.t_cad).toBe(0n);
    });
});
