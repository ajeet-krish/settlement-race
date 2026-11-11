//! `release_leg2` and `release_leg2_partial`: party B's sequential payment
//! of the CAD leg to party A.
//!
//! The full release settles the scenario, the partial release records
//! `paid_cad_cents` and settles only when the remainder reaches zero.
//! Every payout is capped at `funded_cad_cents - paid_cad_cents`, so a
//! third-party donation into the vault can never push `paid_cad_cents`
//! above the recorded funding (which would brick `declare_default`).

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario, SettlementPath};

use super::require_party_ata;

/// CAD cents still owed on leg 2, checked against the frozen invariant
/// that `paid_cad_cents` never exceeds `leg2_cad_cents`.
fn remaining_cad(scenario: &Scenario) -> Result<u64> {
    scenario
        .leg2_cad_cents
        .checked_sub(scenario.paid_cad_cents)
        .ok_or(SettlementError::Overflow.into())
}

/// CAD cents the recorded funding still allows to be paid out.
///
/// The live vault balance is not a bound here: anyone can donate tokens
/// into the vault PDA, so payouts are capped at funded minus paid and a
/// donation can never over-pay the recorded funding.
fn available_cad(scenario: &Scenario) -> Result<u64> {
    scenario
        .funded_cad_cents
        .checked_sub(scenario.paid_cad_cents)
        .ok_or(SettlementError::Overflow.into())
}

#[derive(Accounts)]
pub struct ReleaseLeg2<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"vault_cad", scenario.key().as_ref()], bump)]
    pub vault_cad: Account<'info, TokenAccount>,
    /// Party A's CAD ATA, the leg 2 destination.
    #[account(mut)]
    pub party_a_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ReleaseLeg2Partial<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"vault_cad", scenario.key().as_ref()], bump)]
    pub vault_cad: Account<'info, TokenAccount>,
    /// Party A's CAD ATA, the leg 2 destination.
    #[account(mut)]
    pub party_a_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

fn require_sequential_paying_leg1_released(scenario: &Scenario) -> Result<()> {
    require!(
        scenario.path == SettlementPath::Sequential,
        SettlementError::WrongPath
    );
    require!(
        scenario.status == RaceStatus::Paying,
        SettlementError::BadState
    );
    require!(scenario.leg1_released_at_ms != 0, SettlementError::BadState);
    Ok(())
}

pub fn handler(ctx: Context<ReleaseLeg2>) -> Result<()> {
    let scenario = &ctx.accounts.scenario;
    require_keys_eq!(
        ctx.accounts.signer.key(),
        scenario.party_b,
        SettlementError::NotParty
    );
    require_sequential_paying_leg1_released(scenario)?;
    let remaining = remaining_cad(scenario)?;
    // Zero remaining means leg 2 already paid in full, which would have
    // settled the scenario, so Paying with nothing left is BadState.
    require!(remaining > 0, SettlementError::BadState);
    // Escrow accounting cap: a full payout may never exceed funded minus
    // paid, so a donation into the vault cannot over-pay recorded funding.
    // Net effect: full release requires the lane to be fully funded, which
    // is exactly the honest and late payment flows; underfunded lanes must
    // use the partial release.
    let available = available_cad(scenario)?;
    require!(remaining <= available, SettlementError::InsufficientEscrow);
    require!(
        ctx.accounts.vault_cad.amount >= remaining,
        SettlementError::InsufficientEscrow
    );
    require_party_ata(
        &ctx.accounts.party_a_ata,
        &scenario.party_a,
        ctx.accounts.vault_cad.mint,
    )?;

    let scenario_key = scenario.key();
    let bump = ctx.bumps.vault_cad;
    let vault_seeds: &[&[u8]] = &[b"vault_cad", scenario_key.as_ref(), &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.vault_cad.to_account_info(),
                to: ctx.accounts.party_a_ata.to_account_info(),
                authority: ctx.accounts.vault_cad.to_account_info(),
            },
            &[vault_seeds],
        ),
        remaining,
    )?;

    let scenario = &mut ctx.accounts.scenario;
    scenario.paid_cad_cents = scenario
        .paid_cad_cents
        .checked_add(remaining)
        .ok_or(SettlementError::Overflow)?;
    scenario.status = RaceStatus::Settled;
    Ok(())
}

pub fn handler_partial(ctx: Context<ReleaseLeg2Partial>, amount_cents: u64) -> Result<()> {
    require!(amount_cents > 0, SettlementError::AmountZero);
    let scenario = &ctx.accounts.scenario;
    require_keys_eq!(
        ctx.accounts.signer.key(),
        scenario.party_b,
        SettlementError::NotParty
    );
    require_sequential_paying_leg1_released(scenario)?;
    let remaining = remaining_cad(scenario)?;
    let available = available_cad(scenario)?;
    // A partial payment may not exceed what is still owed, what the
    // recorded funding still allows, or what the vault actually holds;
    // all three shortages are InsufficientEscrow. The funded cap stops a
    // vault donation from pushing paid_cad_cents above funded_cad_cents.
    require!(
        amount_cents <= remaining,
        SettlementError::InsufficientEscrow
    );
    require!(
        amount_cents <= available,
        SettlementError::InsufficientEscrow
    );
    require!(
        ctx.accounts.vault_cad.amount >= amount_cents,
        SettlementError::InsufficientEscrow
    );
    require_party_ata(
        &ctx.accounts.party_a_ata,
        &scenario.party_a,
        ctx.accounts.vault_cad.mint,
    )?;

    let scenario_key = scenario.key();
    let bump = ctx.bumps.vault_cad;
    let vault_seeds: &[&[u8]] = &[b"vault_cad", scenario_key.as_ref(), &[bump]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.vault_cad.to_account_info(),
                to: ctx.accounts.party_a_ata.to_account_info(),
                authority: ctx.accounts.vault_cad.to_account_info(),
            },
            &[vault_seeds],
        ),
        amount_cents,
    )?;

    let scenario = &mut ctx.accounts.scenario;
    scenario.paid_cad_cents = scenario
        .paid_cad_cents
        .checked_add(amount_cents)
        .ok_or(SettlementError::Overflow)?;
    // Partial payment settles the scenario only when the leg is complete;
    // otherwise the race stays in Paying so a default can still follow.
    if scenario.paid_cad_cents == scenario.leg2_cad_cents {
        scenario.status = RaceStatus::Settled;
    }
    Ok(())
}
