//! Custom errors for the Settlement Race program.
//!
//! Errors are declared instead of panics, per Anchor conventions.

use anchor_lang::prelude::*;

#[error_code]
pub enum SettlementError {
    /// Escrow balance is too low for the requested release or transfer.
    #[msg("Insufficient escrow balance for this operation")]
    InsufficientEscrow,
    /// Signer is not party A or party B as required by the instruction.
    #[msg("Signer is not an authorized party for this scenario")]
    NotParty,
    /// Instruction is not valid for the current lifecycle status.
    #[msg("Instruction not allowed in the current state")]
    BadState,
    /// The gap window between leg 1 and leg 2 has not expired yet.
    #[msg("The gap window has not expired")]
    GapNotExpired,
    /// Virtual clock attempted to move backwards.
    #[msg("Clock regression detected, virtual time must be monotonic")]
    ClockRegression,
    /// Not both legs are fully funded for an atomic settlement.
    #[msg("Scenario is not fully funded")]
    NotFullyFunded,
    /// Operation does not match the scenario's settlement path.
    #[msg("Operation does not match the settlement path")]
    WrongPath,
    /// A required amount was zero.
    #[msg("Amount must be greater than zero")]
    AmountZero,
    /// Integer overflow detected in an amount computation.
    #[msg("Arithmetic overflow")]
    Overflow,
}
