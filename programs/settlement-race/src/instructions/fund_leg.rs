//! `fund_leg`: a party escrows funds for its leg while status is `Ack`.
//!
//! Party A funds `Leg1Usd` and party B funds `Leg2Cad`, each from the
//! party's own ATA into the leg's vault. Deposits are cumulative and capped
//! at the leg notional, and every sum uses checked arithmetic.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount};

use crate::errors::SettlementError;
use crate::state::{Leg, RaceStatus, Scenario};

use super::require_party_ata;

#[derive(Accounts)]
pub struct FundLeg<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
    /// The funding party's ATA for the leg's mint.
    #[account(mut)]
    pub party_ata: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault_usd", scenario.key().as_ref()], bump)]
    pub vault_usd: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault_cad", scenario.key().as_ref()], bump)]
    pub vault_cad: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<FundLeg>, leg: Leg, amount_cents: u64) -> Result<()> {
    require!(amount_cents > 0, SettlementError::AmountZero);
    let scenario = &ctx.accounts.scenario;
    require!(
        scenario.status == RaceStatus::Ack,
        SettlementError::BadState
    );

    let (vault, required_party, funded, notional) = match leg {
        Leg::Leg1Usd => (
            &ctx.accounts.vault_usd,
            scenario.party_a,
            scenario.funded_usd_cents,
            scenario.leg1_usd_cents,
        ),
        Leg::Leg2Cad => (
            &ctx.accounts.vault_cad,
            scenario.party_b,
            scenario.funded_cad_cents,
            scenario.leg2_cad_cents,
        ),
    };
    require_keys_eq!(
        ctx.accounts.signer.key(),
        required_party,
        SettlementError::NotParty
    );
    require_party_ata(&ctx.accounts.party_ata, &required_party, vault.mint)?;

    // Checked add first (Overflow), then the escrow cap: the vault may not
    // hold more than the leg notional (InsufficientEscrow).
    let new_funded = funded
        .checked_add(amount_cents)
        .ok_or(SettlementError::Overflow)?;
    require!(new_funded <= notional, SettlementError::InsufficientEscrow);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            token::Transfer {
                from: ctx.accounts.party_ata.to_account_info(),
                to: vault.to_account_info(),
                authority: ctx.accounts.signer.to_account_info(),
            },
        ),
        amount_cents,
    )?;

    let scenario = &mut ctx.accounts.scenario;
    match leg {
        Leg::Leg1Usd => scenario.funded_usd_cents = new_funded,
        Leg::Leg2Cad => scenario.funded_cad_cents = new_funded,
    }
    Ok(())
}
