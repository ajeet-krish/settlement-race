import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import type { PublicKey } from "@solana/web3.js";
import {
    MockProgramClient,
    programErrorCode,
    type ProgramErrorCode,
} from "../mockClient";
import { scenarioPda } from "../pda";
import type { FetchResult, ScenarioAccount, TxResult } from "../programClient";
import type { SettlementPathName } from "../ticket";
import {
    LEG1_USD_CENTS,
    LEG2_CAD_CENTS,
    SCENARIOS,
} from "../../engine/scenarios";

// Shared constants (integer cents, virtual milliseconds; mirrors the
// LiteSVM suite so both suites describe the same race).
const TICKET_HASH = new Uint8Array(32).fill(7);
const T_START_MS = 1000n;
const GAP_MS = 5000n;
const DEADLINE_MS = T_START_MS + GAP_MS;
const PAST_GAP_MS = DEADLINE_MS + 1n;

interface Fixture {
    client: MockProgramClient;
    driver: PublicKey;
    partyA: PublicKey;
    partyB: PublicKey;
    outsider: PublicKey;
}

function makeFixture(): Fixture {
    return {
        client: new MockProgramClient(),
        driver: Keypair.generate().publicKey,
        partyA: Keypair.generate().publicKey,
        partyB: Keypair.generate().publicKey,
        outsider: Keypair.generate().publicKey,
    };
}

function expectOk(result: TxResult): string {
    if (!result.ok) {
        throw new Error(`expected success, got: ${result.error}`);
    }
    return result.signature;
}

function expectError(result: TxResult, code: ProgramErrorCode): void {
    if (result.ok) {
        throw new Error(`expected ${code}, got success ${result.signature}`);
    }
    expect(programErrorCode(result.error)).toBe(code);
}

async function fetchScenarioOk(
    client: MockProgramClient,
    scenario: PublicKey,
): Promise<ScenarioAccount> {
    const result: FetchResult<ScenarioAccount> = await client.fetchScenario(scenario);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
}

function bps(amount: bigint, share: number): bigint {
    return (amount * BigInt(share)) / 10_000n;
}

interface OpenLaneArgs {
    path: SettlementPathName;
    /** CAD cents party B escrows for leg 2. */
    cad_cents: bigint;
    scenarioId?: bigint;
}

/** Init, clock, double ack, funding, start: the shared lane opener. */
async function openLane(f: Fixture, args: OpenLaneArgs): Promise<PublicKey> {
    const scenarioId = args.scenarioId ?? 1n;
    const [scenario] = scenarioPda(f.driver, scenarioId);
    expectOk(
        await f.client.initScenario({
            driver: f.driver,
            party_a: f.partyA,
            party_b: f.partyB,
            scenario_id: scenarioId,
            ticket_hash: TICKET_HASH,
            path: args.path,
            leg1_usd_cents: LEG1_USD_CENTS,
            leg2_cad_cents: LEG2_CAD_CENTS,
            gap_ms: GAP_MS,
        }),
    );
    expectOk(
        await f.client.advanceClock({ scenario, signer: f.driver, to_ms: T_START_MS }),
    );
    expectOk(await f.client.ack({ scenario, signer: f.partyA }));
    expectOk(await f.client.ack({ scenario, signer: f.partyB }));
    expectOk(
        await f.client.fundLeg({
            scenario,
            signer: f.partyA,
            leg: "LEG1_USD",
            amount_cents: LEG1_USD_CENTS,
        }),
    );
    expectOk(
        await f.client.fundLeg({
            scenario,
            signer: f.partyB,
            leg: "LEG2_CAD",
            amount_cents: args.cad_cents,
        }),
    );
    expectOk(await f.client.startRace({ scenario, signer: f.driver }));
    return scenario;
}

describe("MockProgramClient: five scenario happy paths", () => {
    it.each(SCENARIOS)(
        "$kind drives both lanes to the expected terminals",
        async (spec) => {
            const f = makeFixture();
            const cadFund = bps(LEG2_CAD_CENTS, spec.fund_bps);
            const seq = await openLane(f, {
                path: "SEQUENTIAL",
                cad_cents: cadFund,
                scenarioId: 1n,
            });
            const atomic = await openLane(f, {
                path: "ATOMIC",
                cad_cents: cadFund,
                scenarioId: 2n,
            });

            // Both lanes opened with identical notionals and funding.
            const seqOpen = await fetchScenarioOk(f.client, seq);
            expect(seqOpen.status).toBe("PAYING");
            expect(seqOpen.path).toBe("SEQUENTIAL");
            expect(seqOpen.funded_usd_cents).toBe(LEG1_USD_CENTS);
            expect(seqOpen.funded_cad_cents).toBe(cadFund);
            expect(seqOpen.race_started_at_ms).toBe(T_START_MS);
            const seqVault = f.client.getVaultBalances(seq);
            expect(seqVault).toEqual({ usd_cents: LEG1_USD_CENTS, cad_cents: cadFund });

            // Sequential lane: leg 1 first, then the bot's behavior.
            expectOk(await f.client.releaseLeg1({ scenario: seq, signer: f.driver }));
            const afterLeg1 = await fetchScenarioOk(f.client, seq);
            expect(afterLeg1.leg1_released_at_ms).toBe(T_START_MS);
            expect(f.client.getVaultBalances(seq)).toEqual({
                usd_cents: 0n,
                cad_cents: cadFund,
            });

            if (spec.bot_behavior === "default_after_leg1") {
                // The bot pays nothing further: gap expiry locks the loss.
                expectOk(
                    await f.client.advanceClock({
                        scenario: seq,
                        signer: f.driver,
                        to_ms: PAST_GAP_MS,
                    }),
                );
                expectOk(
                    await f.client.declareDefault({ scenario: seq, signer: f.driver }),
                );
            } else if (cadFund < LEG2_CAD_CENTS) {
                // Underfunded lane: pay everything available, then default.
                expectOk(
                    await f.client.releaseLeg2Partial({
                        scenario: seq,
                        signer: f.partyB,
                        amount_cents: cadFund,
                    }),
                );
                const midSeq = await fetchScenarioOk(f.client, seq);
                expect(midSeq.status).toBe("PAYING");
                expect(midSeq.paid_cad_cents).toBe(cadFund);
                expectOk(
                    await f.client.advanceClock({
                        scenario: seq,
                        signer: f.driver,
                        to_ms: PAST_GAP_MS,
                    }),
                );
                expectOk(
                    await f.client.declareDefault({ scenario: seq, signer: f.driver }),
                );
            } else if (spec.bot_behavior === "late_payment") {
                // Default window open, then the bot races it with a payment.
                expectOk(
                    await f.client.advanceClock({
                        scenario: seq,
                        signer: f.driver,
                        to_ms: PAST_GAP_MS,
                    }),
                );
                expectOk(
                    await f.client.releaseLeg2({ scenario: seq, signer: f.partyB }),
                );
            } else {
                // Honest: the payment lands exactly as the gap window closes.
                expectOk(
                    await f.client.advanceClock({
                        scenario: seq,
                        signer: f.driver,
                        to_ms: DEADLINE_MS,
                    }),
                );
                expectOk(
                    await f.client.releaseLeg2({ scenario: seq, signer: f.partyB }),
                );
            }

            const seqFinal = await fetchScenarioOk(f.client, seq);
            expect(seqFinal.status).toBe(spec.expected_sequential_terminal);
            if (spec.expected_sequential_terminal === "SETTLED") {
                expect(seqFinal.paid_cad_cents).toBe(LEG2_CAD_CENTS);
            }
            if (spec.expected_sequential_terminal === "DEFAULTED") {
                // The defaulting bot paid nothing; underfunded lanes paid
                // everything they had escrowed before defaulting.
                const expectedPaid =
                    spec.bot_behavior === "default_after_leg1" ? 0n : cadFund;
                expect(seqFinal.paid_cad_cents).toBe(expectedPaid);
            }

            // Atomic lane: one settle instruction, or revert then mark failed.
            const settle = await f.client.settleAtomic({
                scenario: atomic,
                signer: f.driver,
            });
            if (settle.ok) {
                expect(spec.expected_atomic_terminal).toBe("SETTLED");
            } else {
                expectError(settle, "InsufficientEscrow");
                // The revert moved nothing: the lane is still Paying.
                const atomicMid = await fetchScenarioOk(f.client, atomic);
                expect(atomicMid.status).toBe("PAYING");
                expect(f.client.getVaultBalances(atomic)).toEqual({
                    usd_cents: LEG1_USD_CENTS,
                    cad_cents: cadFund,
                });
                expectOk(
                    await f.client.markFailed({
                        scenario: atomic,
                        signer: f.driver,
                        reason: "cad vault short at settlement",
                    }),
                );
            }
            const atomicFinal = await fetchScenarioOk(f.client, atomic);
            expect(atomicFinal.status).toBe(spec.expected_atomic_terminal);
            if (atomicFinal.status === "SETTLED") {
                expect(f.client.getVaultBalances(atomic)).toEqual({
                    usd_cents: 0n,
                    cad_cents: 0n,
                });
            }
        },
    );
});

describe("MockProgramClient: signer guards", () => {
    it("surfaces wrong signer attempts as NotParty without state changes", async () => {
        const f = makeFixture();
        const seq = await openLane(f, { path: "SEQUENTIAL", cad_cents: LEG2_CAD_CENTS });
        const atomic = await openLane(f, {
            path: "ATOMIC",
            cad_cents: LEG2_CAD_CENTS,
            scenarioId: 2n,
        });

        expectError(
            await f.client.startRace({ scenario: seq, signer: f.partyB }),
            "NotParty",
        );
        expectError(
            await f.client.releaseLeg1({ scenario: seq, signer: f.partyA }),
            "NotParty",
        );
        expectError(
            await f.client.advanceClock({
                scenario: seq,
                signer: f.partyA,
                to_ms: PAST_GAP_MS,
            }),
            "NotParty",
        );
        expectError(
            await f.client.declareDefault({ scenario: seq, signer: f.partyB }),
            "NotParty",
        );
        expectError(
            await f.client.settleAtomic({ scenario: atomic, signer: f.partyA }),
            "NotParty",
        );
        expectError(
            await f.client.markFailed({
                scenario: seq,
                signer: f.partyB,
                reason: "grief",
            }),
            "NotParty",
        );
        expectError(
            await f.client.anchorChainHead({
                scenario: seq,
                signer: f.partyA,
                final_hash: new Uint8Array(32),
                event_count: 1n,
                anchored_virtual_ms: T_START_MS,
            }),
            "NotParty",
        );

        // Leg 2 stays party B only, even for the USD payer.
        expectOk(await f.client.releaseLeg1({ scenario: seq, signer: f.driver }));
        expectError(
            await f.client.releaseLeg2({ scenario: seq, signer: f.partyA }),
            "NotParty",
        );
        expectError(
            await f.client.releaseLeg2Partial({
                scenario: seq,
                signer: f.partyA,
                amount_cents: 1n,
            }),
            "NotParty",
        );

        // No lane state moved: still Paying with the clock untouched.
        const account = await fetchScenarioOk(f.client, seq);
        expect(account.status).toBe("PAYING");
        expect(account.virtual_now_ms).toBe(T_START_MS);
    });

    it("rejects a non party acknowledgement before any flag flips", async () => {
        const f = makeFixture();
        const [scenario] = scenarioPda(f.driver, 1n);
        expectOk(
            await f.client.initScenario({
                driver: f.driver,
                party_a: f.partyA,
                party_b: f.partyB,
                scenario_id: 1n,
                ticket_hash: TICKET_HASH,
                path: "SEQUENTIAL",
                leg1_usd_cents: LEG1_USD_CENTS,
                leg2_cad_cents: LEG2_CAD_CENTS,
                gap_ms: GAP_MS,
            }),
        );
        expectError(await f.client.ack({ scenario, signer: f.outsider }), "NotParty");
        expectOk(await f.client.ack({ scenario, signer: f.partyA }));
        expectError(await f.client.ack({ scenario, signer: f.partyA }), "BadState");
        const account = await fetchScenarioOk(f.client, scenario);
        expect(account.ack_a).toBe(true);
        expect(account.ack_b).toBe(false);
        expect(account.status).toBe("NEW");
    });
});

describe("MockProgramClient: gap and clock rules", () => {
    it("rejects declare_default until virtual time passes the deadline", async () => {
        const f = makeFixture();
        const seq = await openLane(f, { path: "SEQUENTIAL", cad_cents: LEG2_CAD_CENTS });
        expectOk(await f.client.releaseLeg1({ scenario: seq, signer: f.driver }));

        // Exactly at the deadline default is premature: strictly greater.
        expectOk(
            await f.client.advanceClock({
                scenario: seq,
                signer: f.driver,
                to_ms: DEADLINE_MS,
            }),
        );
        expectError(
            await f.client.declareDefault({ scenario: seq, signer: f.driver }),
            "GapNotExpired",
        );
        expectOk(
            await f.client.advanceClock({
                scenario: seq,
                signer: f.driver,
                to_ms: PAST_GAP_MS,
            }),
        );
        expectOk(await f.client.declareDefault({ scenario: seq, signer: f.driver }));
        const account = await fetchScenarioOk(f.client, seq);
        expect(account.status).toBe("DEFAULTED");
    });

    it("rejects a backwards clock move with ClockRegression", async () => {
        const f = makeFixture();
        const seq = await openLane(f, { path: "SEQUENTIAL", cad_cents: LEG2_CAD_CENTS });
        expectError(
            await f.client.advanceClock({
                scenario: seq,
                signer: f.driver,
                to_ms: T_START_MS - 1n,
            }),
            "ClockRegression",
        );
        const account = await fetchScenarioOk(f.client, seq);
        expect(account.virtual_now_ms).toBe(T_START_MS);
    });
});

describe("MockProgramClient: terminal states never reopen", () => {
    it("rejects every state transition after settlement", async () => {
        const f = makeFixture();
        const seq = await openLane(f, { path: "SEQUENTIAL", cad_cents: LEG2_CAD_CENTS });
        const atomic = await openLane(f, {
            path: "ATOMIC",
            cad_cents: LEG2_CAD_CENTS,
            scenarioId: 2n,
        });
        expectOk(await f.client.releaseLeg1({ scenario: seq, signer: f.driver }));
        expectOk(
            await f.client.advanceClock({
                scenario: seq,
                signer: f.driver,
                to_ms: DEADLINE_MS,
            }),
        );
        expectOk(await f.client.releaseLeg2({ scenario: seq, signer: f.partyB }));
        expectOk(await f.client.settleAtomic({ scenario: atomic, signer: f.driver }));

        expectError(
            await f.client.declareDefault({ scenario: seq, signer: f.driver }),
            "BadState",
        );
        expectError(
            await f.client.startRace({ scenario: seq, signer: f.driver }),
            "BadState",
        );
        expectError(
            await f.client.advanceClock({
                scenario: seq,
                signer: f.driver,
                to_ms: PAST_GAP_MS,
            }),
            "BadState",
        );
        expectError(await f.client.ack({ scenario: seq, signer: f.partyA }), "BadState");
        expectError(
            await f.client.releaseLeg1({ scenario: seq, signer: f.driver }),
            "BadState",
        );
        expectError(
            await f.client.releaseLeg2({ scenario: seq, signer: f.partyB }),
            "BadState",
        );
        expectError(
            await f.client.markFailed({ scenario: seq, signer: f.driver, reason: "x" }),
            "BadState",
        );
        expectError(
            await f.client.settleAtomic({ scenario: atomic, signer: f.driver }),
            "BadState",
        );

        const seqFinal = await fetchScenarioOk(f.client, seq);
        expect(seqFinal.status).toBe("SETTLED");
        expect((await fetchScenarioOk(f.client, atomic)).status).toBe("SETTLED");
    });
});

describe("MockProgramClient: path, funding, and account guards", () => {
    it("rejects cross path instructions with WrongPath", async () => {
        const f = makeFixture();
        const seq = await openLane(f, { path: "SEQUENTIAL", cad_cents: LEG2_CAD_CENTS });
        const atomic = await openLane(f, {
            path: "ATOMIC",
            cad_cents: LEG2_CAD_CENTS,
            scenarioId: 2n,
        });
        expectOk(await f.client.releaseLeg1({ scenario: seq, signer: f.driver }));

        expectError(
            await f.client.settleAtomic({ scenario: seq, signer: f.driver }),
            "WrongPath",
        );
        expectError(
            await f.client.releaseLeg1({ scenario: atomic, signer: f.driver }),
            "WrongPath",
        );
        expectError(
            await f.client.declareDefault({ scenario: atomic, signer: f.driver }),
            "WrongPath",
        );
        expectError(
            await f.client.releaseLeg2({ scenario: atomic, signer: f.partyB }),
            "WrongPath",
        );
    });

    it("enforces the start_race acknowledgement, funding, and clock gates", async () => {
        const f = makeFixture();
        const [scenario] = scenarioPda(f.driver, 1n);
        expectOk(
            await f.client.initScenario({
                driver: f.driver,
                party_a: f.partyA,
                party_b: f.partyB,
                scenario_id: 1n,
                ticket_hash: TICKET_HASH,
                path: "ATOMIC",
                leg1_usd_cents: LEG1_USD_CENTS,
                leg2_cad_cents: LEG2_CAD_CENTS,
                gap_ms: GAP_MS,
            }),
        );
        expectOk(
            await f.client.advanceClock({ scenario, signer: f.driver, to_ms: T_START_MS }),
        );

        // Not acknowledged yet.
        expectError(
            await f.client.startRace({ scenario, signer: f.driver }),
            "BadState",
        );
        expectOk(await f.client.ack({ scenario, signer: f.partyA }));
        expectOk(await f.client.ack({ scenario, signer: f.partyB }));

        // Full USD with zero CAD cannot start.
        expectOk(
            await f.client.fundLeg({
                scenario,
                signer: f.partyA,
                leg: "LEG1_USD",
                amount_cents: LEG1_USD_CENTS,
            }),
        );
        expectError(
            await f.client.startRace({ scenario, signer: f.driver }),
            "NotFullyFunded",
        );

        // One cent of CAD satisfies the confirmed rule (USD exact, CAD > 0).
        expectOk(
            await f.client.fundLeg({
                scenario,
                signer: f.partyB,
                leg: "LEG2_CAD",
                amount_cents: 1n,
            }),
        );
        expectOk(await f.client.startRace({ scenario, signer: f.driver }));

        // A second lane pins the inexact USD rejection. Funding is checked
        // before the clock, so NotFullyFunded fires here even though this
        // lane's virtual clock is still at zero; the zero-clock rejection
        // on a fully funded lane has its own test below.
        const [lane2] = scenarioPda(f.driver, 2n);
        expectOk(
            await f.client.initScenario({
                driver: f.driver,
                party_a: f.partyA,
                party_b: f.partyB,
                scenario_id: 2n,
                ticket_hash: TICKET_HASH,
                path: "SEQUENTIAL",
                leg1_usd_cents: LEG1_USD_CENTS,
                leg2_cad_cents: LEG2_CAD_CENTS,
                gap_ms: GAP_MS,
            }),
        );
        expectOk(await f.client.ack({ scenario: lane2, signer: f.partyA }));
        expectOk(await f.client.ack({ scenario: lane2, signer: f.partyB }));
        expectOk(
            await f.client.fundLeg({
                scenario: lane2,
                signer: f.partyA,
                leg: "LEG1_USD",
                amount_cents: LEG1_USD_CENTS - 1n,
            }),
        );
        expectOk(
            await f.client.fundLeg({
                scenario: lane2,
                signer: f.partyB,
                leg: "LEG2_CAD",
                amount_cents: 1n,
            }),
        );
        expectError(
            await f.client.startRace({ scenario: lane2, signer: f.driver }),
            "NotFullyFunded",
        );
    });

    it("rejects start_race on a fully funded lane while the clock is zero", async () => {
        const f = makeFixture();
        const [scenario] = scenarioPda(f.driver, 1n);
        expectOk(
            await f.client.initScenario({
                driver: f.driver,
                party_a: f.partyA,
                party_b: f.partyB,
                scenario_id: 1n,
                ticket_hash: TICKET_HASH,
                path: "ATOMIC",
                leg1_usd_cents: LEG1_USD_CENTS,
                leg2_cad_cents: LEG2_CAD_CENTS,
                gap_ms: GAP_MS,
            }),
        );
        // No advanceClock: the lane stays at virtual_now_ms 0, which is
        // exactly the state the zero-time guard has to catch.
        expectOk(await f.client.ack({ scenario, signer: f.partyA }));
        expectOk(await f.client.ack({ scenario, signer: f.partyB }));
        expectOk(
            await f.client.fundLeg({
                scenario,
                signer: f.partyA,
                leg: "LEG1_USD",
                amount_cents: LEG1_USD_CENTS,
            }),
        );
        expectOk(
            await f.client.fundLeg({
                scenario,
                signer: f.partyB,
                leg: "LEG2_CAD",
                amount_cents: 1n,
            }),
        );

        // Fully funded (USD exact, CAD > 0), so the funding gate passes and
        // the clock guard is what rejects. start_race never flips the
        // status, which also makes release_leg1 at time 0 unreachable: the
        // status guard there rejects first. The identical clock check in
        // release_leg1 is defense in depth mirrored from the Rust program.
        expectError(
            await f.client.startRace({ scenario, signer: f.driver }),
            "BadState",
        );
        const account = await fetchScenarioOk(f.client, scenario);
        expect(account.status).toBe("ACK");
        expect(account.virtual_now_ms).toBe(0n);
        expect(account.race_started_at_ms).toBe(0n);
    });

    it("caps funding at the leg notional and requires Ack status", async () => {
        const f = makeFixture();
        const [scenario] = scenarioPda(f.driver, 1n);
        expectOk(
            await f.client.initScenario({
                driver: f.driver,
                party_a: f.partyA,
                party_b: f.partyB,
                scenario_id: 1n,
                ticket_hash: TICKET_HASH,
                path: "SEQUENTIAL",
                leg1_usd_cents: LEG1_USD_CENTS,
                leg2_cad_cents: LEG2_CAD_CENTS,
                gap_ms: GAP_MS,
            }),
        );

        // Funding is accepted in Ack only.
        expectError(
            await f.client.fundLeg({
                scenario,
                signer: f.partyA,
                leg: "LEG1_USD",
                amount_cents: LEG1_USD_CENTS,
            }),
            "BadState",
        );
        expectOk(await f.client.ack({ scenario, signer: f.partyA }));
        expectOk(await f.client.ack({ scenario, signer: f.partyB }));

        // Wrong party, zero amount, and over-notional are all rejected.
        expectError(
            await f.client.fundLeg({
                scenario,
                signer: f.partyB,
                leg: "LEG1_USD",
                amount_cents: 1n,
            }),
            "NotParty",
        );
        expectError(
            await f.client.fundLeg({
                scenario,
                signer: f.partyA,
                leg: "LEG1_USD",
                amount_cents: 0n,
            }),
            "AmountZero",
        );
        expectError(
            await f.client.fundLeg({
                scenario,
                signer: f.partyA,
                leg: "LEG1_USD",
                amount_cents: LEG1_USD_CENTS + 1n,
            }),
            "InsufficientEscrow",
        );
        const account = await fetchScenarioOk(f.client, scenario);
        expect(account.funded_usd_cents).toBe(0n);
    });

    it("rejects duplicate initialization of the same scenario id", async () => {
        const f = makeFixture();
        const args = {
            driver: f.driver,
            party_a: f.partyA,
            party_b: f.partyB,
            scenario_id: 7n,
            ticket_hash: TICKET_HASH,
            path: "SEQUENTIAL" as SettlementPathName,
            leg1_usd_cents: LEG1_USD_CENTS,
            leg2_cad_cents: LEG2_CAD_CENTS,
            gap_ms: GAP_MS,
        };
        expectOk(await f.client.initScenario(args));
        expectError(await f.client.initScenario(args), "AccountAlreadyInUse");
        expect(f.client.laneCount).toBe(1);
    });
});
