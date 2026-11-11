//! `advance_clock`: the demo control that moves virtual race time forward.
//!
//! Virtual time is monotonic and stops at terminal statuses, so a finished
//! scenario can never reopen its clock. Only the driver may sign, so a
//! counterparty cannot collapse the risk window, and the target stays a
//! full gap window below `i64::MAX` so `declare_default`'s deadline
//! arithmetic can never overflow.

use anchor_lang::prelude::*;

use crate::errors::SettlementError;
use crate::state::Scenario;

use super::{require_driver, MAX_GAP_MS};

#[derive(Accounts)]
pub struct AdvanceClock<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<AdvanceClock>, to_virtual_ms: i64) -> Result<()> {
    let scenario = &mut ctx.accounts.scenario;
    require_driver(scenario, &ctx.accounts.signer.key())?;
    require!(!scenario.status.is_terminal(), SettlementError::BadState);
    require!(
        to_virtual_ms >= scenario.virtual_now_ms,
        SettlementError::ClockRegression
    );
    // Leave a full gap window below i64::MAX. leg1_released_at_ms is
    // stamped from virtual time, so with this bound
    // leg1_released_at_ms + gap_ms can never overflow at declare_default.
    require!(
        to_virtual_ms <= i64::MAX - MAX_GAP_MS,
        SettlementError::BadState
    );
    scenario.virtual_now_ms = to_virtual_ms;
    Ok(())
}
