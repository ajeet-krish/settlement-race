/**
 * Scenario engine core: drives both settlement lanes of one race scenario
 * from a single trade ticket and records every step in one shared
 * provenance chain.
 *
 * Every scenario kind shares the same SETUP phase: build the ticket, init
 * both lanes with the identical ticket hash, assert the lanes start fair,
 * acknowledge, fund, move the virtual clock to T_START (the program rejects
 * start_race at virtual time zero), and start both races. Settlement then
 * dispatches through settleByKind by scenario kind. The atomic lane always
 * plays first, at race start: one transaction before the sequential lane
 * spends the gap window keeps the stream's virtual time monotonic, keeps the
 * atomic path's "no window" reading honest, and leaves the sequential lane's
 * final record to carry both terminal statuses. Every finished run is pinned
 * to the spec's expected_sequential_terminal and expected_atomic_terminal.
 *
 * Chain choice: one ProvenanceChain spans both lanes, and every record
 * carries its lane in data.lane. The record's scenario_id stays the shared
 * race identifier (RACE_ID) so consumers read one history per race while
 * data.lane names the account each step touched. One chain also means one
 * chain head to anchor.
 *
 * Anchoring: the CHAIN_ANCHORED record is appended before the anchor
 * transaction, so the anchored head covers the whole chain including its
 * own announcement. The record's tx_sig stays null because it is hashed
 * before the transaction exists, while the yielded RaceEvent carries the
 * anchor signature. The ChainHead account lives on the sequential lane PDA,
 * the canonical holder of the shared chain.
 *
 * Lane addresses derive with the default program id from pda.ts; clients
 * configured with a custom program id are out of scope for this chunk.
 *
 * Money is integer cents (bigint) everywhere: fund_bps converts through
 * bigint basis points, never floats. Events are simulated, so records use
 * null real_ts_iso and two runs of the same spec yield identical chains.
 */

import type { PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "../lib/anchorClient";
import { scenarioPda } from "../lib/pda";
import type {
    LegName,
    ProgramClient,
    ScenarioAccount,
    TxResult,
} from "../lib/programClient";
import {
    ProvenanceChain,
    type EventType,
    type ProvenanceActor,
    type ProvenanceRecord,
} from "../lib/provenance";
import {
    buildTicket,
    type SettlementPathName,
    type TradeTicket,
} from "../lib/ticket";
import { headToBytes } from "./anchorFlow";
import { botDecision } from "./bot";
import { VirtualClock } from "./clock";
import type { ScenarioSpec } from "./scenarios";

/**
 * Minimal signer shape. The frozen ProgramClient interface takes PublicKeys
 * only (the on-chain program proves signatures), so the engine needs just
 * the public key. A web3.js Keypair satisfies this structurally and can be
 * passed directly.
 */
export interface SignerLike {
    readonly publicKey: PublicKey;
}

/** One yielded step of a race run: the provenance record plus lane view. */
export interface RaceEvent {
    /** Lane this step touched. */
    lane: SettlementPathName;
    /** Provenance event kind. */
    event: EventType;
    /** Virtual clock time of the step in milliseconds. */
    virtual_ts_ms: bigint;
    /** Position in the shared provenance chain (zero based). */
    seq: number;
    /** The appended provenance record, hashes already derived. */
    provenance: ProvenanceRecord;
    /** Transaction signature of the step, when a transaction caused it. */
    tx_sig?: string;
    /** Optional human readable detail for the race UI. */
    note?: string;
    /** Lifecycle of both lanes as of this event, when it is attached. */
    status_snapshot?: { sequential: string; atomic: string };
}

/** Construction inputs for one engine instance. */
export interface EngineOptions {
    /** Client the engine submits every instruction through. */
    client: ProgramClient;
    /** Driver signer: engine only instructions sign as this key. */
    driver: SignerLike;
    /** Party A public key: acknowledges and funds the USD leg. */
    partyA: PublicKey;
    /** Party B public key: the scripted counterparty. */
    partyB: PublicKey;
    /** Party A wallet, recorded as the party A reference on the ticket. */
    wallet: AnchorWallet;
    /** Anchor the finished chain head on chain after a terminal run. */
    anchor_head?: boolean;
    /**
     * Scenario account id of the sequential lane; the atomic lane derives
     * base + 1. Defaults to SEQUENTIAL_SCENARIO_ID (1), so a plain run
     * lands on ids 1 and 2. A session that replays several races under one
     * driver passes a fresh base per replay so the PDAs never collide.
     */
    scenario_id_base?: bigint;
    /** Called with each event as it is yielded, in stream order. */
    onEvent?: (e: RaceEvent) => void;
}

/**
 * Virtual schedule (all bigint milliseconds, deterministic per spec):
 * T_START is when both races start, T_LEG1 is when the sequential lane
 * releases leg 1, and gap expiry for a spec is T_LEG1 + gap_ms + the pad
 * below, so the clock lands strictly beyond the deadline the program's
 * declare_default rule checks (virtual_now > released + gap). The honest
 * sequential path pays leg 2 at that expiry instant.
 */
export const T_START = 1000n;
export const T_LEG1 = 2000n;
/** Padding past leg 1 + gap so a clock sits strictly beyond the deadline. */
const T_GAP_PAD = 1000n;

/**
 * Default scenario account ids: one PDA per lane under the same driver, so
 * both lanes of one race are deterministic addresses. EngineOptions
 * scenario_id_base shifts the pair (sequential = base, atomic = base + 1)
 * when one session replays several races under one driver; the defaults
 * below keep a plain run on ids 1 and 2.
 */
export const SEQUENTIAL_SCENARIO_ID = 1n;
export const ATOMIC_SCENARIO_ID = 2n;

/** Shared race identifier: the ticket id and every record's scenario_id. */
export const RACE_ID = "SR-ENGINE-0001";

/** Gap expiry instant (T_GAP_EXPIRY) for a spec: leg 1 + gap + pad. */
export function gapExpiryFor(spec: ScenarioSpec): bigint {
    return T_LEG1 + BigInt(spec.gap_ms) + T_GAP_PAD;
}

const CL_ORD_ID = "ORD-ENGINE-0001";
/** Fixed replay dates so two runs hash the same ticket identically. */
const TRADE_DATE = "2026-11-11";
const VALUE_DATE = "2026-11-13";
const DESK_A = "DESK-A";
const DESK_B = "DESK-B";

/** Step major replay order: the sequential lane first, then the atomic. */
const LANE_ORDER: readonly SettlementPathName[] = ["SEQUENTIAL", "ATOMIC"];

/** Fields appendRecord derives itself, callers never supply them. */
interface AppendArgs {
    lane: SettlementPathName;
    event: EventType;
    actor: ProvenanceActor;
    data: Record<string, string | number | boolean>;
    tx_sig?: string | null;
    note?: string;
    status_snapshot?: RaceEvent["status_snapshot"];
}

interface AckStep {
    event: "ACK_A" | "ACK_B";
    actor: ProvenanceActor;
    signer: PublicKey;
    desk: string;
}

interface FundStep {
    leg: LegName;
    actor: ProvenanceActor;
    signer: PublicKey;
    amount: bigint;
}

interface LanePathRegistrar {
    registerLanePath(scenario: PublicKey, path: SettlementPathName): void;
}

/**
 * Build the shared trade ticket for a spec. Both lanes init with this one
 * ticket's hash. The ticket names the sequential path (the pay-first
 * baseline of the comparison); the per-lane path lives in initScenario's
 * path argument and in every record's data.lane, which keeps the path
 * binding client side through provenance as the architecture specifies.
 */
function ticketForSpec(
    spec: ScenarioSpec,
    partyAWallet: string,
    partyBWallet: string,
): TradeTicket {
    // Integer rate math: quote cents scaled by rate_scale over base cents,
    // exact for the scenario catalogue amounts.
    const rateScaled =
        (spec.leg2_cad_cents * 1_000_000n) / spec.leg1_usd_cents;
    return buildTicket({
        ticket_id: RACE_ID,
        cl_ord_id: CL_ORD_ID,
        trade_date: TRADE_DATE,
        value_date: VALUE_DATE,
        side: "BUY_CAD",
        party_a: { desk_id: DESK_A, wallet: partyAWallet },
        party_b: { desk_id: DESK_B, wallet: partyBWallet },
        base_amount_cents: spec.leg1_usd_cents.toString(),
        quote_amount_cents: spec.leg2_cad_cents.toString(),
        rate_scaled: rateScaled.toString(),
        settlement_path: "SEQUENTIAL",
        scenario: spec.kind,
        gap_ms: spec.gap_ms,
        lifecycle: "NEW",
    });
}

/** Party B's CAD funding in integer cents: leg 2 times fund_bps / 10000. */
function fundCadCents(spec: ScenarioSpec): bigint {
    return (spec.leg2_cad_cents * BigInt(spec.fund_bps)) / 10_000n;
}

/** Lowercase hex of a byte array (32 byte hashes to 64 hex characters). */
function bytesToHex(bytes: Uint8Array): string {
    let hex = "";
    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, "0");
    }
    return hex;
}

/**
 * Call registerLanePath when the client exposes it. AnchorClient keeps the
 * lane path client side for start_race and exposes this extension, while
 * the mock records the path at initScenario and needs no registration.
 */
function registerLanePath(
    client: ProgramClient,
    scenario: PublicKey,
    path: SettlementPathName,
): void {
    const registrar = client as unknown as Partial<LanePathRegistrar>;
    if (typeof registrar.registerLanePath === "function") {
        registrar.registerLanePath(scenario, path);
    }
}

export class ScenarioEngine {
    private readonly opts: EngineOptions;
    private readonly sequentialScenarioId: bigint;
    private readonly atomicScenarioId: bigint;
    private readonly sequentialScenario: PublicKey;
    private readonly atomicScenario: PublicKey;
    private runChain = new ProvenanceChain();
    private clock = new VirtualClock(0n);

    constructor(opts: EngineOptions) {
        this.opts = opts;
        this.sequentialScenarioId =
            opts.scenario_id_base ?? SEQUENTIAL_SCENARIO_ID;
        this.atomicScenarioId = this.sequentialScenarioId + 1n;
        this.sequentialScenario = scenarioPda(
            opts.driver.publicKey,
            this.sequentialScenarioId,
        )[0];
        this.atomicScenario = scenarioPda(
            opts.driver.publicKey,
            this.atomicScenarioId,
        )[0];
    }

    /** Provenance chain of the current (or most recent) run. */
    get chain(): ProvenanceChain {
        return this.runChain;
    }

    /**
     * Run one scenario to a terminal state, yielding one RaceEvent per
     * provenance append: shared setup, then settlement dispatched by spec
     * kind, then the anchor step when opts.anchor_head is set. Every kind
     * ends terminal, so the anchor step gates only on the option.
     *
     * @throws Error when a client transaction fails, a fairness or
     * terminal status assertion breaks, a lane ends outside the spec's
     * expected terminals, or the scenario kind has no settlement strategy.
     */
    async *run(spec: ScenarioSpec): AsyncGenerator<RaceEvent> {
        this.runChain = new ProvenanceChain();
        this.clock = new VirtualClock(0n);
        const phases: Array<AsyncGenerator<RaceEvent>> = [
            this.setupPhase(spec),
            this.settleByKind(spec),
        ];
        if (this.opts.anchor_head === true) {
            phases.push(this.anchorPhase());
        }
        for (const phase of phases) {
            for await (const event of phase) {
                this.opts.onEvent?.(event);
                yield event;
            }
        }
    }

    /**
     * Shared setup for every scenario: one ticket hashed into both lane
     * accounts, fairness snapshot, acknowledgements, funding, the clock
     * move to T_START, and both race starts.
     */
    private async *setupPhase(spec: ScenarioSpec): AsyncGenerator<RaceEvent> {
        const client = this.opts.client;
        const ticket = ticketForSpec(
            spec,
            this.opts.wallet.publicKey.toBase58(),
            this.opts.partyB.toBase58(),
        );
        // headToBytes converts any 64 hex character hash to its 32 bytes.
        const ticketBytes = headToBytes(ticket.ticket_hash);
        const gapMs = BigInt(spec.gap_ms);
        const cadCents = fundCadCents(spec);

        const initSequential = this.assertOk(
            "initialize sequential lane",
            await client.initScenario({
                driver: this.opts.driver.publicKey,
                party_a: this.opts.partyA,
                party_b: this.opts.partyB,
                scenario_id: this.sequentialScenarioId,
                ticket_hash: ticketBytes,
                path: "SEQUENTIAL",
                leg1_usd_cents: spec.leg1_usd_cents,
                leg2_cad_cents: spec.leg2_cad_cents,
                gap_ms: gapMs,
            }),
        );
        const initAtomic = this.assertOk(
            "initialize atomic lane",
            await client.initScenario({
                driver: this.opts.driver.publicKey,
                party_a: this.opts.partyA,
                party_b: this.opts.partyB,
                scenario_id: this.atomicScenarioId,
                ticket_hash: ticketBytes,
                path: "ATOMIC",
                leg1_usd_cents: spec.leg1_usd_cents,
                leg2_cad_cents: spec.leg2_cad_cents,
                gap_ms: gapMs,
            }),
        );
        registerLanePath(client, this.sequentialScenario, "SEQUENTIAL");
        registerLanePath(client, this.atomicScenario, "ATOMIC");

        // Fairness: snapshot both starts and refuse to race on a mismatch.
        const sequentialStart = await this.fetchLane(
            this.sequentialScenario,
            "sequential start snapshot",
        );
        const atomicStart = await this.fetchLane(
            this.atomicScenario,
            "atomic start snapshot",
        );
        this.assertEqualStarts(sequentialStart, atomicStart);

        const ticketData = {
            ticket_id: RACE_ID,
            ticket_hash: ticket.ticket_hash,
        };
        yield this.appendRecord({
            lane: "SEQUENTIAL",
            event: "TICKET_CREATED",
            actor: "ENGINE",
            data: ticketData,
            tx_sig: initSequential,
        });
        yield this.appendRecord({
            lane: "ATOMIC",
            event: "TICKET_CREATED",
            actor: "ENGINE",
            data: ticketData,
            tx_sig: initAtomic,
        });

        // Acks, step major: party A on both lanes, then party B on both.
        const ackSteps: AckStep[] = [
            {
                event: "ACK_A",
                actor: "PARTY_A",
                signer: this.opts.partyA,
                desk: DESK_A,
            },
            {
                event: "ACK_B",
                actor: "PARTY_B",
                signer: this.opts.partyB,
                desk: DESK_B,
            },
        ];
        for (const step of ackSteps) {
            for (const lane of LANE_ORDER) {
                const signature = this.assertOk(
                    `${step.event} ${lane}`,
                    await client.ack({
                        scenario: this.scenarioFor(lane),
                        signer: step.signer,
                    }),
                );
                yield this.appendRecord({
                    lane,
                    event: step.event,
                    actor: step.actor,
                    data: { desk_id: step.desk },
                    tx_sig: signature,
                });
            }
        }

        // Funding, step major: A's USD on both lanes, then B's CAD on both.
        const fundSteps: FundStep[] = [
            {
                leg: "LEG1_USD",
                actor: "PARTY_A",
                signer: this.opts.partyA,
                amount: spec.leg1_usd_cents,
            },
            {
                leg: "LEG2_CAD",
                actor: "PARTY_B",
                signer: this.opts.partyB,
                amount: cadCents,
            },
        ];
        for (const step of fundSteps) {
            for (const lane of LANE_ORDER) {
                const signature = this.assertOk(
                    `fund ${step.leg} ${lane}`,
                    await client.fundLeg({
                        scenario: this.scenarioFor(lane),
                        signer: step.signer,
                        leg: step.leg,
                        amount_cents: step.amount,
                    }),
                );
                yield this.appendRecord({
                    lane,
                    event: "LEG_FUNDED",
                    actor: step.actor,
                    data: {
                        leg: step.leg,
                        amount_cents: step.amount.toString(),
                    },
                    tx_sig: signature,
                });
            }
        }

        // The clock must be positive before start_race: move both lanes.
        yield* this.advanceLane("SEQUENTIAL", T_START);
        yield* this.advanceLane("ATOMIC", T_START);

        for (const lane of LANE_ORDER) {
            const signature = this.assertOk(
                `start race ${lane}`,
                await client.startRace({
                    scenario: this.scenarioFor(lane),
                    signer: this.opts.driver.publicKey,
                }),
            );
            yield this.appendRecord({
                lane,
                event: "RACE_STARTED",
                actor: "ENGINE",
                data: {},
                tx_sig: signature,
            });
        }
    }

    /**
     * Dispatch settlement by scenario kind, then pin the run to the spec's
     * expected terminals. The atomic lane always runs first, at race start,
     * before the sequential lane spends the gap window. honest and
     * late_payment share the full payment strategy (paysAfterGap stamps the
     * late one, and nothing declares a default there); default_after_leg1,
     * atomic_revert, and partial_payment share the defaulting strategy; only
     * the underfunded kinds attempt an atomic settle that must revert.
     */
    private async *settleByKind(spec: ScenarioSpec): AsyncGenerator<RaceEvent> {
        switch (spec.kind) {
            case "honest":
            case "late_payment":
                yield* this.settleHonestAtomic();
                yield* this.settleFullSequential(spec);
                break;
            case "default_after_leg1":
                yield* this.settleHonestAtomic();
                yield* this.settleDefaultingSequential(spec);
                break;
            case "atomic_revert":
            case "partial_payment":
                yield* this.settleRevertingAtomic();
                yield* this.settleDefaultingSequential(spec);
                break;
            default:
                // Unreachable for the five ScenarioKind values; keeps a
                // sixth kind from silently ending a run non terminal.
                throw new Error(
                    `ScenarioEngine: scenario kind "${spec.kind}" has no settlement strategy`,
                );
        }
        await this.assertExpectedTerminals(spec);
    }

    /** Honest atomic strategy: one settle_atomic transaction, then SETTLED. */
    private async *settleHonestAtomic(): AsyncGenerator<RaceEvent> {
        const lane: SettlementPathName = "ATOMIC";
        const signature = this.assertOk(
            "settle atomic lane",
            await this.opts.client.settleAtomic({
                scenario: this.atomicScenario,
                signer: this.opts.driver.publicKey,
            }),
        );
        const account = await this.fetchLane(
            this.atomicScenario,
            "atomic settlement check",
        );
        if (account.status !== "SETTLED") {
            throw new Error(
                "ScenarioEngine: atomic lane expected SETTLED after " +
                    `settle_atomic, got ${account.status}`,
            );
        }
        yield this.appendRecord({
            lane,
            event: "ATOMIC_SETTLED",
            actor: "ENGINE",
            data: {},
            tx_sig: signature,
            note: "one transaction moves both legs or neither",
        });
    }

    /**
     * Full payment sequential strategy (honest and late_payment): advance to
     * T_LEG1, release leg 1, advance past the gap deadline, then let party B
     * release leg 2 in full. paysAfterGap marks the late run in the record
     * data, and no declare_default ever races the payment, so a pay after
     * the deadline still settles. The run's last event carries both statuses.
     */
    private async *settleFullSequential(
        spec: ScenarioSpec,
    ): AsyncGenerator<RaceEvent> {
        const lane: SettlementPathName = "SEQUENTIAL";
        const late = botDecision.paysAfterGap(spec);
        yield* this.advanceLane(lane, T_LEG1);
        yield* this.releaseLeg1Step();
        yield* this.advanceLane(lane, gapExpiryFor(spec));
        const releaseLeg2 = this.assertOk(
            "release leg 2",
            await this.opts.client.releaseLeg2({
                scenario: this.sequentialScenario,
                signer: this.opts.partyB,
            }),
        );
        const sequential = await this.fetchLane(
            this.sequentialScenario,
            "sequential settlement check",
        );
        if (sequential.status !== "SETTLED") {
            throw new Error(
                "ScenarioEngine: sequential lane expected SETTLED after " +
                    `release_leg2, got ${sequential.status}`,
            );
        }
        const atomic = await this.fetchLane(
            this.atomicScenario,
            "final atomic snapshot",
        );
        const data: Record<string, string | number | boolean> = {
            paid_cad_cents: sequential.paid_cad_cents.toString(),
        };
        if (late) {
            data.late = true;
        }
        yield this.appendRecord({
            lane,
            event: "LEG2_RELEASED",
            actor: "ENGINE",
            data,
            tx_sig: releaseLeg2,
            note: late
                ? "paid after the gap deadline, before any default"
                : undefined,
            status_snapshot: {
                sequential: sequential.status,
                atomic: atomic.status,
            },
        });
    }

    /** Release leg 1 on the sequential lane, opening the exposure window. */
    private async *releaseLeg1Step(): AsyncGenerator<RaceEvent> {
        const signature = this.assertOk(
            "release leg 1",
            await this.opts.client.releaseLeg1({
                scenario: this.sequentialScenario,
                signer: this.opts.driver.publicKey,
            }),
        );
        yield this.appendRecord({
            lane: "SEQUENTIAL",
            event: "LEG1_RELEASED",
            actor: "ENGINE",
            data: {},
            tx_sig: signature,
            note: "exposure window open",
        });
    }

    /**
     * Defaulting sequential strategy (default_after_leg1, atomic_revert,
     * partial_payment): advance to T_LEG1, release leg 1, run the scripted
     * leg 2 action (default refuses per leg2Action, the underfunded kinds
     * pay the mechanical partial at the spec's fund_bps), advance past the
     * gap deadline, then let the driver declare the default. A's released
     * USD stays with B, paid_cad_cents keeps whatever partial amount
     * arrived, and the run's last event carries both statuses.
     */
    private async *settleDefaultingSequential(
        spec: ScenarioSpec,
    ): AsyncGenerator<RaceEvent> {
        const lane: SettlementPathName = "SEQUENTIAL";
        yield* this.advanceLane(lane, T_LEG1);
        yield* this.releaseLeg1Step();

        const action = botDecision.leg2Action(spec);
        if (action.kind === "partial") {
            yield* this.payLeg2PartialStep(spec, action.amount_bps);
        } else if (action.kind === "full") {
            // A full payment settles the lane, which would race the
            // declare_default below: no defaulting kind may pay in full.
            throw new Error(
                `ScenarioEngine: defaulting scenario kind "${spec.kind}" ` +
                    "cannot pay leg 2 in full and still default",
            );
        }

        yield* this.advanceLane(lane, gapExpiryFor(spec));
        yield* this.declareDefaultStep();
    }

    /**
     * Party B's partial leg 2 payment: integer basis points over the leg 2
     * notional, floored to whole cents with the same formula fundCadCents
     * funds, so the amount always fits the recorded funding cap. The record
     * carries the amount paid and the lane's running paid total.
     */
    private async *payLeg2PartialStep(
        spec: ScenarioSpec,
        amountBps: number,
    ): AsyncGenerator<RaceEvent> {
        const lane: SettlementPathName = "SEQUENTIAL";
        const amountCents = (spec.leg2_cad_cents * BigInt(amountBps)) / 10_000n;
        if (amountCents <= 0n) {
            throw new Error(
                `ScenarioEngine: partial leg 2 payment is zero at ${amountBps} bps`,
            );
        }
        const signature = this.assertOk(
            "release leg 2 partial",
            await this.opts.client.releaseLeg2Partial({
                scenario: this.sequentialScenario,
                signer: this.opts.partyB,
                amount_cents: amountCents,
            }),
        );
        const sequential = await this.fetchLane(
            this.sequentialScenario,
            "partial payment check",
        );
        yield this.appendRecord({
            lane,
            event: "LEG2_PARTIAL",
            actor: "ENGINE",
            data: {
                amount_cents: amountCents.toString(),
                paid_cad_cents: sequential.paid_cad_cents.toString(),
            },
            tx_sig: signature,
            note: "partial payment leaves the rest of leg 2 owed",
        });
    }

    /**
     * Driver declares the default once the clock is past the gap deadline:
     * the unpaid CAD remainder returns to B, the released USD stays with B,
     * and the sequential lane ends DEFAULTED. The record carries the paid
     * total and both terminal statuses.
     */
    private async *declareDefaultStep(): AsyncGenerator<RaceEvent> {
        const lane: SettlementPathName = "SEQUENTIAL";
        const signature = this.assertOk(
            "declare default",
            await this.opts.client.declareDefault({
                scenario: this.sequentialScenario,
                signer: this.opts.driver.publicKey,
            }),
        );
        const sequential = await this.fetchLane(
            this.sequentialScenario,
            "default settlement check",
        );
        if (sequential.status !== "DEFAULTED") {
            throw new Error(
                "ScenarioEngine: sequential lane expected DEFAULTED after " +
                    `declare_default, got ${sequential.status}`,
            );
        }
        const atomic = await this.fetchLane(
            this.atomicScenario,
            "final atomic snapshot",
        );
        yield this.appendRecord({
            lane,
            event: "DEFAULT_DECLARED",
            actor: "DRIVER",
            data: { paid_cad_cents: sequential.paid_cad_cents.toString() },
            tx_sig: signature,
            note: "gap expired with leg 2 unpaid",
            status_snapshot: {
                sequential: sequential.status,
                atomic: atomic.status,
            },
        });
    }

    /**
     * Reverting atomic strategy (atomic_revert and partial_payment): the
     * underfunded lane attempts settle_atomic, the instruction rejects with
     * InsufficientEscrow before anything moves, the engine records the whole
     * transaction revert with no signature, and the driver marks the lane
     * FAILED in a follow-up transaction. The lane's balances stay bit
     * identical to their pre attempt state.
     */
    private async *settleRevertingAtomic(): AsyncGenerator<RaceEvent> {
        const lane: SettlementPathName = "ATOMIC";
        const attempt = await this.opts.client.settleAtomic({
            scenario: this.atomicScenario,
            signer: this.opts.driver.publicKey,
        });
        if (attempt.ok) {
            throw new Error(
                "ScenarioEngine: underfunded atomic lane settled instead of " +
                    "reverting",
            );
        }
        if (!attempt.error.includes("InsufficientEscrow")) {
            throw new Error(
                "ScenarioEngine: atomic lane expected InsufficientEscrow, " +
                    `got: ${attempt.error}`,
            );
        }
        yield this.appendRecord({
            lane,
            event: "ATOMIC_REVERTED",
            actor: "ENGINE",
            data: { error: attempt.error },
            tx_sig: null,
            note: "settle_atomic reverted whole transaction: no funds moved",
        });

        const reason = "settle_atomic reverted with InsufficientEscrow";
        const signature = this.assertOk(
            "mark atomic failure",
            await this.opts.client.markFailed({
                scenario: this.atomicScenario,
                signer: this.opts.driver.publicKey,
                reason,
            }),
        );
        const atomic = await this.fetchLane(
            this.atomicScenario,
            "atomic failure check",
        );
        if (atomic.status !== "FAILED") {
            throw new Error(
                "ScenarioEngine: atomic lane expected FAILED after " +
                    `mark_failed, got ${atomic.status}`,
            );
        }
        yield this.appendRecord({
            lane,
            event: "FAILED_MARKED",
            actor: "DRIVER",
            data: { reason },
            tx_sig: signature,
            note: "atomic lane failed with zero movement",
        });
    }

    /**
     * Pin the finished run to the spec contract: both lanes must sit exactly
     * on expected_sequential_terminal and expected_atomic_terminal, so a
     * strategy that ends a lane in the wrong state fails the run instead of
     * shipping a wrong race.
     */
    private async assertExpectedTerminals(spec: ScenarioSpec): Promise<void> {
        const sequential = await this.fetchLane(
            this.sequentialScenario,
            "sequential terminal check",
        );
        const atomic = await this.fetchLane(
            this.atomicScenario,
            "atomic terminal check",
        );
        if (sequential.status !== spec.expected_sequential_terminal) {
            throw new Error(
                `ScenarioEngine: ${spec.kind} expected sequential terminal ` +
                    `${spec.expected_sequential_terminal}, ` +
                    `got ${sequential.status}`,
            );
        }
        if (atomic.status !== spec.expected_atomic_terminal) {
            throw new Error(
                `ScenarioEngine: ${spec.kind} expected atomic terminal ` +
                    `${spec.expected_atomic_terminal}, got ${atomic.status}`,
            );
        }
    }

    /**
     * Terminal anchor: append CHAIN_ANCHORED first so the anchored head
     * covers the whole chain, then anchor the resulting head and count on
     * the sequential lane PDA. The record's tx_sig stays null (hashed
     * before the transaction), while the yielded event carries the anchor
     * signature and both terminal statuses.
     */
    private async *anchorPhase(): AsyncGenerator<RaceEvent> {
        const sequential = await this.fetchLane(
            this.sequentialScenario,
            "anchor sequential snapshot",
        );
        const atomic = await this.fetchLane(
            this.atomicScenario,
            "anchor atomic snapshot",
        );
        const event = this.appendRecord({
            lane: "SEQUENTIAL",
            event: "CHAIN_ANCHORED",
            actor: "DRIVER",
            data: { anchored_virtual_ms: this.clock.now().toString() },
            tx_sig: null,
            note: "recorded before the anchor transaction so the anchored " +
                "head covers it",
            status_snapshot: {
                sequential: sequential.status,
                atomic: atomic.status,
            },
        });
        const signature = this.assertOk(
            "anchor chain head",
            await this.opts.client.anchorChainHead({
                scenario: this.sequentialScenario,
                signer: this.opts.driver.publicKey,
                final_hash: headToBytes(this.runChain.head),
                event_count: BigInt(this.runChain.length),
                anchored_virtual_ms: this.clock.now(),
            }),
        );
        event.tx_sig = signature;
        yield event;
    }

    /** Advance one lane's clock, then stamp and yield CLOCK_ADVANCED. */
    private async *advanceLane(
        lane: SettlementPathName,
        toMs: bigint,
    ): AsyncGenerator<RaceEvent> {
        const signature = this.assertOk(
            `advance clock ${lane}`,
            await this.opts.client.advanceClock({
                scenario: this.scenarioFor(lane),
                signer: this.opts.driver.publicKey,
                to_ms: toMs,
            }),
        );
        this.clock.advance(toMs);
        yield this.appendRecord({
            lane,
            event: "CLOCK_ADVANCED",
            actor: "DRIVER",
            data: { to_ms: toMs.toString() },
            tx_sig: signature,
        });
    }

    /** Append one record to the shared chain and view it as a RaceEvent. */
    private appendRecord(args: AppendArgs): RaceEvent {
        const virtual_ts_ms = this.clock.now();
        const provenance = this.runChain.append({
            schema_version: 1,
            seq: this.runChain.length,
            scenario_id: RACE_ID,
            event: args.event,
            actor: args.actor,
            virtual_ts_ms: virtual_ts_ms.toString(),
            real_ts_iso: null,
            data: { ...args.data, lane: args.lane },
            tx_sig: args.tx_sig ?? null,
        });
        return {
            lane: args.lane,
            event: args.event,
            virtual_ts_ms,
            seq: provenance.seq,
            provenance,
            tx_sig: args.tx_sig ?? undefined,
            note: args.note,
            status_snapshot: args.status_snapshot,
        };
    }

    /** Account address of one lane. */
    private scenarioFor(lane: SettlementPathName): PublicKey {
        return lane === "SEQUENTIAL"
            ? this.sequentialScenario
            : this.atomicScenario;
    }

    /** Fetch one lane account or throw with the fetch error. */
    private async fetchLane(
        scenario: PublicKey,
        context: string,
    ): Promise<ScenarioAccount> {
        const result = await this.opts.client.fetchScenario(scenario);
        if (!result.ok) {
            throw new Error(`ScenarioEngine: ${context} failed: ${result.error}`);
        }
        return result.value;
    }

    /** Unwrap a TxResult, throwing the program error string on failure. */
    private assertOk(label: string, result: TxResult): string {
        if (!result.ok) {
            throw new Error(`ScenarioEngine: ${label} failed: ${result.error}`);
        }
        return result.signature;
    }

    /**
     * Fairness assert: both lanes must start from the same ticket, the
     * same notionals, the same gap, and equal escrow counters, otherwise
     * the side by side comparison would be dishonest.
     */
    private assertEqualStarts(
        sequential: ScenarioAccount,
        atomic: ScenarioAccount,
    ): void {
        const fields: Array<[string, string, string]> = [
            [
                "funded_usd_cents",
                sequential.funded_usd_cents.toString(),
                atomic.funded_usd_cents.toString(),
            ],
            [
                "funded_cad_cents",
                sequential.funded_cad_cents.toString(),
                atomic.funded_cad_cents.toString(),
            ],
            [
                "leg1_usd_cents",
                sequential.leg1_usd_cents.toString(),
                atomic.leg1_usd_cents.toString(),
            ],
            [
                "leg2_cad_cents",
                sequential.leg2_cad_cents.toString(),
                atomic.leg2_cad_cents.toString(),
            ],
            [
                "gap_ms",
                sequential.gap_ms.toString(),
                atomic.gap_ms.toString(),
            ],
            [
                "ticket_hash",
                bytesToHex(sequential.ticket_hash),
                bytesToHex(atomic.ticket_hash),
            ],
        ];
        for (const [field, first, second] of fields) {
            if (first !== second) {
                throw new Error(
                    "ScenarioEngine: unfair start: " +
                        `${field} sequential=${first} atomic=${second}`,
                );
            }
        }
    }
}
