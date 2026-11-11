//! `anchor_chain_head`: once the scenario reaches a terminal status, the
//! driver anchors the off-chain provenance chain head on chain in the
//! `ChainHead` PDA.

use anchor_lang::prelude::*;

use crate::errors::SettlementError;
use crate::state::{ChainHead, Scenario};

#[derive(Accounts)]
pub struct AnchorChainHead<'info> {
    pub scenario: Account<'info, Scenario>,
    #[account(mut)]
    pub driver: Signer<'info>,
    #[account(
        init,
        payer = driver,
        space = ChainHead::SPACE,
        seeds = [b"chain_head", scenario.key().as_ref()],
        bump
    )]
    pub chain_head: Account<'info, ChainHead>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AnchorChainHead>,
    final_hash: [u8; 32],
    event_count: u64,
    anchored_virtual_ms: i64,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.driver.key(),
        ctx.accounts.scenario.driver,
        SettlementError::NotParty
    );
    require!(
        ctx.accounts.scenario.status.is_terminal(),
        SettlementError::BadState
    );
    let anchored_unix_ts = Clock::get()?.unix_timestamp;
    let chain_head = &mut ctx.accounts.chain_head;
    chain_head.scenario = ctx.accounts.scenario.key();
    chain_head.final_hash = final_hash;
    chain_head.event_count = event_count;
    chain_head.anchored_unix_ts = anchored_unix_ts;
    chain_head.anchored_virtual_ms = anchored_virtual_ms;
    chain_head.bump = ctx.bumps.chain_head;
    Ok(())
}
