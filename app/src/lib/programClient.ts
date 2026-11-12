/**
 * Typed interface for the Settlement Race on-chain client.
 *
 * Phase 3 provides the concrete implementation against the Anchor IDL; this
 * module only fixes the contract so the UI and engine can be written against
 * stable types. Every mutating method resolves to a TxResult carrying either
 * the transaction signature or an error string, so callers never have to
 * catch exceptions for ordinary failure paths.
 */

import type { PublicKey } from "@solana/web3.js";
import type { LifecycleState, SettlementPathName } from "./ticket";

/** Result of a transaction submitting instruction. */
export type TxResult =
    | { ok: true; signature: string }
    | { ok: false; error: string };

/** Result of an account fetch. */
export type FetchResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

/** Which leg an instruction refers to (maps to the on-chain Leg enum). */
export type LegName = "LEG1_USD" | "LEG2_CAD";

/** Decoded Scenario account as read from chain. */
export interface ScenarioAccount {
    driver: PublicKey;
    party_a: PublicKey;
    party_b: PublicKey;
    /** 32 byte SHA-256 of the canonical ticket JSON (minus ticket_hash). */
    ticket_hash: Uint8Array;
    status: LifecycleState;
    path: SettlementPathName;
    leg1_usd_cents: bigint;
    leg2_cad_cents: bigint;
    funded_usd_cents: bigint;
    funded_cad_cents: bigint;
    paid_cad_cents: bigint;
    ack_a: boolean;
    ack_b: boolean;
    virtual_now_ms: bigint;
    race_started_at_ms: bigint;
    leg1_released_at_ms: bigint;
    gap_ms: bigint;
    scenario_id: bigint;
    bump: number;
}

export interface InitScenarioArgs {
    driver: PublicKey;
    party_a: PublicKey;
    party_b: PublicKey;
    scenario_id: bigint;
    /** 32 byte ticket hash. */
    ticket_hash: Uint8Array;
    path: SettlementPathName;
    leg1_usd_cents: bigint;
    leg2_cad_cents: bigint;
    gap_ms: bigint;
}

export interface AckArgs {
    scenario: PublicKey;
    signer: PublicKey;
}

export interface FundLegArgs {
    scenario: PublicKey;
    signer: PublicKey;
    leg: LegName;
    amount_cents: bigint;
}

export interface StartRaceArgs {
    scenario: PublicKey;
    signer: PublicKey;
}

export interface ReleaseLegArgs {
    scenario: PublicKey;
    signer: PublicKey;
}

export interface ReleaseLeg2PartialArgs {
    scenario: PublicKey;
    signer: PublicKey;
    amount_cents: bigint;
}

export interface DeclareDefaultArgs {
    scenario: PublicKey;
    signer: PublicKey;
}

export interface SettleAtomicArgs {
    scenario: PublicKey;
    signer: PublicKey;
}

export interface MarkFailedArgs {
    scenario: PublicKey;
    signer: PublicKey;
    reason?: string;
}

export interface AdvanceClockArgs {
    scenario: PublicKey;
    signer: PublicKey;
    to_ms: bigint;
}

export interface AnchorChainHeadArgs {
    scenario: PublicKey;
    signer: PublicKey;
    /** 32 byte provenance chain head to anchor. */
    final_hash: Uint8Array;
    event_count: bigint;
    anchored_virtual_ms: bigint;
}

/** Contract every Settlement Race client implementation must satisfy. */
export interface ProgramClient {
    initScenario(args: InitScenarioArgs): Promise<TxResult>;
    ack(args: AckArgs): Promise<TxResult>;
    fundLeg(args: FundLegArgs): Promise<TxResult>;
    startRace(args: StartRaceArgs): Promise<TxResult>;
    releaseLeg1(args: ReleaseLegArgs): Promise<TxResult>;
    releaseLeg2(args: ReleaseLegArgs): Promise<TxResult>;
    releaseLeg2Partial(args: ReleaseLeg2PartialArgs): Promise<TxResult>;
    declareDefault(args: DeclareDefaultArgs): Promise<TxResult>;
    settleAtomic(args: SettleAtomicArgs): Promise<TxResult>;
    markFailed(args: MarkFailedArgs): Promise<TxResult>;
    advanceClock(args: AdvanceClockArgs): Promise<TxResult>;
    anchorChainHead(args: AnchorChainHeadArgs): Promise<TxResult>;
    fetchScenario(scenario: PublicKey): Promise<FetchResult<ScenarioAccount>>;
}
