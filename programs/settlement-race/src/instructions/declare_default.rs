//! `declare_default`: after the gap window expires with leg 2 unpaid, the
//! CAD remainder held in escrow returns to party B and the scenario ends
//! in `Defaulted`. Only the driver may sign, so no counterparty can force
//! the terminal default transition.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario, SettlementPath};

use super::{require_driver, require_party_ata};

#[derive(Accounts)]
pub struct DeclareDefault<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
    #[account(mut, seeds = [b"vault_cad", scenario.key().as_ref()], bump)]
    pub vault_cad: Account<'info, TokenAccount>,
    /// Party B's CAD ATA, the reclamation destination.
    #[account(mut)]
    pub party_b_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<DeclareDefault>) -> Result<()> {
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
    require!(scenario.leg1_released_at_ms != 0, SettlementError::BadState);
    // A fully paid leg settles instead, so Paying with paid == notional is
    // a BadState violation of the one way transition.
    require!(
        scenario.paid_cad_cents < scenario.leg2_cad_cents,
        SettlementError::BadState
    );
    let deadline = scenario
        .leg1_released_at_ms
        .checked_add(scenario.gap_ms)
        .ok_or(SettlementError::Overflow)?;
    require!(
        scenario.virtual_now_ms > deadline,
        SettlementError::GapNotExpired
    );

    // Reclamation: whatever of party B's escrow has not been paid out
    // returns to party B. Paid amounts are untouched. release_leg2 caps
    // every payout at funded minus paid, so this checked_sub cannot
    // overflow even after a direct vault donation.
    let remainder = scenario
        .funded_cad_cents
        .checked_sub(scenario.paid_cad_cents)
        .ok_or(SettlementError::Overflow)?;
    require_party_ata(
        &ctx.accounts.party_b_ata,
        &scenario.party_b,
        ctx.accounts.vault_cad.mint,
    )?;
    if remainder > 0 {
        require!(
            ctx.accounts.vault_cad.amount >= remainder,
            SettlementError::InsufficientEscrow
        );
        let scenario_key = scenario.key();
        let bump = ctx.bumps.vault_cad;
        let vault_seeds: &[&[u8]] = &[b"vault_cad", scenario_key.as_ref(), &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::Transfer {
                    from: ctx.accounts.vault_cad.to_account_info(),
                    to: ctx.accounts.party_b_ata.to_account_info(),
                    authority: ctx.accounts.vault_cad.to_account_info(),
                },
                &[vault_seeds],
            ),
            remainder,
        )?;
    }

    let scenario = &mut ctx.accounts.scenario;
    scenario.status = RaceStatus::Defaulted;
    Ok(())
}
