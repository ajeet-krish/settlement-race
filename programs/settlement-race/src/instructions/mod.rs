//! Instruction handlers for the Settlement Race program.
//!
//! One module per instruction (twelve handlers across eleven modules:
//! `release_leg2` groups the full and partial leg 2 releases). Every guard
//! maps to one of the frozen `SettlementError` variants instead of panicking.

pub mod acknowledge;
pub mod advance_clock;
pub mod anchor_chain_head;
pub mod declare_default;
pub mod fund_leg;
pub mod initialize_scenario;
pub mod mark_failed;
pub mod release_leg1;
pub mod release_leg2;
pub mod settle_atomic;
pub mod start_race;

pub use acknowledge::Acknowledge;
pub use advance_clock::AdvanceClock;
pub use anchor_chain_head::AnchorChainHead;
pub use declare_default::DeclareDefault;
pub use fund_leg::FundLeg;
pub use initialize_scenario::InitializeScenario;
pub use mark_failed::MarkFailed;
pub use release_leg1::ReleaseLeg1;
pub use release_leg2::{ReleaseLeg2, ReleaseLeg2Partial};
pub use settle_atomic::SettleAtomic;
pub use start_race::StartRace;

use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::TokenAccount;

use crate::errors::SettlementError;
use crate::state::Scenario;

/// Largest gap window accepted at initialization: 24 hours in milliseconds.
pub const MAX_GAP_MS: i64 = 86_400_000;

/// The signer must be the scenario driver (the engine).
///
/// The driver orchestrates the race: starting it, moving the clock,
/// releasing leg 1, declaring default, and settling atomically are engine
/// actions. Parties only acknowledge, fund, and choose whether to pay
/// leg 2, and that choice is the counterparty risk the demo shows.
pub(crate) fn require_driver(scenario: &Scenario, signer: &Pubkey) -> Result<()> {
    require_keys_eq!(*signer, scenario.driver, SettlementError::NotParty);
    Ok(())
}

/// The token account must be the party's canonical ATA for `mint`.
///
/// This single address check implies the owner and mint are correct, and it
/// rejects token accounts that merely belong to the right wallet.
pub(crate) fn require_party_ata(
    token_account: &Account<TokenAccount>,
    party: &Pubkey,
    mint: Pubkey,
) -> Result<()> {
    let expected = get_associated_token_address(party, &mint);
    require_keys_eq!(token_account.key(), expected, SettlementError::NotParty);
    Ok(())
}
