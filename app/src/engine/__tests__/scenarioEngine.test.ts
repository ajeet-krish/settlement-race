import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import {
    ATOMIC_SCENARIO_ID,
    RACE_ID,
    SEQUENTIAL_SCENARIO_ID,
    ScenarioEngine,
    T_LEG1,
    T_START,
    gapExpiryFor,
    type EngineOptions,
    type RaceEvent,
} from "../scenarioEngine";
import { getScenario } from "../scenarios";
import type { AnchorWallet } from "../../lib/anchorClient";
import { MockProgramClient, type MockVaultBalances } from "../../lib/mockClient";
import { scenarioPda } from "../../lib/pda";
import { verifyRecords } from "../../lib/provenance";
import type { ScenarioAccount } from "../../lib/programClient";
import type { ScenarioKind } from "../../lib/ticket";

// Shared identities: two runs hash the same ticket, so determinism can be
// asserted down to the provenance hashes.
const DRIVER_KP = Keypair.generate();
const PARTY_A_KP = Keypair.generate();
const PARTY_B_KP = Keypair.generate();

/** The four scripted kinds the settlement dispatch drives besides honest. */
const DISPATCH_KINDS = [
    "default_after_leg1",
    "late_payment",
    "atomic_revert",
    "partial_payment",
] as const;
type DispatchKind = (typeof DISPATCH_KINDS)[number];

/** The shared 14 event setup every scenario kind replays. */
const SETUP_SHAPE: readonly string[] = [
    "SEQUENTIAL:TICKET_CREATED",
    "ATOMIC:TICKET_CREATED",
    "SEQUENTIAL:ACK_A",
    "ATOMIC:ACK_A",
    "SEQUENTIAL:ACK_B",
    "ATOMIC:ACK_B",
    "SEQUENTIAL:LEG_FUNDED",
    "ATOMIC:LEG_FUNDED",
    "SEQUENTIAL:LEG_FUNDED",
    "ATOMIC:LEG_FUNDED",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "ATOMIC:CLOCK_ADVANCED",
    "SEQUENTIAL:RACE_STARTED",
    "ATOMIC:RACE_STARTED",
];

/** default_after_leg1: atomic contrast first, then the default. */
const DEFAULT_TAIL: readonly string[] = [
    "ATOMIC:ATOMIC_SETTLED",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "SEQUENTIAL:LEG1_RELEASED",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "SEQUENTIAL:DEFAULT_DECLARED",
];

/** late_payment: atomic contrast first, then the late full payment. */
const LATE_TAIL: readonly string[] = [
    "ATOMIC:ATOMIC_SETTLED",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "SEQUENTIAL:LEG1_RELEASED",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "SEQUENTIAL:LEG2_RELEASED",
];

/** atomic_revert and partial_payment: revert, failed mark, then default. */
const REVERT_TAIL: readonly string[] = [
    "ATOMIC:ATOMIC_REVERTED",
    "ATOMIC:FAILED_MARKED",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "SEQUENTIAL:LEG1_RELEASED",
    "SEQUENTIAL:LEG2_PARTIAL",
    "SEQUENTIAL:CLOCK_ADVANCED",
    "SEQUENTIAL:DEFAULT_DECLARED",
];

interface Harness {
    engine: ScenarioEngine;
    client: MockProgramClient;
    sequentialScenario: PublicKey;
    atomicScenario: PublicKey;
}

interface HarnessOptions {
    anchor_head?: boolean;
    scenario_id_base?: bigint;
    client?: MockProgramClient;
    onEvent?: (e: RaceEvent) => void;
}

function makeHarness(options: HarnessOptions = {}): Harness {
    const client = options.client ?? new MockProgramClient();
    const wallet: AnchorWallet = {
        publicKey: PARTY_A_KP.publicKey,
        signTransaction: async (tx) => tx,
        signAllTransactions: async (txs) => txs,
    };
    const base = options.scenario_id_base ?? SEQUENTIAL_SCENARIO_ID;
    const opts: EngineOptions = {
        client,
        driver: DRIVER_KP,
        partyA: PARTY_A_KP.publicKey,
        partyB: PARTY_B_KP.publicKey,
        wallet,
        anchor_head: options.anchor_head,
        scenario_id_base: options.scenario_id_base,
        onEvent: options.onEvent,
    };
    return {
        engine: new ScenarioEngine(opts),
        client,
        sequentialScenario: scenarioPda(DRIVER_KP.publicKey, base)[0],
        atomicScenario: scenarioPda(DRIVER_KP.publicKey, base + 1n)[0],
    };
}

async function collect(
    events: AsyncGenerator<RaceEvent>,
): Promise<RaceEvent[]> {
    const out: RaceEvent[] = [];
    for await (const event of events) {
        out.push(event);
    }
    return out;
}

/** lane:event shape of a run, the compact sequence fingerprint. */
function shape(events: RaceEvent[]): string[] {
    return events.map((event) => `${event.lane}:${event.event}`);
}

/** lane:event:virtual time:seq tuples, the deeper run fingerprint. */
function tuples(
    events: RaceEvent[],
): Array<[string, string, string, number]> {
    return events.map((e) => [
        e.lane,
        e.event,
        e.virtual_ts_ms.toString(),
        e.seq,
    ]);
}

/** Account plus vault balances of one lane, for money assertions. */
interface LaneView {
    account: ScenarioAccount;
    vault: MockVaultBalances;
}

async function laneView(
    h: Harness,
    lane: "sequential" | "atomic",
): Promise<LaneView> {
    const scenario =
        lane === "sequential" ? h.sequentialScenario : h.atomicScenario;
    const account = await h.client.fetchScenario(scenario);
    if (!account.ok) {
        throw new Error(`${lane} scenario fetch failed: ${account.error}`);
    }
    const vault = h.client.getVaultBalances(scenario);
    if (vault === null) {
        throw new Error(`${lane} vault fetch failed`);
    }
    return { account: account.value, vault };
}

/** Integer floor of leg 2 times fund_bps over 10000, the funded amount. */
function fundedCadFloor(kind: ScenarioKind): bigint {
    const spec = getScenario(kind);
    return (spec.leg2_cad_cents * BigInt(spec.fund_bps)) / 10_000n;
}

describe("ScenarioEngine: honest run", () => {
    it("settles both lanes and reports the final statuses", async () => {
        const h = makeHarness();
        const events = await collect(h.engine.run(getScenario("honest")));

        expect(h.client.laneCount).toBe(2);
        expect(shape(events)).toEqual([
            "SEQUENTIAL:TICKET_CREATED",
            "ATOMIC:TICKET_CREATED",
            "SEQUENTIAL:ACK_A",
            "ATOMIC:ACK_A",
            "SEQUENTIAL:ACK_B",
            "ATOMIC:ACK_B",
            "SEQUENTIAL:LEG_FUNDED",
            "ATOMIC:LEG_FUNDED",
            "SEQUENTIAL:LEG_FUNDED",
            "ATOMIC:LEG_FUNDED",
            "SEQUENTIAL:CLOCK_ADVANCED",
            "ATOMIC:CLOCK_ADVANCED",
            "SEQUENTIAL:RACE_STARTED",
            "ATOMIC:RACE_STARTED",
            "ATOMIC:ATOMIC_SETTLED",
            "SEQUENTIAL:CLOCK_ADVANCED",
            "SEQUENTIAL:LEG1_RELEASED",
            "SEQUENTIAL:CLOCK_ADVANCED",
            "SEQUENTIAL:LEG2_RELEASED",
        ]);

        // Same ticket hash recorded on both lanes.
        expect(events[0]!.event).toBe("TICKET_CREATED");
        expect(events[1]!.event).toBe("TICKET_CREATED");
        expect(events[0]!.provenance.data.ticket_hash).toBe(
            events[1]!.provenance.data.ticket_hash,
        );

        // Milestone virtual times from the documented schedule.
        const tsOf = (lane: string, event: string): bigint => {
            const found = events.find(
                (e) => e.lane === lane && e.event === event,
            );
            expect(found, `${lane}:${event}`).toBeDefined();
            return found!.virtual_ts_ms;
        };
        expect(tsOf("SEQUENTIAL", "RACE_STARTED")).toBe(T_START);
        expect(tsOf("ATOMIC", "ATOMIC_SETTLED")).toBe(T_START);
        expect(tsOf("SEQUENTIAL", "LEG1_RELEASED")).toBe(T_LEG1);
        expect(tsOf("SEQUENTIAL", "LEG2_RELEASED")).toBe(
            gapExpiryFor(getScenario("honest")),
        );

        // Honest party B funds the full CAD leg in both lanes (integer cents).
        const cadFunds = events.filter(
            (e) =>
                e.event === "LEG_FUNDED" &&
                e.provenance.data.leg === "LEG2_CAD",
        );
        expect(cadFunds).toHaveLength(2);
        for (const event of cadFunds) {
            expect(event.provenance.data.amount_cents).toBe("1350000");
        }

        // The last event without anchoring is the sequential settlement,
        // and it carries both terminal statuses.
        const final = events[events.length - 1]!;
        expect(final.event).toBe("LEG2_RELEASED");
        expect(final.status_snapshot).toEqual({
            sequential: "SETTLED",
            atomic: "SETTLED",
        });
        expect(events.some((e) => e.event === "CHAIN_ANCHORED")).toBe(false);

        const sequential = await h.client.fetchScenario(h.sequentialScenario);
        const atomic = await h.client.fetchScenario(h.atomicScenario);
        if (!sequential.ok || !atomic.ok) {
            throw new Error("scenario fetch failed after the run");
        }
        expect(sequential.value.status).toBe("SETTLED");
        expect(atomic.value.status).toBe("SETTLED");
    });

    it("two runs yield identical event sequences", async () => {
        const first = makeHarness();
        const second = makeHarness();
        const runA = await collect(first.engine.run(getScenario("honest")));
        const runB = await collect(second.engine.run(getScenario("honest")));

        expect(tuples(runA)).toEqual(tuples(runB));
        // Shared identities plus a fresh mock per run: the full hash chains
        // are byte identical too.
        expect(runA.map((e) => e.provenance.hash)).toEqual(
            runB.map((e) => e.provenance.hash),
        );
    });

    it("lanes start with equal balances at the first event", async () => {
        const h = makeHarness();
        const seen: RaceEvent[] = [];
        for await (const event of h.engine.run(getScenario("honest"))) {
            seen.push(event);
            break;
        }
        expect(seen[0]!.event).toBe("TICKET_CREATED");

        const sequential = await h.client.fetchScenario(h.sequentialScenario);
        const atomic = await h.client.fetchScenario(h.atomicScenario);
        if (!sequential.ok || !atomic.ok) {
            throw new Error("scenario fetch failed at the first event");
        }
        // Fresh escrow counters, identically zero in both lanes.
        expect(sequential.value.funded_usd_cents).toBe(
            atomic.value.funded_usd_cents,
        );
        expect(sequential.value.funded_cad_cents).toBe(
            atomic.value.funded_cad_cents,
        );
        expect(sequential.value.funded_usd_cents).toBe(0n);
        expect(sequential.value.funded_cad_cents).toBe(0n);
        // Same ticket, notionals, and gap: the fairness contract.
        expect(Array.from(sequential.value.ticket_hash)).toEqual(
            Array.from(atomic.value.ticket_hash),
        );
        expect(sequential.value.leg1_usd_cents).toBe(
            atomic.value.leg1_usd_cents,
        );
        expect(sequential.value.leg2_cad_cents).toBe(
            atomic.value.leg2_cad_cents,
        );
        expect(sequential.value.gap_ms).toBe(atomic.value.gap_ms);
    });

    it("provenance chain verifies and matches the engine chain head", async () => {
        const h = makeHarness();
        const events = await collect(h.engine.run(getScenario("honest")));
        const records = events.map((e) => e.provenance);

        expect(verifyRecords(records).valid).toBe(true);
        expect(records.every((r) => r.scenario_id === RACE_ID)).toBe(true);
        expect(records.every((r) => r.real_ts_iso === null)).toBe(true);
        expect(events.map((e) => e.seq)).toEqual(records.map((_, i) => i));
        expect(h.engine.chain.length).toBe(events.length);
        expect(h.engine.chain.verify()).toBe(true);
        expect(h.engine.chain.head).toBe(records[records.length - 1]!.hash);
    });

    it("carries a transaction signature on every on-chain event", async () => {
        const h = makeHarness();
        const events = await collect(h.engine.run(getScenario("honest")));

        for (const event of events) {
            // TICKET_CREATED is the off-chain step of the spec and may lack
            // a signature; every other event is a client transaction.
            if (event.event === "TICKET_CREATED") {
                continue;
            }
            expect(
                event.tx_sig,
                `${event.lane}:${event.event} seq ${event.seq}`,
            ).toBeTruthy();
            expect(event.provenance.tx_sig).toBe(event.tx_sig ?? null);
        }
    });
});

describe("ScenarioEngine: settlement dispatch", () => {
    const DISPATCH_SHAPE: Record<DispatchKind, string[]> = {
        default_after_leg1: [...SETUP_SHAPE, ...DEFAULT_TAIL],
        late_payment: [...SETUP_SHAPE, ...LATE_TAIL],
        atomic_revert: [...SETUP_SHAPE, ...REVERT_TAIL],
        partial_payment: [...SETUP_SHAPE, ...REVERT_TAIL],
    };

    it.each(DISPATCH_KINDS)("%s runs to its spec terminals", async (kind) => {
        const h = makeHarness();
        const spec = getScenario(kind);
        const events = await collect(h.engine.run(spec));

        expect(shape(events)).toEqual(DISPATCH_SHAPE[kind]);

        // Terminal statuses match the spec contract for both lanes.
        const seq = await laneView(h, "sequential");
        const atom = await laneView(h, "atomic");
        expect(seq.account.status).toBe(spec.expected_sequential_terminal);
        expect(atom.account.status).toBe(spec.expected_atomic_terminal);

        // The final record carries both terminal statuses, like honest.
        const final = events[events.length - 1]!;
        expect(final.status_snapshot).toEqual({
            sequential: spec.expected_sequential_terminal,
            atomic: spec.expected_atomic_terminal,
        });

        // Every event except the off-chain ticket and the reverted attempt
        // carries a transaction signature, and the chain verifies.
        for (const event of events) {
            if (
                event.event === "TICKET_CREATED" ||
                event.event === "ATOMIC_REVERTED"
            ) {
                continue;
            }
            expect(
                event.tx_sig,
                `${event.lane}:${event.event} seq ${event.seq}`,
            ).toBeTruthy();
        }
        expect(verifyRecords(events.map((e) => e.provenance)).valid).toBe(
            true,
        );
        expect(h.engine.chain.verify()).toBe(true);
    });
});

describe("ScenarioEngine: default_after_leg1", () => {
    it("locks in party A's USD loss with no CAD recovery", async () => {
        const h = makeHarness();
        const spec = getScenario("default_after_leg1");
        await collect(h.engine.run(spec));

        const seq = await laneView(h, "sequential");
        expect(seq.account.status).toBe(spec.expected_sequential_terminal);
        // A funded the full USD leg, leg 1 released all of it to B, and the
        // default never sends it back: exactly leg1 left A's escrow.
        expect(seq.account.funded_usd_cents).toBe(spec.leg1_usd_cents);
        expect(seq.account.funded_usd_cents - seq.vault.usd_cents).toBe(
            spec.leg1_usd_cents,
        );
        expect(seq.vault.usd_cents).toBe(0n);
        // B reclaimed the whole CAD escrow: nothing paid, vault emptied.
        expect(seq.account.paid_cad_cents).toBe(0n);
        expect(seq.account.funded_cad_cents).toBe(spec.leg2_cad_cents);
        expect(seq.vault.cad_cents).toBe(0n);

        // Atomic contrast: one clean transaction emptied both vaults, and
        // the atomic path never touches sequential paid progress.
        const atom = await laneView(h, "atomic");
        expect(atom.account.status).toBe(spec.expected_atomic_terminal);
        expect(atom.account.paid_cad_cents).toBe(0n);
        expect(atom.vault.usd_cents).toBe(0n);
        expect(atom.vault.cad_cents).toBe(0n);
    });

    it("declares the default strictly past the gap deadline", async () => {
        const h = makeHarness();
        const spec = getScenario("default_after_leg1");
        const events = await collect(h.engine.run(spec));

        const released = events.find((e) => e.event === "LEG1_RELEASED")!;
        const declared = events.find((e) => e.event === "DEFAULT_DECLARED")!;
        expect(declared.virtual_ts_ms).toBe(gapExpiryFor(spec));
        expect(declared.virtual_ts_ms).toBeGreaterThan(
            released.virtual_ts_ms + BigInt(spec.gap_ms),
        );
        expect(declared.provenance.actor).toBe("DRIVER");
        expect(declared.provenance.data.paid_cad_cents).toBe("0");
        // The bot refused per leg2Action: no payment of any kind.
        expect(
            events.some(
                (e) => e.event === "LEG2_RELEASED" || e.event === "LEG2_PARTIAL",
            ),
        ).toBe(false);
    });
});

describe("ScenarioEngine: late_payment", () => {
    it("settles after passing the gap with no default declared", async () => {
        const h = makeHarness();
        const spec = getScenario("late_payment");
        const events = await collect(h.engine.run(spec));

        // The engine never races a declare_default against the late pay.
        expect(events.some((e) => e.event === "DEFAULT_DECLARED")).toBe(false);

        const released = events.find((e) => e.event === "LEG1_RELEASED")!;
        const paid = events.find((e) => e.event === "LEG2_RELEASED")!;
        // Payment lands strictly past the deadline the default would check.
        expect(paid.virtual_ts_ms).toBe(gapExpiryFor(spec));
        expect(paid.virtual_ts_ms).toBeGreaterThan(
            released.virtual_ts_ms + BigInt(spec.gap_ms),
        );
        // Stamped late in the record, settled in full.
        expect(paid.provenance.data.late).toBe(true);
        expect(paid.provenance.data.paid_cad_cents).toBe(
            spec.leg2_cad_cents.toString(),
        );

        const seq = await laneView(h, "sequential");
        expect(seq.account.status).toBe(spec.expected_sequential_terminal);
        expect(seq.account.paid_cad_cents).toBe(spec.leg2_cad_cents);
        expect(seq.vault.usd_cents).toBe(0n);
        expect(seq.vault.cad_cents).toBe(0n);
    });

    it("settles the atomic lane at race start before the late payment", async () => {
        const h = makeHarness();
        const events = await collect(h.engine.run(getScenario("late_payment")));

        const atomic = events.find((e) => e.event === "ATOMIC_SETTLED")!;
        const paid = events.find((e) => e.event === "LEG2_RELEASED")!;
        expect(atomic.virtual_ts_ms).toBe(T_START);
        expect(paid.virtual_ts_ms).toBeGreaterThan(atomic.virtual_ts_ms);
        expect(shape(events)).toEqual([...SETUP_SHAPE, ...LATE_TAIL]);
    });
});

describe("ScenarioEngine: atomic_revert", () => {
    it("reverts the atomic attempt whole and marks the lane failed", async () => {
        const h = makeHarness();
        const spec = getScenario("atomic_revert");
        const events = await collect(h.engine.run(spec));

        const reverted = events.find((e) => e.event === "ATOMIC_REVERTED")!;
        expect(reverted.lane).toBe("ATOMIC");
        // The instruction never landed, so no transaction signed the record.
        expect(reverted.provenance.tx_sig).toBeNull();
        expect(reverted.tx_sig).toBeUndefined();
        expect(String(reverted.provenance.data.error)).toContain(
            "InsufficientEscrow",
        );
        expect(reverted.note).toContain("no funds moved");

        const failed = events.find((e) => e.event === "FAILED_MARKED")!;
        expect(failed.lane).toBe("ATOMIC");
        expect(failed.tx_sig).toBeTruthy();

        const final = events[events.length - 1]!;
        expect(final.event).toBe("DEFAULT_DECLARED");
        expect(final.status_snapshot).toEqual({
            sequential: spec.expected_sequential_terminal,
            atomic: spec.expected_atomic_terminal,
        });
    });

    it("moves nothing on the atomic lane when the attempt reverts", async () => {
        const spec = getScenario("atomic_revert");
        const h = makeHarness();
        let pre: LaneView | null = null;
        const events: RaceEvent[] = [];
        for await (const event of h.engine.run(spec)) {
            // The generator is suspended at each yield, so this reading lands
            // after setup and before the engine attempts settle_atomic.
            if (
                pre === null &&
                event.lane === "ATOMIC" &&
                event.event === "RACE_STARTED"
            ) {
                pre = await laneView(h, "atomic");
            }
            events.push(event);
        }
        if (pre === null) {
            throw new Error("pre attempt snapshot was never taken");
        }
        expect(events.some((e) => e.event === "ATOMIC_REVERTED")).toBe(true);

        // Zero movement: balances are bit identical to the pre attempt state.
        const post = await laneView(h, "atomic");
        expect(post.vault).toEqual(pre.vault);
        expect(post.account.funded_usd_cents).toBe(
            pre.account.funded_usd_cents,
        );
        expect(post.account.funded_cad_cents).toBe(
            pre.account.funded_cad_cents,
        );
        expect(post.account.paid_cad_cents).toBe(0n);
        expect(post.account.status).toBe("FAILED");

        // The pre attempt state is exactly the spec funding: full USD and
        // the 90 percent CAD floor.
        expect(pre.vault.usd_cents).toBe(spec.leg1_usd_cents);
        expect(pre.vault.cad_cents).toBe(fundedCadFloor("atomic_revert"));
        expect(pre.vault.cad_cents).toBe(1_215_000n);
    });

    it("pays the funded 90 percent then defaults with party A short", async () => {
        const h = makeHarness();
        const spec = getScenario("atomic_revert");
        const events = await collect(h.engine.run(spec));

        const floorPaid = fundedCadFloor("atomic_revert");
        expect(floorPaid).toBe(
            (spec.leg2_cad_cents * BigInt(spec.fund_bps)) / 10_000n,
        );

        const partial = events.find((e) => e.event === "LEG2_PARTIAL")!;
        expect(partial.provenance.data.amount_cents).toBe(floorPaid.toString());
        expect(partial.provenance.data.paid_cad_cents).toBe(
            floorPaid.toString(),
        );
        // Paid inside the gap window, before the default.
        expect(partial.virtual_ts_ms).toBe(T_LEG1);

        const declared = events.find((e) => e.event === "DEFAULT_DECLARED")!;
        expect(declared.provenance.data.paid_cad_cents).toBe(
            floorPaid.toString(),
        );

        const seq = await laneView(h, "sequential");
        expect(seq.account.status).toBe(spec.expected_sequential_terminal);
        expect(seq.account.paid_cad_cents).toBe(floorPaid);
        // A's USD left escrow at leg 1 release and never came back: B keeps it.
        expect(seq.account.funded_usd_cents - seq.vault.usd_cents).toBe(
            spec.leg1_usd_cents,
        );
        expect(seq.vault.usd_cents).toBe(0n);
        // B's funded CAD went to A in full, so nothing remained to reclaim.
        expect(seq.vault.cad_cents).toBe(0n);
    });
});

describe("ScenarioEngine: partial_payment", () => {
    it("defaults the sequential lane with the floored 60 percent recovery", async () => {
        const h = makeHarness();
        const spec = getScenario("partial_payment");
        const events = await collect(h.engine.run(spec));

        const floorPaid = fundedCadFloor("partial_payment");
        expect(floorPaid).toBe(
            (spec.leg2_cad_cents * BigInt(spec.fund_bps)) / 10_000n,
        );
        expect(floorPaid).toBe(810_000n);

        const partial = events.find((e) => e.event === "LEG2_PARTIAL")!;
        expect(partial.provenance.data.amount_cents).toBe(floorPaid.toString());
        const declared = events.find((e) => e.event === "DEFAULT_DECLARED")!;
        expect(declared.provenance.data.paid_cad_cents).toBe(
            floorPaid.toString(),
        );

        const seq = await laneView(h, "sequential");
        expect(seq.account.status).toBe(spec.expected_sequential_terminal);
        expect(seq.account.paid_cad_cents).toBe(floorPaid);
        // A's USD loss: leg 1 left A's escrow and stayed with B.
        expect(seq.account.funded_usd_cents - seq.vault.usd_cents).toBe(
            spec.leg1_usd_cents,
        );
        expect(seq.vault.usd_cents).toBe(0n);
    });

    it("fails the underfunded atomic lane without moving a cent", async () => {
        const h = makeHarness();
        const spec = getScenario("partial_payment");
        const events = await collect(h.engine.run(spec));

        const reverted = events.find((e) => e.event === "ATOMIC_REVERTED")!;
        expect(String(reverted.provenance.data.error)).toContain(
            "InsufficientEscrow",
        );
        const failed = events.find((e) => e.event === "FAILED_MARKED")!;
        expect(failed.tx_sig).toBeTruthy();

        const atom = await laneView(h, "atomic");
        expect(atom.account.status).toBe(spec.expected_atomic_terminal);
        expect(atom.account.paid_cad_cents).toBe(0n);
        expect(atom.vault.usd_cents).toBe(spec.leg1_usd_cents);
        // CAD untouched at the 60 percent funding floor.
        expect(atom.vault.cad_cents).toBe(fundedCadFloor("partial_payment"));
        expect(atom.vault.cad_cents).toBe(810_000n);
    });
});

describe("ScenarioEngine: determinism", () => {
    it("two runs of atomic_revert yield identical sequences and hashes", async () => {
        const first = makeHarness();
        const second = makeHarness();
        const runA = await collect(
            first.engine.run(getScenario("atomic_revert")),
        );
        const runB = await collect(
            second.engine.run(getScenario("atomic_revert")),
        );

        expect(tuples(runA)).toEqual(tuples(runB));
        // Shared identities plus a fresh mock per run: byte identical chains.
        expect(runA.map((e) => e.provenance.hash)).toEqual(
            runB.map((e) => e.provenance.hash),
        );
    });
});

describe("ScenarioEngine: scenario ids", () => {
    it("derives lane PDAs at scenario_id_base and base + 1", async () => {
        const base = 10n;
        const h = makeHarness({ scenario_id_base: base });
        const events = await collect(h.engine.run(getScenario("honest")));
        expect(events).toHaveLength(19);
        expect(h.client.laneCount).toBe(2);

        const sequentialAtBase = scenarioPda(DRIVER_KP.publicKey, base)[0];
        const atomicAtBasePlusOne = scenarioPda(
            DRIVER_KP.publicKey,
            base + 1n,
        )[0];
        expect(h.sequentialScenario.equals(sequentialAtBase)).toBe(true);
        expect(h.atomicScenario.equals(atomicAtBasePlusOne)).toBe(true);
        expect((await h.client.fetchScenario(sequentialAtBase)).ok).toBe(true);
        expect((await h.client.fetchScenario(atomicAtBasePlusOne)).ok).toBe(
            true,
        );

        // The default ids 1 and 2 were never touched by this run.
        const defaultSequential = await h.client.fetchScenario(
            scenarioPda(DRIVER_KP.publicKey, SEQUENTIAL_SCENARIO_ID)[0],
        );
        expect(defaultSequential.ok).toBe(false);
        const defaultAtomic = await h.client.fetchScenario(
            scenarioPda(DRIVER_KP.publicKey, ATOMIC_SCENARIO_ID)[0],
        );
        expect(defaultAtomic.ok).toBe(false);
    });

    it("a custom base run never collides with a default run on one driver", async () => {
        const client = new MockProgramClient();
        const first = makeHarness({ client });
        await collect(first.engine.run(getScenario("honest")));

        // A second engine under the same driver replays another kind on
        // fresh ids: initScenario would fail with AccountAlreadyInUse if
        // the base did not shift the PDAs.
        const second = makeHarness({ client, scenario_id_base: 5n });
        await collect(second.engine.run(getScenario("default_after_leg1")));

        expect(client.laneCount).toBe(4);
        const seq = await laneView(second, "sequential");
        const atom = await laneView(second, "atomic");
        expect(seq.account.status).toBe("DEFAULTED");
        expect(atom.account.status).toBe("SETTLED");
    });
});

describe("ScenarioEngine: anchoring", () => {
    it("anchors the finished chain head when anchor_head is set", async () => {
        const h = makeHarness({ anchor_head: true });
        const events = await collect(h.engine.run(getScenario("honest")));

        const final = events[events.length - 1]!;
        expect(final.event).toBe("CHAIN_ANCHORED");
        expect(final.status_snapshot).toEqual({
            sequential: "SETTLED",
            atomic: "SETTLED",
        });
        expect(final.tx_sig).toBeTruthy();
        // The record is hashed before the anchor transaction, so its own
        // signature stays null while the event carries the signature.
        expect(final.provenance.tx_sig).toBeNull();

        const records = events.map((e) => e.provenance);
        expect(verifyRecords(records).valid).toBe(true);
        expect(h.engine.chain.verify()).toBe(true);

        // verifyAgainstChainHead-style check against the mock's anchor.
        const stored = await h.client.fetchChainHead(h.sequentialScenario);
        if (!stored.ok) {
            throw new Error(stored.error);
        }
        expect(Buffer.from(stored.value.final_hash).toString("hex")).toBe(
            h.engine.chain.head,
        );
        expect(stored.value.event_count).toBe(BigInt(events.length));
        expect(stored.value.anchored_virtual_ms).toBe(
            gapExpiryFor(getScenario("honest")),
        );

        // Only the sequential lane holds the ChainHead account.
        const other = await h.client.fetchChainHead(h.atomicScenario);
        expect(other.ok).toBe(false);
    });

    it("skips the anchor phase entirely when anchor_head is false", async () => {
        const h = makeHarness({ anchor_head: false });
        const anchorSpy = vi.spyOn(h.client, "anchorChainHead");

        const events = await collect(h.engine.run(getScenario("honest")));

        expect(events.some((e) => e.event === "CHAIN_ANCHORED")).toBe(false);
        expect(anchorSpy).not.toHaveBeenCalled();
        // The local chain is still complete and self verifying.
        expect(h.engine.chain.verify()).toBe(true);
        const stored = await h.client.fetchChainHead(h.sequentialScenario);
        expect(stored.ok).toBe(false);
    });
});

describe("ScenarioEngine: negative paths", () => {
    it("throws an unfair start error when the lane notionals diverge", async () => {
        const client = new MockProgramClient();
        const atomicPda = scenarioPda(
            DRIVER_KP.publicKey,
            SEQUENTIAL_SCENARIO_ID + 1n,
        )[0];
        // Every read of the atomic lane reports one extra cent of leg 2
        // notional, exactly the mismatch the fairness assert must catch.
        const realFetch = client.fetchScenario.bind(client);
        client.fetchScenario = async (address) => {
            const result = await realFetch(address);
            if (address.equals(atomicPda) && result.ok) {
                return {
                    ok: true,
                    value: {
                        ...result.value,
                        leg2_cad_cents: result.value.leg2_cad_cents + 1n,
                    },
                };
            }
            return result;
        };

        const h = makeHarness({ client });
        await expect(
            collect(h.engine.run(getScenario("honest"))),
        ).rejects.toThrow("ScenarioEngine: unfair start: leg2_cad_cents");
    });

    it("throws with the failing label when a client transaction fails", async () => {
        const client = new MockProgramClient();
        client.initScenario = async () => ({
            ok: false,
            error: "BadState: clock already advanced",
        });

        const h = makeHarness({ client });
        await expect(collect(h.engine.run(getScenario("honest")))).rejects.toThrow(
            "ScenarioEngine: initialize sequential lane failed: " +
                "BadState: clock already advanced",
        );
        // The run failed before any event was yielded.
        expect(h.client.laneCount).toBe(0);
    });
});
