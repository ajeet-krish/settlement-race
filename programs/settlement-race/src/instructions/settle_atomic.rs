//! `settle_atomic`: delivery versus payment in one instruction.
//!
//! Both vaults must cover their leg exactly before any transfer runs, then
//! both CPIs execute inside this single instruction. Any failure aborts the
//! whole transaction, so a short vault leaves no state change behind.
//! Only the driver may sign: settlement is an engine action.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario, SettlementPath};

use super::{require_driver, require_party_ata};

#[derive(Accounts)]
pub struct SettleAtomic<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"vault_usd", scenario.key().as_ref()], bump)]
    pub vault_usd: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault_cad", scenario.key().as_ref()], bump)]
    pub vault_cad: Account<'info, TokenAccount>,
    /// Party B's USD ATA, the leg 1 destination.
    #[account(mut)]
    pub party_b_ata: Account<'info, TokenAccount>,
    /// Party A's CAD ATA, the leg 2 destination.
    #[account(mut)]
    pub party_a_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleAtomic>) -> Result<()> {
    let scenario = &ctx.accounts.scenario;
    require_driver(scenario, &ctx.accounts.signer.key())?;
    require!(
        scenario.path == SettlementPath::Atomic,
        SettlementError::WrongPath
    );
    require!(
        scenario.status == RaceStatus::Paying,
        SettlementError::BadState
    );
    // Escrow may not overfund (fund_leg rejects that), so covering the
    // notional means both vaults hold exactly what is needed.
    require!(
        ctx.accounts.vault_usd.amount >= scenario.leg1_usd_cents
            && ctx.accounts.vault_cad.amount >= scenario.leg2_cad_cents,
        SettlementError::InsufficientEscrow
    );
    require_party_ata(
        &ctx.accounts.party_b_ata,
        &scenario.party_b,
        ctx.accounts.vault_usd.mint,
    )?;
    require_party_ata(
        &ctx.accounts.party_a_ata,
        &scenario.party_a,
        ctx.accounts.vault_cad.mint,
    )?;

    let scenario_key = scenario.key();
    let usd_bump = ctx.bumps.vault_usd;
    let cad_bump = ctx.bumps.vault_cad;
    let usd_seeds: &[&[u8]] = &[b"vault_usd", scenario_key.as_ref(), &[usd_bump]];
    let cad_seeds: &[&[u8]] = &[b"vault_cad", scenario_key.as_ref(), &[cad_bump]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.vault_usd.to_account_info(),
                to: ctx.accounts.party_b_ata.to_account_info(),
                authority: ctx.accounts.vault_usd.to_account_info(),
            },
            &[usd_seeds],
        ),
        scenario.leg1_usd_cents,
    )?;
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.vault_cad.to_account_info(),
                to: ctx.accounts.party_a_ata.to_account_info(),
                authority: ctx.accounts.vault_cad.to_account_info(),
            },
            &[cad_seeds],
        ),
        scenario.leg2_cad_cents,
    )?;

    let scenario = &mut ctx.accounts.scenario;
    scenario.status = RaceStatus::Settled;
    Ok(())
}
