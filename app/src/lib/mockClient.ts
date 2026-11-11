/**
 * In-memory ProgramClient: the offline twin of the Anchor devnet client.
 *
 * Implements the whole ProgramClient contract against a simulated copy of
 * the on-chain state machine, mirroring the guards in
 * programs/settlement-race/src/instructions/: the same transition table,
 * signer matrix (driver-only orchestration, party B only leg 2), payout
 * caps at `funded - paid`, gap and clock rules, and terminal states that
 * never reopen. Every rejection carries the shared `ErrorName: message`
 * string, so the Phase 3 tests assert typed errors through the interface.
 *
 * This class is also the seed of Phase 6 offline mode: the engine, bot, and
 * UI run against it unchanged when no devnet connection exists.
 *
 * Signing model: the frozen interface passes the intended signer as a
 * PublicKey, which the on-chain program proves with a signature. The mock
 * trusts that claim the same way the program trusts the signature, then
 * enforces the identical role guards against the stored scenario roles. No
 * key material and no network are involved.
 *
 * Token modeling: there are no SPL accounts here. The vault counters stand
 * in for vault token balances (they move exactly like the on-chain vaults
 * because funding is the only source and every release decrements them),
 * and party wallet balances are not part of the client contract.
 */

import { PublicKey } from "@solana/web3.js";
import { chainHeadPda, scenarioPda } from "./pda";
import type { ChainHeadAccount } from "./anchorClient";
import type {
    AckArgs,
    AdvanceClockArgs,
    AnchorChainHeadArgs,
    DeclareDefaultArgs,
    FetchResult,
    FundLegArgs,
    InitScenarioArgs,
    LegName,
    MarkFailedArgs,
    ProgramClient,
    ReleaseLeg2PartialArgs,
    ReleaseLegArgs,
    ScenarioAccount,
    SettleAtomicArgs,
    StartRaceArgs,
    TxResult,
} from "./programClient";
import type { SettlementPathName } from "./ticket";

/** Largest gap window accepted at initialization (mirrors MAX_GAP_MS). */
const MAX_GAP_MS = 86_400_000n;
/** i64 upper bound; advance_clock keeps a full gap below it. */
const I64_MAX = 9_223_372_036_854_775_807n;
/** u64 upper bound for money counters. */
const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * Typed program error codes. The first nine mirror
 * programs/settlement-race/src/errors.rs exactly. `AccountAlreadyInUse`
 * and `AccountNotFound` cover account-level failures the program surfaces
 * through system program or account constraints (a double anchor reports
 * InvalidInstructionData on chain, see docs/tests.md F8; the mock keeps the
 * descriptive name because semantics are identical: rejected, no state
 * change). `InvalidInstructionData` covers malformed instruction arguments.
 */
export type ProgramErrorCode =
    | "InsufficientEscrow"
    | "NotParty"
    | "BadState"
    | "GapNotExpired"
    | "ClockRegression"
    | "NotFullyFunded"
    | "WrongPath"
    | "AmountZero"
    | "Overflow"
    | "AccountAlreadyInUse"
    | "AccountNotFound"
    | "InvalidInstructionData";

const PROGRAM_ERROR_CODES: ReadonlySet<string> = new Set([
    "InsufficientEscrow",
    "NotParty",
    "BadState",
    "GapNotExpired",
    "ClockRegression",
    "NotFullyFunded",
    "WrongPath",
    "AmountZero",
    "Overflow",
    "AccountAlreadyInUse",
    "AccountNotFound",
    "InvalidInstructionData",
]);

/**
 * Parse the code out of a `ErrorName: message` TxResult error string.
 * Returns null when the string did not come from a program style failure.
 */
export function programErrorCode(error: string): ProgramErrorCode | null {
    const sep = error.indexOf(":");
    if (sep <= 0) {
        return null;
    }
    const head = error.slice(0, sep);
    return PROGRAM_ERROR_CODES.has(head) ? (head as ProgramErrorCode) : null;
}

/** Escrow vault balances of one lane, in integer cents. */
export interface MockVaultBalances {
    usd_cents: bigint;
    cad_cents: bigint;
}

/** Internal lane state: the account plus escrow and anchor side data. */
interface MockLane {
    account: ScenarioAccount;
    vault: MockVaultBalances;
    chain_head: ChainHeadAccount | null;
    /**
     * Path requested at initScenario. The frozen StartRaceArgs carries no
     * path (the on-chain program records the route at start_race), so the
     * mock replays this requested path exactly like AnchorClient does.
     */
    requested_path: SettlementPathName;
}

function fail(code: ProgramErrorCode, message: string): TxResult {
    return { ok: false, error: `${code}: ${message}` };
}

/** Checked u64 add: null on overflow past the u64 range. */
function checkedAdd(a: bigint, b: bigint): bigint | null {
    const sum = a + b;
    return sum > U64_MAX ? null : sum;
}

function copyScenario(account: ScenarioAccount): ScenarioAccount {
    return { ...account, ticket_hash: Uint8Array.from(account.ticket_hash) };
}

function isTerminal(status: ScenarioAccount["status"]): boolean {
    return status === "SETTLED" || status === "DEFAULTED" || status === "FAILED";
}

export class MockProgramClient implements ProgramClient {
    private readonly lanes = new Map<string, MockLane>();
    private txCounter = 0;

    async initScenario(args: InitScenarioArgs): Promise<TxResult> {
        if (args.leg1_usd_cents <= 0n || args.leg2_cad_cents <= 0n) {
            return fail("AmountZero", "leg notionals must be greater than zero");
        }
        if (args.leg1_usd_cents > U64_MAX || args.leg2_cad_cents > U64_MAX) {
            return fail("Overflow", "leg notional outside the u64 range");
        }
        if (args.gap_ms <= 0n || args.gap_ms > MAX_GAP_MS) {
            return fail(
                "BadState",
                `gap_ms must be in 1 to ${MAX_GAP_MS.toString()}`,
            );
        }
        if (
            args.party_a.equals(PublicKey.default) ||
            args.party_b.equals(PublicKey.default)
        ) {
            return fail("NotParty", "parties must be real public keys");
        }
        if (args.party_a.equals(args.party_b)) {
            return fail("NotParty", "party_a and party_b must differ");
        }
        const [scenario, bump] = scenarioPda(args.driver, args.scenario_id);
        const key = scenario.toBase58();
        if (this.lanes.has(key)) {
            return fail("AccountAlreadyInUse", `scenario account already exists: ${key}`);
        }
        this.lanes.set(key, {
            account: {
                driver: args.driver,
                party_a: args.party_a,
                party_b: args.party_b,
                ticket_hash: Uint8Array.from(args.ticket_hash),
                status: "NEW",
                // Sequential placeholder until start_race, as on chain.
                path: "SEQUENTIAL",
                leg1_usd_cents: args.leg1_usd_cents,
                leg2_cad_cents: args.leg2_cad_cents,
                funded_usd_cents: 0n,
                funded_cad_cents: 0n,
                paid_cad_cents: 0n,
                ack_a: false,
                ack_b: false,
                virtual_now_ms: 0n,
                race_started_at_ms: 0n,
                leg1_released_at_ms: 0n,
                gap_ms: args.gap_ms,
                scenario_id: args.scenario_id,
                bump,
            },
            vault: { usd_cents: 0n, cad_cents: 0n },
            chain_head: null,
            requested_path: args.path,
        });
        return { ok: true, signature: this.nextSignature() };
    }

    async ack(args: AckArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (account.status !== "NEW") {
            return fail("BadState", `acknowledge not allowed in status ${account.status}`);
        }
        if (args.signer.equals(account.party_a)) {
            if (account.ack_a) {
                return fail("BadState", "party A already acknowledged");
            }
            account.ack_a = true;
        } else if (args.signer.equals(account.party_b)) {
            if (account.ack_b) {
                return fail("BadState", "party B already acknowledged");
            }
            account.ack_b = true;
        } else {
            return fail("NotParty", "signer is not a party of this scenario");
        }
        if (account.ack_a && account.ack_b) {
            account.status = "ACK";
        }
        return { ok: true, signature: this.nextSignature() };
    }

    async fundLeg(args: FundLegArgs): Promise<TxResult> {
        if (args.amount_cents <= 0n) {
            return fail("AmountZero", "amount_cents must be greater than zero");
        }
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (account.status !== "ACK") {
            return fail("BadState", `fund_leg not allowed in status ${account.status}`);
        }
        const leg: LegName = args.leg;
        const requiredParty = leg === "LEG1_USD" ? account.party_a : account.party_b;
        if (!args.signer.equals(requiredParty)) {
            return fail(
                "NotParty",
                leg === "LEG1_USD"
                    ? "only party A may fund the USD leg"
                    : "only party B may fund the CAD leg",
            );
        }
        const notional =
            leg === "LEG1_USD" ? account.leg1_usd_cents : account.leg2_cad_cents;
        const funded =
            leg === "LEG1_USD" ? account.funded_usd_cents : account.funded_cad_cents;
        const newFunded = checkedAdd(funded, args.amount_cents);
        if (newFunded === null) {
            return fail("Overflow", "funded counter outside the u64 range");
        }
        if (newFunded > notional) {
            return fail(
                "InsufficientEscrow",
                `funding would exceed the ${notional.toString()} cent notional`,
            );
        }
        if (leg === "LEG1_USD") {
            account.funded_usd_cents = newFunded;
            lane.vault.usd_cents += args.amount_cents;
        } else {
            account.funded_cad_cents = newFunded;
            lane.vault.cad_cents += args.amount_cents;
        }
        return { ok: true, signature: this.nextSignature() };
    }

    async startRace(args: StartRaceArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may start the race");
        }
        if (account.status !== "ACK") {
            return fail("BadState", `start_race not allowed in status ${account.status}`);
        }
        if (
            account.funded_usd_cents !== account.leg1_usd_cents ||
            account.funded_cad_cents === 0n
        ) {
            return fail(
                "NotFullyFunded",
                "USD must be funded exactly and CAD must be nonzero",
            );
        }
        if (account.virtual_now_ms <= 0n) {
            return fail("BadState", "virtual clock must be positive before start_race");
        }
        account.path = lane.requested_path;
        account.status = "PAYING";
        account.race_started_at_ms = account.virtual_now_ms;
        return { ok: true, signature: this.nextSignature() };
    }

    async releaseLeg1(args: ReleaseLegArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may release leg 1");
        }
        if (account.path !== "SEQUENTIAL") {
            return fail("WrongPath", "release_leg1 requires the sequential path");
        }
        if (account.status !== "PAYING") {
            return fail(
                "BadState",
                `release_leg1 not allowed in status ${account.status}`,
            );
        }
        if (account.leg1_released_at_ms !== 0n) {
            return fail("BadState", "leg 1 was already released");
        }
        if (account.virtual_now_ms <= 0n) {
            return fail("BadState", "virtual clock must be positive before release");
        }
        if (lane.vault.usd_cents < account.leg1_usd_cents) {
            return fail("InsufficientEscrow", "USD vault cannot cover leg 1");
        }
        lane.vault.usd_cents -= account.leg1_usd_cents;
        account.leg1_released_at_ms = account.virtual_now_ms;
        return { ok: true, signature: this.nextSignature() };
    }

    async releaseLeg2(args: ReleaseLegArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.party_b)) {
            return fail("NotParty", "only party B may pay the CAD leg");
        }
        const guard = this.sequentialPayingGuard(lane);
        if (guard !== null) {
            return guard;
        }
        const overflow = this.cadAccountingGuard(account);
        if (overflow !== null) {
            return overflow;
        }
        const remaining = account.leg2_cad_cents - account.paid_cad_cents;
        if (remaining <= 0n) {
            return fail("BadState", "leg 2 is already paid in full");
        }
        const available = account.funded_cad_cents - account.paid_cad_cents;
        if (remaining > available) {
            return fail(
                "InsufficientEscrow",
                "full payout exceeds the recorded CAD funding",
            );
        }
        if (lane.vault.cad_cents < remaining) {
            return fail("InsufficientEscrow", "CAD vault cannot cover the payout");
        }
        lane.vault.cad_cents -= remaining;
        account.paid_cad_cents += remaining;
        account.status = "SETTLED";
        return { ok: true, signature: this.nextSignature() };
    }

    async releaseLeg2Partial(args: ReleaseLeg2PartialArgs): Promise<TxResult> {
        if (args.amount_cents <= 0n) {
            return fail("AmountZero", "amount_cents must be greater than zero");
        }
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.party_b)) {
            return fail("NotParty", "only party B may pay the CAD leg");
        }
        const guard = this.sequentialPayingGuard(lane);
        if (guard !== null) {
            return guard;
        }
        const overflow = this.cadAccountingGuard(account);
        if (overflow !== null) {
            return overflow;
        }
        const remaining = account.leg2_cad_cents - account.paid_cad_cents;
        const available = account.funded_cad_cents - account.paid_cad_cents;
        if (args.amount_cents > remaining) {
            return fail("InsufficientEscrow", "amount exceeds the remaining leg 2");
        }
        if (args.amount_cents > available) {
            return fail(
                "InsufficientEscrow",
                "amount exceeds the recorded CAD funding",
            );
        }
        if (lane.vault.cad_cents < args.amount_cents) {
            return fail("InsufficientEscrow", "CAD vault cannot cover the payout");
        }
        lane.vault.cad_cents -= args.amount_cents;
        account.paid_cad_cents += args.amount_cents;
        if (account.paid_cad_cents === account.leg2_cad_cents) {
            account.status = "SETTLED";
        }
        return { ok: true, signature: this.nextSignature() };
    }

    async declareDefault(args: DeclareDefaultArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may declare default");
        }
        if (account.path !== "SEQUENTIAL") {
            return fail("WrongPath", "declare_default requires the sequential path");
        }
        if (account.status !== "PAYING") {
            return fail(
                "BadState",
                `declare_default not allowed in status ${account.status}`,
            );
        }
        if (account.leg1_released_at_ms === 0n) {
            return fail("BadState", "leg 1 has not been released");
        }
        if (account.paid_cad_cents >= account.leg2_cad_cents) {
            return fail("BadState", "leg 2 is already paid in full");
        }
        const overflow = this.cadAccountingGuard(account);
        if (overflow !== null) {
            return overflow;
        }
        const deadline = account.leg1_released_at_ms + account.gap_ms;
        if (deadline > I64_MAX) {
            return fail("Overflow", "gap deadline outside the i64 range");
        }
        if (account.virtual_now_ms <= deadline) {
            return fail("GapNotExpired", "the gap window has not expired yet");
        }
        const remainder = account.funded_cad_cents - account.paid_cad_cents;
        if (remainder > lane.vault.cad_cents) {
            return fail("InsufficientEscrow", "CAD vault cannot cover the remainder");
        }
        lane.vault.cad_cents -= remainder;
        account.status = "DEFAULTED";
        return { ok: true, signature: this.nextSignature() };
    }

    async settleAtomic(args: SettleAtomicArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may settle atomically");
        }
        if (account.path !== "ATOMIC") {
            return fail("WrongPath", "settle_atomic requires the atomic path");
        }
        if (account.status !== "PAYING") {
            return fail(
                "BadState",
                `settle_atomic not allowed in status ${account.status}`,
            );
        }
        // Both vaults checked before anything moves: a short lane reverts
        // whole, leaving status and counters bit identical (atomicity).
        if (
            lane.vault.usd_cents < account.leg1_usd_cents ||
            lane.vault.cad_cents < account.leg2_cad_cents
        ) {
            return fail("InsufficientEscrow", "vaults cannot cover both legs");
        }
        lane.vault.usd_cents -= account.leg1_usd_cents;
        lane.vault.cad_cents -= account.leg2_cad_cents;
        account.status = "SETTLED";
        return { ok: true, signature: this.nextSignature() };
    }

    async markFailed(args: MarkFailedArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may mark a failure");
        }
        if (account.status !== "PAYING") {
            return fail("BadState", `mark_failed not allowed in status ${account.status}`);
        }
        // The reason is logged on chain, not stored; the mock accepts and
        // drops it the same way.
        void args.reason;
        account.status = "FAILED";
        return { ok: true, signature: this.nextSignature() };
    }

    async advanceClock(args: AdvanceClockArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may advance the clock");
        }
        if (isTerminal(account.status)) {
            return fail(
                "BadState",
                `advance_clock not allowed in terminal status ${account.status}`,
            );
        }
        if (args.to_ms < account.virtual_now_ms) {
            return fail("ClockRegression", "virtual time only moves forward");
        }
        if (args.to_ms > I64_MAX - MAX_GAP_MS) {
            return fail(
                "BadState",
                "clock target must keep a full gap below i64 max",
            );
        }
        account.virtual_now_ms = args.to_ms;
        return { ok: true, signature: this.nextSignature() };
    }

    async anchorChainHead(args: AnchorChainHeadArgs): Promise<TxResult> {
        const lane = this.lane(args.scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(args.scenario) };
        }
        const account = lane.account;
        if (!args.signer.equals(account.driver)) {
            return fail("NotParty", "only the driver may anchor the chain head");
        }
        if (!isTerminal(account.status)) {
            return fail(
                "BadState",
                `anchor_chain_head requires a terminal status, got ${account.status}`,
            );
        }
        if (lane.chain_head !== null) {
            return fail(
                "AccountAlreadyInUse",
                `chain head account already exists: ${args.scenario.toBase58()}`,
            );
        }
        if (args.final_hash.length !== 32) {
            return fail("InvalidInstructionData", "final_hash must be 32 bytes");
        }
        const [, bump] = chainHeadPda(args.scenario);
        lane.chain_head = {
            scenario: args.scenario,
            final_hash: Uint8Array.from(args.final_hash),
            event_count: args.event_count,
            anchored_unix_ts: BigInt(Math.floor(Date.now() / 1000)),
            anchored_virtual_ms: args.anchored_virtual_ms,
            bump,
        };
        return { ok: true, signature: this.nextSignature() };
    }

    async fetchScenario(scenario: PublicKey): Promise<FetchResult<ScenarioAccount>> {
        const lane = this.lane(scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(scenario) };
        }
        return { ok: true, value: copyScenario(lane.account) };
    }

    /**
     * Extension (beyond ProgramClient): read the anchored ChainHead, the
     * offline counterpart of AnchorClient.fetchChainHead.
     */
    async fetchChainHead(scenario: PublicKey): Promise<FetchResult<ChainHeadAccount>> {
        const lane = this.lane(scenario);
        if (lane === null) {
            return { ok: false, error: this.scenarioMissing(scenario) };
        }
        if (lane.chain_head === null) {
            return {
                ok: false,
                error: `AccountNotFound: chain head account does not exist: ${scenario.toBase58()}`,
            };
        }
        const head = lane.chain_head;
        return {
            ok: true,
            value: { ...head, final_hash: Uint8Array.from(head.final_hash) },
        };
    }

    /**
     * Extension (beyond ProgramClient): read the live escrow balances of a
     * lane, for balance assertions in tests and offline fixtures.
     */
    getVaultBalances(scenario: PublicKey): MockVaultBalances | null {
        const lane = this.lane(scenario);
        return lane === null ? null : { ...lane.vault };
    }

    /** Number of lanes initialized on this client instance. */
    get laneCount(): number {
        return this.lanes.size;
    }

    /** Shared guard for both leg 2 payment paths. */
    private sequentialPayingGuard(lane: MockLane): TxResult | null {
        const account = lane.account;
        if (account.path !== "SEQUENTIAL") {
            return fail("WrongPath", "leg 2 payment requires the sequential path");
        }
        if (account.status !== "PAYING") {
            return fail("BadState", `leg 2 payment not allowed in status ${account.status}`);
        }
        if (account.leg1_released_at_ms === 0n) {
            return fail("BadState", "leg 1 has not been released");
        }
        return null;
    }

    private lane(scenario: PublicKey): MockLane | null {
        return this.lanes.get(scenario.toBase58()) ?? null;
    }

    private scenarioMissing(scenario: PublicKey): string {
        return `AccountNotFound: scenario account does not exist: ${scenario.toBase58()}`;
    }

    /**
     * paid may never exceed the recorded funding: the payout caps keep it
     * invariant, and the on-chain handlers back the same claim with a
     * checked_sub Overflow.
     */
    private cadAccountingGuard(account: ScenarioAccount): TxResult | null {
        if (account.paid_cad_cents > account.funded_cad_cents) {
            return fail("Overflow", "paid exceeds the recorded CAD funding");
        }
        return null;
    }

    private nextSignature(): string {
        this.txCounter += 1;
        return `mock_sig_${String(this.txCounter).padStart(8, "0")}`;
    }
}
