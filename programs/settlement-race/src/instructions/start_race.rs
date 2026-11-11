//! `start_race`: opens the race once both parties acknowledged and the
//! escrow shows commitment on both sides. Only the driver (the engine)
//! signs, so neither counterparty can force the settlement sequence.

use anchor_lang::prelude::*;

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario, SettlementPath};

use super::require_driver;

#[derive(Accounts)]
pub struct StartRace<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<StartRace>, path: SettlementPath) -> Result<()> {
    let scenario = &mut ctx.accounts.scenario;
    require_driver(scenario, &ctx.accounts.signer.key())?;
    require!(
        scenario.status == RaceStatus::Ack,
        SettlementError::BadState
    );
    // The USD leg must be fully funded and party B must have staked some
    // CAD. Complete CAD funding is deliberately not required: an underfunded
    // CAD vault is the counterparty risk the scenarios race, and
    // settle_atomic re-checks both vaults exactly at settlement time.
    require!(
        scenario.funded_usd_cents == scenario.leg1_usd_cents && scenario.funded_cad_cents > 0,
        SettlementError::NotFullyFunded
    );
    // Virtual time must be positive before the stamp: starting at time 0
    // would write race_started_at_ms = 0, which reads as "not started".
    require!(scenario.virtual_now_ms > 0, SettlementError::BadState);
    // The path comes from the ticket through the engine. Binding the path
    // to ticket_hash stays client-side via provenance; mis-routing only
    // harms the caller's own scenario, so it is an accepted risk
    // (docs/architecture.md).
    scenario.path = path;
    scenario.status = RaceStatus::Paying;
    scenario.race_started_at_ms = scenario.virtual_now_ms;
    Ok(())
}
