//! `acknowledge`: one counterparty acknowledges the ticket at a time.
//!
//! The first acknowledgement keeps status `New`, the second one promotes the
//! scenario to `Ack`, matching the transition table in
//! docs/tradeops-schema.md section 2.1.

use anchor_lang::prelude::*;

use crate::errors::SettlementError;
use crate::state::{RaceStatus, Scenario};

#[derive(Accounts)]
pub struct Acknowledge<'info> {
    #[account(mut)]
    pub scenario: Account<'info, Scenario>,
    pub signer: Signer<'info>,
}

pub fn handler(ctx: Context<Acknowledge>) -> Result<()> {
    let scenario = &mut ctx.accounts.scenario;
    require!(
        scenario.status == RaceStatus::New,
        SettlementError::BadState
    );
    let signer = ctx.accounts.signer.key();
    if signer == scenario.party_a {
        require!(!scenario.ack_a, SettlementError::BadState);
        scenario.ack_a = true;
    } else if signer == scenario.party_b {
        require!(!scenario.ack_b, SettlementError::BadState);
        scenario.ack_b = true;
    } else {
        return Err(error!(SettlementError::NotParty));
    }
    if scenario.ack_a && scenario.ack_b {
        scenario.status = RaceStatus::Ack;
    }
    Ok(())
}
