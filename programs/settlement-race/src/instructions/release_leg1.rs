//! `release_leg1`: sequential pay-first release of the USD leg to party B.
//!
//! This opens the Herstatt style risk window by stamping
//! `leg1_released_at_ms` with the current virtual time. Only the driver
//! signs: releasing leg 1 is an engine action, not a payer choice.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario, SettlementPath};

use super::{require_driver, require_party_ata};

#[derive(Accounts)]
pub struct ReleaseLeg1<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"vault_usd", scenario.key().as_ref()], bump)]
    pub vault_usd: Account<'info, TokenAccount>,
    /// Party B's USD ATA, the leg 1 destination.
    #[account(mut)]
    pub party_b_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReleaseLeg1>) -> Result<()> {
    let scenario = &ctx.accounts.scenario;
    require_driver(scenario, &ctx.accounts.signer.key())?;
    require!(
        scenario.path == SettlementPath::Sequential,
        SettlementError::WrongPath
    );
    require!(
        scenario.status == RaceStatus::Paying,
        SettlementError::BadState
    );
    // The zero sentinel means "not released yet"; a second release is a
    // BadState violation of the one way transition.
    require!(scenario.leg1_released_at_ms == 0, SettlementError::BadState);
    // Virtual time must be positive before the stamp: a release at time 0
    // would write leg1_released_at_ms = 0, which reads as "not released"
    // and would disarm the double release guard above.
    require!(scenario.virtual_now_ms > 0, SettlementError::BadState);
    require!(
        ctx.accounts.vault_usd.amount >= scenario.leg1_usd_cents,
        SettlementError::InsufficientEscrow
    );
    require_party_ata(
        &ctx.accounts.party_b_ata,
        &scenario.party_b,
        ctx.accounts.vault_usd.mint,
    )?;

    let scenario_key = scenario.key();
    let bump = ctx.bumps.vault_usd;
    let vault_seeds: &[&[u8]] = &[b"vault_usd", scenario_key.as_ref(), &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.vault_usd.to_account_info(),
                to: ctx.accounts.party_b_ata.to_account_info(),
                authority: ctx.accounts.vault_usd.to_account_info(),
            },
            &[vault_seeds],
        ),
        scenario.leg1_usd_cents,
    )?;

    let scenario = &mut ctx.accounts.scenario;
    scenario.leg1_released_at_ms = scenario.virtual_now_ms;
    Ok(())
}
