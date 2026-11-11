//! `initialize_scenario`: the driver signs, the Scenario PDA and both escrow
//! vaults are created, and the two counterparties are stored from the
//! remaining accounts in order `[party_a, party_b]`.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario, SettlementPath};

use super::MAX_GAP_MS;

#[derive(Accounts)]
#[instruction(scenario_id: u64)]
pub struct InitializeScenario<'info> {
    #[account(
        init,
        payer = driver,
        space = Scenario::SPACE,
        seeds = [b"scenario", driver.key().as_ref(), &scenario_id.to_le_bytes()],
        bump
    )]
    pub scenario: Account<'info, Scenario>,
    #[account(mut)]
    pub driver: Signer<'info>,
    pub usd_mint: Account<'info, Mint>,
    pub cad_mint: Account<'info, Mint>,
    /// USD escrow vault, an SPL token account that is its own authority.
    #[account(
        init,
        payer = driver,
        token::mint = usd_mint,
        token::authority = vault_usd,
        seeds = [b"vault_usd", scenario.key().as_ref()],
        bump
    )]
    pub vault_usd: Account<'info, TokenAccount>,
    /// CAD escrow vault, an SPL token account that is its own authority.
    #[account(
        init,
        payer = driver,
        token::mint = cad_mint,
        token::authority = vault_cad,
        seeds = [b"vault_cad", scenario.key().as_ref()],
        bump
    )]
    pub vault_cad: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeScenario>,
    scenario_id: u64,
    ticket_hash: [u8; 32],
    leg1_cents: u64,
    leg2_cents: u64,
    gap_ms: i64,
) -> Result<()> {
    require!(leg1_cents > 0, SettlementError::AmountZero);
    require!(leg2_cents > 0, SettlementError::AmountZero);
    require!(
        gap_ms > 0 && gap_ms <= MAX_GAP_MS,
        SettlementError::BadState
    );
    require_keys_neq!(
        ctx.accounts.usd_mint.key(),
        ctx.accounts.cad_mint.key(),
        SettlementError::BadState
    );

    let parties = ctx.remaining_accounts;
    require!(parties.len() == 2, SettlementError::BadState);
    let party_a = *parties[0].key;
    let party_b = *parties[1].key;
    require!(party_a != Pubkey::default(), SettlementError::NotParty);
    require!(party_b != Pubkey::default(), SettlementError::NotParty);
    require_keys_neq!(party_a, party_b, SettlementError::NotParty);

    let scenario = &mut ctx.accounts.scenario;
    scenario.driver = ctx.accounts.driver.key();
    scenario.party_a = party_a;
    scenario.party_b = party_b;
    scenario.ticket_hash = ticket_hash;
    scenario.status = RaceStatus::New;
    // Placeholder route until start_race records the real one. No path
    // guarded instruction can run before the status reaches Paying.
    scenario.path = SettlementPath::Sequential;
    scenario.leg1_usd_cents = leg1_cents;
    scenario.leg2_cad_cents = leg2_cents;
    scenario.funded_usd_cents = 0;
    scenario.funded_cad_cents = 0;
    scenario.paid_cad_cents = 0;
    scenario.ack_a = false;
    scenario.ack_b = false;
    scenario.virtual_now_ms = 0;
    scenario.race_started_at_ms = 0;
    scenario.leg1_released_at_ms = 0;
    scenario.gap_ms = gap_ms;
    scenario.scenario_id = scenario_id;
    scenario.bump = ctx.bumps.scenario;
    Ok(())
}
