//! State schema for Settlement Race.
//!
//! This module defines the on-chain account shapes and small status helpers.
//! Behavior lives in the instruction handlers under `instructions/`. All
//! monetary values are integer cents (u64), never floats, per the project
//! convention.

use anchor_lang::prelude::*;

/// Lifecycle of a settlement scenario on chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RaceStatus {
    /// Scenario created, no acknowledgements yet.
    New,
    /// Both parties acknowledged the ticket.
    Ack,
    /// Race running, legs are being funded or paid.
    Paying,
    /// Sequential path completed: both legs released.
    Settled,
    /// A party failed to perform inside the gap window.
    Defaulted,
    /// Terminal failure marked by the driver or engine.
    Failed,
}

impl RaceStatus {
    /// Terminal statuses (Settled, Defaulted, Failed) never reopen.
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RaceStatus::Settled | RaceStatus::Defaulted | RaceStatus::Failed
        )
    }
}

/// Which settlement route the scenario follows.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettlementPath {
    /// Pay-first: leg 1 releases, then a gap, then leg 2.
    Sequential,
    /// Both legs release in one atomic transaction (delivery-versus-payment).
    Atomic,
}

/// Which leg of the FX trade is being referenced.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Leg {
    /// USD leg (leg 1).
    Leg1Usd,
    /// CAD leg (leg 2).
    Leg2Cad,
}

/// A single settlement race scenario account.
///
/// PDA seeds: `["scenario", driver, scenario_id_le_u64]`.
#[account]
#[derive(Debug)]
pub struct Scenario {
    /// Driver (engine) wallet that created and controls the scenario.
    pub driver: Pubkey,
    /// Party A wallet (USD payer on the sequential path).
    pub party_a: Pubkey,
    /// Party B wallet (CAD payer on the sequential path).
    pub party_b: Pubkey,
    /// SHA-256 of the canonical trade ticket JSON (excluding ticket_hash).
    pub ticket_hash: [u8; 32],
    /// Current lifecycle status.
    pub status: RaceStatus,
    /// Settlement route for this scenario.
    pub path: SettlementPath,
    /// Notional of leg 1 in USD cents.
    pub leg1_usd_cents: u64,
    /// Notional of leg 2 in CAD cents.
    pub leg2_cad_cents: u64,
    /// USD cents funded into escrow so far.
    pub funded_usd_cents: u64,
    /// CAD cents funded into escrow so far.
    pub funded_cad_cents: u64,
    /// CAD cents released to party A so far (sequential leg 2 progress).
    pub paid_cad_cents: u64,
    /// Whether party A has acknowledged the ticket.
    pub ack_a: bool,
    /// Whether party B has acknowledged the ticket.
    pub ack_b: bool,
    /// Virtual clock time in milliseconds.
    pub virtual_now_ms: i64,
    /// Virtual time the race started, 0 if not started.
    pub race_started_at_ms: i64,
    /// Virtual time leg 1 released, 0 if not released.
    pub leg1_released_at_ms: i64,
    /// Gap window in milliseconds between leg 1 and leg 2.
    pub gap_ms: i64,
    /// Scenario identifier (matches the PDA seed).
    pub scenario_id: u64,
    /// PDA bump.
    pub bump: u8,
}

impl Scenario {
    /// Account space: 8 byte discriminator plus fixed-size fields.
    /// 4 pubkeys (32 each), 2 enums (1 each), 5 u64 amounts, 4 i64 times,
    /// 1 u64 id, 2 bools, 1 u8 bump.
    pub const SPACE: usize = 8 + (32 * 4) + (1 * 2) + (8 * 5) + (8 * 4) + 8 + (1 * 2) + 1;
}

/// On-chain anchor of the off-chain provenance hash chain.
///
/// PDA seeds: `["chain_head", scenario]`.
#[account]
#[derive(Debug)]
pub struct ChainHead {
    /// The scenario this chain belongs to.
    pub scenario: Pubkey,
    /// Head hash of the provenance chain (64 zeros before the first event).
    pub final_hash: [u8; 32],
    /// Number of events anchored so far.
    pub event_count: u64,
    /// Real unix timestamp when the chain head was last anchored.
    pub anchored_unix_ts: i64,
    /// Virtual clock time when the chain head was last anchored.
    pub anchored_virtual_ms: i64,
    /// PDA bump.
    pub bump: u8,
}

impl ChainHead {
    /// Account space: 8 byte discriminator plus 2 pubkeys/hashes (32 each),
    /// 2 u64/i64 pairs (8 each), 1 i64, and 1 u8 bump.
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 8 + 8 + 1;
}
