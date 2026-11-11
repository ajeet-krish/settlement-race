use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::{
    Acknowledge, AdvanceClock, AnchorChainHead, DeclareDefault, FundLeg, InitializeScenario,
    MarkFailed, ReleaseLeg1, ReleaseLeg2, ReleaseLeg2Partial, SettleAtomic, StartRace,
};
use state::{Leg, SettlementPath};

// The `#[program]` macro re-exports the generated client account modules
// from the crate root, so the per module Accounts derives must be
// re-exported here.
pub use instructions::acknowledge::__client_accounts_acknowledge;
pub use instructions::advance_clock::__client_accounts_advance_clock;
pub use instructions::anchor_chain_head::__client_accounts_anchor_chain_head;
pub use instructions::declare_default::__client_accounts_declare_default;
pub use instructions::fund_leg::__client_accounts_fund_leg;
pub use instructions::initialize_scenario::__client_accounts_initialize_scenario;
pub use instructions::mark_failed::__client_accounts_mark_failed;
pub use instructions::release_leg1::__client_accounts_release_leg1;
pub use instructions::release_leg2::{
    __client_accounts_release_leg2, __client_accounts_release_leg2_partial,
};
pub use instructions::settle_atomic::__client_accounts_settle_atomic;
pub use instructions::start_race::__client_accounts_start_race;

declare_id!("4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3");

#[program]
pub mod settlement_race {
    use super::*;

    /// Creates the Scenario PDA and both escrow vaults for one race lane.
    /// The counterparties arrive as remaining accounts, in order
    /// `[party_a, party_b]`.
    pub fn initialize_scenario(
        ctx: Context<InitializeScenario>,
        scenario_id: u64,
        ticket_hash: [u8; 32],
        leg1_cents: u64,
        leg2_cents: u64,
        gap_ms: i64,
    ) -> Result<()> {
        instructions::initialize_scenario::handler(
            ctx,
            scenario_id,
            ticket_hash,
            leg1_cents,
            leg2_cents,
            gap_ms,
        )
    }

    /// A party acknowledges the ticket; both acknowledgements reach `Ack`.
    pub fn acknowledge(ctx: Context<Acknowledge>) -> Result<()> {
        instructions::acknowledge::handler(ctx)
    }

    /// A party escrows funds for its leg while the status is `Ack`.
    pub fn fund_leg(ctx: Context<FundLeg>, leg: Leg, amount_cents: u64) -> Result<()> {
        instructions::fund_leg::handler(ctx, leg, amount_cents)
    }

    /// Opens the race: sets the route, moves to `Paying`, and stamps the
    /// race start with the current virtual time. Driver only.
    pub fn start_race(ctx: Context<StartRace>, path: SettlementPath) -> Result<()> {
        instructions::start_race::handler(ctx, path)
    }

    /// Monotonic demo control that moves the virtual clock forward.
    /// Driver only, and capped a full gap window below `i64::MAX`.
    pub fn advance_clock(ctx: Context<AdvanceClock>, to_virtual_ms: i64) -> Result<()> {
        instructions::advance_clock::handler(ctx, to_virtual_ms)
    }

    /// Sequential pay-first release of the USD leg to party B. Driver only.
    pub fn release_leg1(ctx: Context<ReleaseLeg1>) -> Result<()> {
        instructions::release_leg1::handler(ctx)
    }

    /// Full sequential release of the CAD leg, settles the scenario.
    /// Capped at funded minus paid; party B signs.
    pub fn release_leg2(ctx: Context<ReleaseLeg2>) -> Result<()> {
        instructions::release_leg2::handler(ctx)
    }

    /// Partial sequential release of the CAD leg, records paid progress.
    /// Capped at funded minus paid as well as the remaining notional.
    pub fn release_leg2_partial(ctx: Context<ReleaseLeg2Partial>, amount_cents: u64) -> Result<()> {
        instructions::release_leg2::handler_partial(ctx, amount_cents)
    }

    /// Declares default after the gap expires with leg 2 unpaid and
    /// reclaims the CAD escrow remainder for party B. Driver only.
    pub fn declare_default(ctx: Context<DeclareDefault>) -> Result<()> {
        instructions::declare_default::handler(ctx)
    }

    /// Atomic delivery versus payment: both legs in one instruction.
    /// Driver only.
    pub fn settle_atomic(ctx: Context<SettleAtomic>) -> Result<()> {
        instructions::settle_atomic::handler(ctx)
    }

    /// Marks `Paying` as `Failed`, used after a reverted atomic attempt.
    pub fn mark_failed(ctx: Context<MarkFailed>, reason: String) -> Result<()> {
        instructions::mark_failed::handler(ctx, reason)
    }

    /// Anchors the provenance chain head once the scenario is terminal.
    pub fn anchor_chain_head(
        ctx: Context<AnchorChainHead>,
        final_hash: [u8; 32],
        event_count: u64,
        anchored_virtual_ms: i64,
    ) -> Result<()> {
        instructions::anchor_chain_head::handler(ctx, final_hash, event_count, anchored_virtual_ms)
    }
}
