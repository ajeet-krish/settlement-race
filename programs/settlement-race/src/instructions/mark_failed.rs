//! `mark_failed`: the driver records an unrecoverable condition (typically
//! a reverted atomic settlement attempt) as a follow up transaction, since
//! a reverted transaction cannot persist any state of its own. Only the
//! driver may sign it, so neither counterparty can force a terminal
//! failure on its own.

use anchor_lang::prelude::*;

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario};

#[derive(Accounts)]
pub struct MarkFailed<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<MarkFailed>, reason: String) -> Result<()> {
    let scenario = &mut ctx.accounts.scenario;
    require_keys_eq!(
        ctx.accounts.signer.key(),
        scenario.driver,
        SettlementError::NotParty
    );
    require!(
        scenario.status == RaceStatus::Paying,
        SettlementError::BadState
    );
    // The reason is logged for explorers only. The Scenario layout stays
    // frozen, and the engine keeps the full detail in provenance records.
    msg!("mark_failed: {}", reason);
    scenario.status = RaceStatus::Failed;
    Ok(())
}
