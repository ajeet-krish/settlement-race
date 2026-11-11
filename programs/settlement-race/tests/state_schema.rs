//! Phase 1 schema tests: frozen account shapes and enum encodings.
//!
//! These pin the on-chain layout and Borsh discriminants documented in
//! docs/tradeops-schema.md section 6 and docs/architecture.md. Instruction
//! behavior and transition guards arrive in Phase 2.

use anchor_lang::prelude::*;
use settlement_race::state::{ChainHead, Leg, RaceStatus, Scenario, SettlementPath};

/// Borsh encoding of a value, exactly as the account serializer writes it
/// (the 8 byte discriminator is added separately by AccountSerialize).
fn encoded<T: AnchorSerialize>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    value
        .serialize(&mut bytes)
        .expect("Borsh serialization must succeed");
    bytes
}

fn scenario_fixture() -> Scenario {
    Scenario {
        driver: Pubkey::default(),
        party_a: Pubkey::default(),
        party_b: Pubkey::default(),
        ticket_hash: [7u8; 32],
        status: RaceStatus::New,
        path: SettlementPath::Sequential,
        leg1_usd_cents: 1_000_000,
        leg2_cad_cents: 1_350_000,
        funded_usd_cents: 0,
        funded_cad_cents: 0,
        paid_cad_cents: 0,
        ack_a: false,
        ack_b: false,
        virtual_now_ms: 0,
        race_started_at_ms: 0,
        leg1_released_at_ms: 0,
        gap_ms: 5_000,
        scenario_id: 1,
        bump: 255,
    }
}

#[test]
fn scenario_space_fits_exact_serialization() {
    let scenario = scenario_fixture();
    let serialized = encoded(&scenario).len();
    // SPACE must be the 8 byte discriminator plus the exact Borsh size, or
    // account initialization over or under allocates.
    assert_eq!(
        serialized + 8,
        Scenario::SPACE,
        "SPACE must be discriminator plus the exact Borsh size"
    );
    // Frozen Phase 1 constant: 8 + 32*4 + 1*2 + 8*5 + 8*4 + 8 + 1*2 + 1.
    assert_eq!(Scenario::SPACE, 221);
}

#[test]
fn scenario_round_trips_through_anchor_deserialize() {
    let scenario = scenario_fixture();
    let bytes = encoded(&scenario);
    let decoded = Scenario::try_from_slice(&bytes).expect("round trip");
    assert_eq!(decoded.scenario_id, scenario.scenario_id);
    assert_eq!(decoded.gap_ms, scenario.gap_ms);
    assert_eq!(decoded.leg1_usd_cents, 1_000_000);
    assert_eq!(decoded.leg2_cad_cents, 1_350_000);
    assert_eq!(decoded.status, RaceStatus::New);
    assert_eq!(decoded.path, SettlementPath::Sequential);
    assert_eq!(decoded.ticket_hash, scenario.ticket_hash);
}

#[test]
fn chain_head_space_fits_exact_serialization() {
    let head = ChainHead {
        scenario: Pubkey::default(),
        final_hash: [0u8; 32],
        event_count: 0,
        anchored_unix_ts: 0,
        anchored_virtual_ms: 0,
        bump: 255,
    };
    let serialized = encoded(&head).len();
    assert_eq!(serialized + 8, ChainHead::SPACE);
    // Frozen Phase 1 constant: 8 + 32 + 32 + 8 + 8 + 8 + 1.
    assert_eq!(ChainHead::SPACE, 97);
}

#[test]
fn race_status_borsh_discriminants_match_schema_order() {
    // tradeops-schema.md section 2: New, Ack, Paying, Settled, Defaulted, Failed.
    assert_eq!(encoded(&RaceStatus::New), vec![0]);
    assert_eq!(encoded(&RaceStatus::Ack), vec![1]);
    assert_eq!(encoded(&RaceStatus::Paying), vec![2]);
    assert_eq!(encoded(&RaceStatus::Settled), vec![3]);
    assert_eq!(encoded(&RaceStatus::Defaulted), vec![4]);
    assert_eq!(encoded(&RaceStatus::Failed), vec![5]);
}

#[test]
fn settlement_path_and_leg_discriminants_match_schema_order() {
    assert_eq!(encoded(&SettlementPath::Sequential), vec![0]);
    assert_eq!(encoded(&SettlementPath::Atomic), vec![1]);
    assert_eq!(encoded(&Leg::Leg1Usd), vec![0]);
    assert_eq!(encoded(&Leg::Leg2Cad), vec![1]);
}
