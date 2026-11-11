use anchor_lang::prelude::*;

pub mod errors;
pub mod state;

use state::Scenario;

declare_id!("4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3");

#[program]
pub mod settlement_race {
    use super::*;

    /// Placeholder initialization instruction. Phase 2 replaces this with the
    /// full instruction set (init_scenario, ack, fund_leg, start_race, ...).
    pub fn init_scenario(_ctx: Context<InitScenario>, _scenario_id: u64) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(scenario_id: u64)]
pub struct InitScenario<'info> {
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
    pub system_program: Program<'info, System>,
}
