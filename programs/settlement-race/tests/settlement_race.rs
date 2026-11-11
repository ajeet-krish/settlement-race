//! Phase 2 LiteSVM integration suite for the Settlement Race program.
//!
//! Every test deploys the real SBF artifact (target/deploy/settlement_race.so)
//! into LiteSVM, creates two legacy SPL mints with 2 decimals so one base unit
//! equals one cent, and drives full scenarios through the twelve instructions.
//! Money values are integer cents only, per the project convention.

use anchor_lang::solana_program::clock::Clock;
use anchor_lang::system_program;
use anchor_lang::AccountDeserialize;
use anchor_litesvm::{
    AccountMeta, AnchorContext, AnchorLiteSVM, Instruction, Keypair, LiteSVM, Pubkey, Signer,
    TestHelpers, TransactionResult,
};
use anchor_spl::token::{self, TokenAccount};
use settlement_race::errors::SettlementError;
use settlement_race::state::{ChainHead, Leg, RaceStatus, Scenario, SettlementPath};
use settlement_race::{accounts, instruction, ID as PROGRAM_ID};

// Scenario constants (integer cents, 2 decimal mints so cents == base units)

/// Leg 1 notional in USD cents: 1,000.00.
const LEG1_USD_CENTS: u64 = 100_000;
/// Leg 2 notional in CAD cents: 1,300.00.
const LEG2_CAD_CENTS: u64 = 130_000;
/// Gap window between leg 1 and leg 2, 5 seconds of virtual time.
const GAP_MS: i64 = 5_000;
/// Virtual time set before each race starts, so release stamps are nonzero.
const T_START_MS: i64 = 1_000;
/// Exact gap deadline: leg 1 stamp plus gap.
const DEADLINE_MS: i64 = T_START_MS + GAP_MS;
/// Strictly beyond the deadline (declare_default requires virtual_now > deadline).
const PAST_GAP_MS: i64 = DEADLINE_MS + 1;
/// Party A starts with 10,000.00 USD.
const A_USD_START: u64 = 1_000_000;
/// Party B starts with 10,000.00 CAD.
const B_CAD_START: u64 = 1_000_000;
/// Both mints use 2 decimals, matching the integer-cent convention.
const TOKEN_DECIMALS: u8 = 2;
/// Lamports for every test wallet, plenty for rent and fees.
const WALLET_LAMPORTS: u64 = 100_000_000_000;
/// Fixed ticket hash fixture.
const TICKET_HASH: [u8; 32] = [7u8; 32];

// Program artifact loading and PDA derivations

/// Loads the SBF artifact built by anchor build or cargo test-sbf.
///
/// anchor build targets platform-tools v1.57 with --arch v3 (SBPF V3 ELF),
/// while cargo build-sbf and cargo test-sbf default to platform-tools v1.54
/// with --arch v0. The agave 3.1 loader inside LiteSVM 0.11 only accepts the
/// v0 artifact shape, so the flavor is checked here with actionable guidance.
fn program_so_bytes() -> Vec<u8> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let workspace_path = format!("{manifest_dir}/../../target/deploy/settlement_race.so");
    let local_path = format!("{manifest_dir}/target/deploy/settlement_race.so");
    for path in [&workspace_path, &local_path] {
        if let Ok(bytes) = std::fs::read(path) {
            assert_loadable_sbf(&bytes, path);
            return bytes;
        }
    }
    panic!(
        "settlement_race.so not found; run `anchor build` or `cargo test-sbf` first \
         (searched {workspace_path} and {local_path})"
    );
}

/// Fails fast when the artifact is an SBPF V3 ELF that LiteSVM 0.11 rejects.
fn assert_loadable_sbf(bytes: &[u8], path: &str) {
    if bytes.len() < 64 {
        panic!("{path} is too short to be an ELF file");
    }
    let e_machine = u16::from_le_bytes([bytes[18], bytes[19]]);
    let e_flags = u32::from_le_bytes([bytes[48], bytes[49], bytes[50], bytes[51]]);
    let e_phnum = u16::from_le_bytes([bytes[56], bytes[57]]);
    const EM_SBPF: u16 = 263;
    // SBPF V3 (e_flags 3) uses the strict ELF parser, which requires the
    // EM_SBPF machine id and at least four program headers. The anchor build
    // flavor (arch v3, tools v1.57) fails those checks in LiteSVM 0.11.
    if e_flags >= 3 && (e_machine != EM_SBPF || e_phnum < 4) {
        panic!(
            "{path} is an SBPF V3 artifact this LiteSVM build cannot load \
             (e_flags={e_flags}, e_machine={e_machine}, e_phnum={e_phnum}); it was most \
             likely produced by `anchor build`. Rebuild with `cargo test-sbf` or \
             `cargo build-sbf` before running the integration suite."
        );
    }
}

fn scenario_pda(driver: &Pubkey, scenario_id: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"scenario", driver.as_ref(), &scenario_id.to_le_bytes()],
        &PROGRAM_ID,
    )
    .0
}

fn vault_usd_pda(scenario: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault_usd", scenario.as_ref()], &PROGRAM_ID).0
}

fn vault_cad_pda(scenario: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"vault_cad", scenario.as_ref()], &PROGRAM_ID).0
}

fn chain_head_pda(scenario: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"chain_head", scenario.as_ref()], &PROGRAM_ID).0
}

// Harness

/// One scenario account plus its two escrow vaults.
#[derive(Clone, Copy, Debug)]
struct Lane {
    scenario: Pubkey,
    vault_usd: Pubkey,
    vault_cad: Pubkey,
}

/// LiteSVM context with the driver, both counterparties, mints, and ATAs.
struct Harness {
    ctx: AnchorContext,
    driver: Keypair,
    party_a: Keypair,
    party_b: Keypair,
    usd_mint: Pubkey,
    cad_mint: Pubkey,
    usd_ata_a: Pubkey,
    cad_ata_a: Pubkey,
    usd_ata_b: Pubkey,
    cad_ata_b: Pubkey,
}

/// Reads an SPL token account balance in base units (cents).
fn token_balance(svm: &LiteSVM, address: &Pubkey) -> u64 {
    let account = svm
        .get_account(address)
        .expect("token account must exist on chain");
    let mut data: &[u8] = &account.data;
    let token = TokenAccount::try_deserialize_unchecked(&mut data)
        .expect("account data must be a valid SPL token account");
    token.amount
}

fn setup() -> Harness {
    let mut ctx = AnchorLiteSVM::build_with_program(PROGRAM_ID, &program_so_bytes());
    let driver = ctx
        .svm
        .create_funded_account(WALLET_LAMPORTS)
        .expect("driver airdrop");
    let party_a = ctx
        .svm
        .create_funded_account(WALLET_LAMPORTS)
        .expect("party a airdrop");
    let party_b = ctx
        .svm
        .create_funded_account(WALLET_LAMPORTS)
        .expect("party b airdrop");

    // Two legacy SPL mints, 2 decimals so base units equal cents. The driver
    // holds mint authority for both.
    let usd_mint_kp = ctx
        .svm
        .create_token_mint(&driver, TOKEN_DECIMALS)
        .expect("usd mint creation");
    let cad_mint_kp = ctx
        .svm
        .create_token_mint(&driver, TOKEN_DECIMALS)
        .expect("cad mint creation");
    let usd_mint = usd_mint_kp.pubkey();
    let cad_mint = cad_mint_kp.pubkey();

    // Both parties get an ATA for both mints so every instruction can pass
    // canonical addresses.
    let usd_ata_a = ctx
        .svm
        .create_associated_token_account(&usd_mint, &party_a)
        .expect("party a usd ata");
    let cad_ata_a = ctx
        .svm
        .create_associated_token_account(&cad_mint, &party_a)
        .expect("party a cad ata");
    let usd_ata_b = ctx
        .svm
        .create_associated_token_account(&usd_mint, &party_b)
        .expect("party b usd ata");
    let cad_ata_b = ctx
        .svm
        .create_associated_token_account(&cad_mint, &party_b)
        .expect("party b cad ata");

    // Starting balances: A holds USD to pay leg 1, B holds CAD to pay leg 2.
    // The receiving sides start at zero so payout assertions are exact.
    ctx.svm
        .mint_to(&usd_mint, &usd_ata_a, &driver, A_USD_START)
        .expect("mint usd to party a");
    ctx.svm
        .mint_to(&cad_mint, &cad_ata_b, &driver, B_CAD_START)
        .expect("mint cad to party b");

    Harness {
        ctx,
        driver,
        party_a,
        party_b,
        usd_mint,
        cad_mint,
        usd_ata_a,
        cad_ata_a,
        usd_ata_b,
        cad_ata_b,
    }
}

// Instruction builders

fn send(ctx: &mut AnchorContext, ix: Instruction, signer: &Keypair) -> TransactionResult {
    // LiteSVM reuses one blockhash until it is expired, so an identical
    // message would collide with an earlier signature of the same shape and
    // report AlreadyProcessed instead of reaching the program. Resending the
    // same instruction is exactly what the guard tests assert on, so each
    // transaction expires the blockhash first to earn a fresh signature,
    // which mirrors a real leader advancing blocks between transactions.
    ctx.svm.expire_blockhash();
    ctx.execute_instruction(ix, &[signer])
        .expect("transaction must build and send")
}

fn ix_initialize(
    h: &Harness,
    scenario_id: u64,
    leg1_cents: u64,
    leg2_cents: u64,
    gap_ms: i64,
    party_a: &Pubkey,
    party_b: &Pubkey,
) -> Instruction {
    let scenario = scenario_pda(&h.driver.pubkey(), scenario_id);
    let mut ix = h
        .ctx
        .program()
        .accounts(accounts::InitializeScenario {
            scenario,
            driver: h.driver.pubkey(),
            usd_mint: h.usd_mint,
            cad_mint: h.cad_mint,
            vault_usd: vault_usd_pda(&scenario),
            vault_cad: vault_cad_pda(&scenario),
            token_program: token::ID,
            system_program: system_program::ID,
        })
        .args(instruction::InitializeScenario {
            scenario_id,
            ticket_hash: TICKET_HASH,
            leg1_cents,
            leg2_cents,
            gap_ms,
        })
        .instruction()
        .expect("initialize_scenario instruction must build");
    // The counterparties travel as remaining accounts in order [party_a, party_b].
    ix.accounts.push(AccountMeta::new_readonly(*party_a, false));
    ix.accounts.push(AccountMeta::new_readonly(*party_b, false));
    ix
}

fn ix_ack(h: &Harness, lane: &Lane, signer: &Pubkey) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::Acknowledge {
            scenario: lane.scenario,
            signer: *signer,
        })
        .args(instruction::Acknowledge)
        .instruction()
        .expect("acknowledge instruction must build")
}

fn ix_fund(
    h: &Harness,
    lane: &Lane,
    signer: &Pubkey,
    party_ata: Pubkey,
    leg: Leg,
    amount_cents: u64,
) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::FundLeg {
            scenario: lane.scenario,
            signer: *signer,
            party_ata,
            vault_usd: lane.vault_usd,
            vault_cad: lane.vault_cad,
            token_program: token::ID,
        })
        .args(instruction::FundLeg { leg, amount_cents })
        .instruction()
        .expect("fund_leg instruction must build")
}

fn ix_start(h: &Harness, lane: &Lane, signer: &Pubkey, path: SettlementPath) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::StartRace {
            scenario: lane.scenario,
            signer: *signer,
        })
        .args(instruction::StartRace { path })
        .instruction()
        .expect("start_race instruction must build")
}

fn ix_advance(h: &Harness, lane: &Lane, signer: &Pubkey, to_virtual_ms: i64) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::AdvanceClock {
            scenario: lane.scenario,
            signer: *signer,
        })
        .args(instruction::AdvanceClock { to_virtual_ms })
        .instruction()
        .expect("advance_clock instruction must build")
}

fn ix_release1(h: &Harness, lane: &Lane, signer: &Pubkey) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::ReleaseLeg1 {
            scenario: lane.scenario,
            signer: *signer,
            vault_usd: lane.vault_usd,
            party_b_ata: h.usd_ata_b,
            token_program: token::ID,
        })
        .args(instruction::ReleaseLeg1)
        .instruction()
        .expect("release_leg1 instruction must build")
}

fn ix_release2(h: &Harness, lane: &Lane, signer: &Pubkey) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::ReleaseLeg2 {
            scenario: lane.scenario,
            signer: *signer,
            vault_cad: lane.vault_cad,
            party_a_ata: h.cad_ata_a,
            token_program: token::ID,
        })
        .args(instruction::ReleaseLeg2)
        .instruction()
        .expect("release_leg2 instruction must build")
}

fn ix_release2_partial(
    h: &Harness,
    lane: &Lane,
    signer: &Pubkey,
    amount_cents: u64,
) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::ReleaseLeg2Partial {
            scenario: lane.scenario,
            signer: *signer,
            vault_cad: lane.vault_cad,
            party_a_ata: h.cad_ata_a,
            token_program: token::ID,
        })
        .args(instruction::ReleaseLeg2Partial { amount_cents })
        .instruction()
        .expect("release_leg2_partial instruction must build")
}

fn ix_declare_default(h: &Harness, lane: &Lane, signer: &Pubkey) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::DeclareDefault {
            scenario: lane.scenario,
            signer: *signer,
            vault_cad: lane.vault_cad,
            party_b_ata: h.cad_ata_b,
            token_program: token::ID,
        })
        .args(instruction::DeclareDefault)
        .instruction()
        .expect("declare_default instruction must build")
}

fn ix_settle_atomic(h: &Harness, lane: &Lane, signer: &Pubkey) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::SettleAtomic {
            scenario: lane.scenario,
            signer: *signer,
            vault_usd: lane.vault_usd,
            vault_cad: lane.vault_cad,
            party_b_ata: h.usd_ata_b,
            party_a_ata: h.cad_ata_a,
            token_program: token::ID,
        })
        .args(instruction::SettleAtomic)
        .instruction()
        .expect("settle_atomic instruction must build")
}

fn ix_mark_failed(h: &Harness, lane: &Lane, signer: &Pubkey, reason: &str) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::MarkFailed {
            scenario: lane.scenario,
            signer: *signer,
        })
        .args(instruction::MarkFailed {
            reason: reason.to_string(),
        })
        .instruction()
        .expect("mark_failed instruction must build")
}

fn ix_anchor_chain_head(
    h: &Harness,
    lane: &Lane,
    driver: &Pubkey,
    final_hash: [u8; 32],
    event_count: u64,
    anchored_virtual_ms: i64,
) -> Instruction {
    h.ctx
        .program()
        .accounts(accounts::AnchorChainHead {
            scenario: lane.scenario,
            driver: *driver,
            chain_head: chain_head_pda(&lane.scenario),
            system_program: system_program::ID,
        })
        .args(instruction::AnchorChainHead {
            final_hash,
            event_count,
            anchored_virtual_ms,
        })
        .instruction()
        .expect("anchor_chain_head instruction must build")
}

/// Raw SPL token transfer, used to donate directly into a vault PDA the
/// way any outside wallet could on chain (no program involvement).
fn ix_token_transfer(
    source: &Pubkey,
    destination: &Pubkey,
    owner: &Pubkey,
    amount: u64,
) -> Instruction {
    anchor_spl::token::spl_token::instruction::transfer(
        &token::ID,
        source,
        destination,
        owner,
        &[],
        amount,
    )
    .expect("spl token transfer instruction must build")
}

// Harness helpers (role based signers, happy path flows)

impl Harness {
    /// Derives the full lane address set for a scenario id.
    fn lane(&self, scenario_id: u64) -> Lane {
        let scenario = scenario_pda(&self.driver.pubkey(), scenario_id);
        Lane {
            scenario,
            vault_usd: vault_usd_pda(&scenario),
            vault_cad: vault_cad_pda(&scenario),
        }
    }

    fn initialize(
        &mut self,
        scenario_id: u64,
        leg1_cents: u64,
        leg2_cents: u64,
        gap_ms: i64,
    ) -> Lane {
        let ix = ix_initialize(
            self,
            scenario_id,
            leg1_cents,
            leg2_cents,
            gap_ms,
            &self.party_a.pubkey(),
            &self.party_b.pubkey(),
        );
        send(&mut self.ctx, ix, &self.driver).assert_success();
        self.lane(scenario_id)
    }

    fn acknowledge_both(&mut self, lane: &Lane) {
        let ix = ix_ack(self, lane, &self.party_a.pubkey());
        send(&mut self.ctx, ix, &self.party_a).assert_success();
        let ix = ix_ack(self, lane, &self.party_b.pubkey());
        send(&mut self.ctx, ix, &self.party_b).assert_success();
    }

    fn fund_usd(&mut self, lane: &Lane, amount_cents: u64) {
        let signer = self.party_a.pubkey();
        let ix = ix_fund(
            self,
            lane,
            &signer,
            self.usd_ata_a,
            Leg::Leg1Usd,
            amount_cents,
        );
        send(&mut self.ctx, ix, &self.party_a).assert_success();
    }

    fn fund_cad(&mut self, lane: &Lane, amount_cents: u64) {
        let signer = self.party_b.pubkey();
        let ix = ix_fund(
            self,
            lane,
            &signer,
            self.cad_ata_b,
            Leg::Leg2Cad,
            amount_cents,
        );
        send(&mut self.ctx, ix, &self.party_b).assert_success();
    }

    fn advance(&mut self, lane: &Lane, to_virtual_ms: i64) {
        let signer = self.driver.pubkey();
        let ix = ix_advance(self, lane, &signer, to_virtual_ms);
        send(&mut self.ctx, ix, &self.driver).assert_success();
    }

    fn start(&mut self, lane: &Lane, path: SettlementPath) {
        let signer = self.driver.pubkey();
        let ix = ix_start(self, lane, &signer, path);
        send(&mut self.ctx, ix, &self.driver).assert_success();
    }

    fn release_leg1(&mut self, lane: &Lane) {
        let signer = self.driver.pubkey();
        let ix = ix_release1(self, lane, &signer);
        send(&mut self.ctx, ix, &self.driver).assert_success();
    }

    fn release_leg2(&mut self, lane: &Lane) {
        let signer = self.party_b.pubkey();
        let ix = ix_release2(self, lane, &signer);
        send(&mut self.ctx, ix, &self.party_b).assert_success();
    }

    fn release_leg2_partial(&mut self, lane: &Lane, amount_cents: u64) {
        let signer = self.party_b.pubkey();
        let ix = ix_release2_partial(self, lane, &signer, amount_cents);
        send(&mut self.ctx, ix, &self.party_b).assert_success();
    }

    fn declare_default(&mut self, lane: &Lane) {
        let signer = self.driver.pubkey();
        let ix = ix_declare_default(self, lane, &signer);
        send(&mut self.ctx, ix, &self.driver).assert_success();
    }

    fn settle_atomic(&mut self, lane: &Lane) {
        let signer = self.driver.pubkey();
        let ix = ix_settle_atomic(self, lane, &signer);
        send(&mut self.ctx, ix, &self.driver).assert_success();
    }

    fn mark_failed(&mut self, lane: &Lane, reason: &str) {
        let signer = self.driver.pubkey();
        let ix = ix_mark_failed(self, lane, &signer, reason);
        send(&mut self.ctx, ix, &self.driver).assert_success();
    }

    /// Full happy path setup: init, advance the clock once to a positive
    /// virtual time (the engine contract is that time is positive before
    /// start_race, because the zero sentinel means "not started" and "not
    /// released"), then double acknowledge, fund both legs, and start the
    /// race on the given path. Funding happens after both acknowledges,
    /// matching the on chain Ack gate.
    fn open_lane(
        &mut self,
        scenario_id: u64,
        path: SettlementPath,
        usd_cents: u64,
        cad_cents: u64,
    ) -> Lane {
        let lane = self.initialize(scenario_id, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
        self.advance(&lane, T_START_MS);
        self.acknowledge_both(&lane);
        self.fund_usd(&lane, usd_cents);
        self.fund_cad(&lane, cad_cents);
        self.start(&lane, path);
        lane
    }

    fn scenario(&self, lane: &Lane) -> Scenario {
        self.ctx
            .get_account::<Scenario>(&lane.scenario)
            .expect("scenario account must deserialize")
    }

    fn token(&self, address: &Pubkey) -> u64 {
        token_balance(&self.ctx.svm, address)
    }
}

// Assertions, snapshots, and invariants

/// Asserts a transaction failed with a specific SettlementError variant by
/// matching the Anchor log line and the raw program error as fallbacks.
fn expect_settlement_error(result: &TransactionResult, expected: SettlementError) {
    let code = u32::from(expected);
    let name = expected.name();
    assert!(
        result.error().is_some(),
        "expected {} ({}) but the transaction succeeded",
        name,
        code
    );
    let in_logs = result.logs().iter().any(|line| {
        line.contains(&format!("Error Number: {}", code))
            || line.contains(&format!("Error Code: {}", name))
    });
    let in_error = result
        .error()
        .map(|err| {
            err.contains(&format!("custom program error: 0x{:x}", code))
                || err.contains(&format!("Custom({})", code))
        })
        .unwrap_or(false);
    assert!(
        in_logs || in_error,
        "expected {} ({}), error: {:?}, logs:\n{}",
        name,
        code,
        result.error(),
        result.logs().join("\n")
    );
}

/// Full observable state for atomicity comparisons: party balances, vault
/// balances, and every scenario field a failed instruction could mutate.
#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    a_usd: u64,
    a_cad: u64,
    b_usd: u64,
    b_cad: u64,
    vault_usd: u64,
    vault_cad: u64,
    status: RaceStatus,
    funded_usd_cents: u64,
    funded_cad_cents: u64,
    paid_cad_cents: u64,
    leg1_released_at_ms: i64,
    virtual_now_ms: i64,
}

fn snapshot(h: &Harness, lane: &Lane) -> Snapshot {
    let scenario = h.scenario(lane);
    Snapshot {
        a_usd: h.token(&h.usd_ata_a),
        a_cad: h.token(&h.cad_ata_a),
        b_usd: h.token(&h.usd_ata_b),
        b_cad: h.token(&h.cad_ata_b),
        vault_usd: h.token(&lane.vault_usd),
        vault_cad: h.token(&lane.vault_cad),
        status: scenario.status,
        funded_usd_cents: scenario.funded_usd_cents,
        funded_cad_cents: scenario.funded_cad_cents,
        paid_cad_cents: scenario.paid_cad_cents,
        leg1_released_at_ms: scenario.leg1_released_at_ms,
        virtual_now_ms: scenario.virtual_now_ms,
    }
}

/// Sequential SETTLED implies the full leg 2 was paid and both vaults drained.
fn assert_sequential_settled(h: &Harness, lane: &Lane) {
    let scenario = h.scenario(lane);
    assert_eq!(scenario.status, RaceStatus::Settled);
    assert_eq!(
        scenario.paid_cad_cents, scenario.leg2_cad_cents,
        "sequential SETTLED requires paid_cad_cents == leg2_cad_cents"
    );
    assert_eq!(scenario.leg1_released_at_ms, T_START_MS);
    assert_eq!(h.token(&lane.vault_usd), 0, "USD vault must be empty");
    assert_eq!(h.token(&lane.vault_cad), 0, "CAD vault must be empty");
}

/// Atomic SETTLED is reachable only via a successful settle_atomic, so the
/// sequential progress fields stay untouched.
fn assert_atomic_settled(h: &Harness, lane: &Lane) {
    let scenario = h.scenario(lane);
    assert_eq!(scenario.status, RaceStatus::Settled);
    assert_eq!(
        scenario.paid_cad_cents, 0,
        "atomic settlement never touches sequential paid progress"
    );
    assert_eq!(
        scenario.leg1_released_at_ms, 0,
        "atomic settlement has no leg 1 release stamp"
    );
    assert_eq!(h.token(&lane.vault_usd), 0, "USD vault must be empty");
    assert_eq!(h.token(&lane.vault_cad), 0, "CAD vault must be empty");
}

/// Funding share in basis points, integer exact for the chosen notionals.
fn bps(amount_cents: u64, share_bps: u64) -> u64 {
    amount_cents * share_bps / 10_000
}

// Five scenarios, end to end

#[test]
fn honest_sequential_settles_both_legs_exactly() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );

    assert_eq!(h.token(&lane.vault_usd), LEG1_USD_CENTS);
    assert_eq!(h.token(&lane.vault_cad), LEG2_CAD_CENTS);

    h.release_leg1(&lane);
    assert_eq!(
        h.token(&h.usd_ata_b),
        LEG1_USD_CENTS,
        "B must receive exactly leg 1 USD"
    );
    assert_eq!(h.token(&lane.vault_usd), 0, "USD vault must drain");
    assert_eq!(h.token(&h.usd_ata_a), A_USD_START - LEG1_USD_CENTS);

    h.advance(&lane, PAST_GAP_MS);
    h.release_leg2(&lane);

    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Settled);
    assert_eq!(scenario.paid_cad_cents, LEG2_CAD_CENTS);
    assert_eq!(
        h.token(&h.cad_ata_a),
        LEG2_CAD_CENTS,
        "A must receive exactly leg 2 CAD"
    );
    assert_eq!(h.token(&lane.vault_cad), 0, "CAD vault must drain");
    assert_eq!(h.token(&h.cad_ata_b), B_CAD_START - LEG2_CAD_CENTS);
    assert_eq!(h.token(&h.usd_ata_b), LEG1_USD_CENTS);
    assert_sequential_settled(&h, &lane);
}

#[test]
fn honest_atomic_settles_both_legs_in_one_tx() {
    let mut h = setup();
    let lane = h.open_lane(1, SettlementPath::Atomic, LEG1_USD_CENTS, LEG2_CAD_CENTS);

    // Before settlement nothing has moved outside escrow.
    assert_eq!(h.token(&lane.vault_usd), LEG1_USD_CENTS);
    assert_eq!(h.token(&lane.vault_cad), LEG2_CAD_CENTS);
    assert_eq!(h.token(&h.usd_ata_b), 0);
    assert_eq!(h.token(&h.cad_ata_a), 0);

    // A single settle_atomic transaction moves both legs.
    h.settle_atomic(&lane);

    assert_eq!(h.token(&h.usd_ata_b), LEG1_USD_CENTS);
    assert_eq!(h.token(&h.cad_ata_a), LEG2_CAD_CENTS);
    assert_eq!(h.token(&lane.vault_usd), 0);
    assert_eq!(h.token(&lane.vault_cad), 0);
    assert_eq!(h.token(&h.usd_ata_a), A_USD_START - LEG1_USD_CENTS);
    assert_eq!(h.token(&h.cad_ata_b), B_CAD_START - LEG2_CAD_CENTS);
    assert_atomic_settled(&h, &lane);
}

#[test]
fn default_after_leg1_sequential_vs_atomic_contrast() {
    let mut h = setup();
    let seq = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    let atomic = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, LEG2_CAD_CENTS);

    // Party B takes the leg 1 USD and stops paying.
    h.release_leg1(&seq);
    h.advance(&seq, PAST_GAP_MS);
    h.declare_default(&seq);

    let scenario = h.scenario(&seq);
    assert_eq!(scenario.status, RaceStatus::Defaulted);
    assert_eq!(scenario.paid_cad_cents, 0, "B paid nothing after leg 1");
    assert_eq!(
        h.token(&h.usd_ata_b),
        LEG1_USD_CENTS,
        "B keeps the leg 1 USD it received"
    );
    assert_eq!(
        h.token(&h.usd_ata_a),
        A_USD_START - 2 * LEG1_USD_CENTS,
        "A is short the USD it paid out on the sequential lane"
    );
    assert_eq!(
        h.token(&h.cad_ata_b),
        B_CAD_START - LEG2_CAD_CENTS,
        "B reclaimed the full sequential CAD remainder (the atomic lane is still escrowed)"
    );
    assert_eq!(h.token(&seq.vault_cad), 0, "sequential CAD vault drained");
    assert_eq!(h.token(&seq.vault_usd), 0, "sequential USD vault drained");
    assert_eq!(h.token(&h.cad_ata_a), 0);

    // Contrast: the identically funded atomic lane settles cleanly. The
    // settle moves escrow to A only, B's wallets keep the net result of
    // funding two lanes and reclaiming the sequential remainder.
    h.settle_atomic(&atomic);
    assert_eq!(h.token(&h.usd_ata_b), 2 * LEG1_USD_CENTS);
    assert_eq!(h.token(&h.cad_ata_a), LEG2_CAD_CENTS);
    assert_eq!(h.token(&h.cad_ata_b), B_CAD_START - LEG2_CAD_CENTS);
    assert_atomic_settled(&h, &atomic);
    assert_eq!(
        h.scenario(&seq).status,
        RaceStatus::Defaulted,
        "terminal statuses never reopen"
    );
}

#[test]
fn late_payment_still_settles_then_default_is_blocked() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );

    h.release_leg1(&lane);
    h.advance(&lane, PAST_GAP_MS);

    // Late payment: the gap expired but no default was declared, so the
    // payment is still accepted and settles the race.
    h.release_leg2(&lane);

    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Settled);
    assert_eq!(scenario.paid_cad_cents, LEG2_CAD_CENTS);
    assert_eq!(h.token(&h.cad_ata_a), LEG2_CAD_CENTS);
    assert_eq!(h.token(&lane.vault_cad), 0);
    assert_sequential_settled(&h, &lane);

    // Terminal statuses never reopen: default after settlement is BadState.
    let ix = ix_declare_default(&h, &lane, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);
    assert_eq!(h.scenario(&lane).status, RaceStatus::Settled);
}

#[test]
fn atomic_revert_at_9000_bps_reverts_then_mark_failed() {
    let mut h = setup();
    let cad_90 = bps(LEG2_CAD_CENTS, 9_000);
    assert_eq!(cad_90, 117_000, "9000 bps must be integer exact");

    let seq = h.open_lane(1, SettlementPath::Sequential, LEG1_USD_CENTS, cad_90);
    let atomic = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, cad_90);

    // Sequential: leg 1 in full, then 90 percent of leg 2, then default.
    h.release_leg1(&seq);
    h.release_leg2_partial(&seq, cad_90);
    let mid = h.scenario(&seq);
    assert_eq!(mid.paid_cad_cents, cad_90);
    assert_eq!(
        mid.status,
        RaceStatus::Paying,
        "partial payment below the notional must not settle"
    );
    h.advance(&seq, PAST_GAP_MS);
    h.declare_default(&seq);

    let scenario = h.scenario(&seq);
    assert_eq!(scenario.status, RaceStatus::Defaulted);
    assert_eq!(
        scenario.paid_cad_cents, cad_90,
        "paid_cad_cents must equal 90 percent of leg 2"
    );
    assert_eq!(h.token(&h.cad_ata_a), cad_90, "A keeps the partial CAD");
    assert_eq!(
        h.token(&seq.vault_cad),
        0,
        "B reclaimed the unpaid remainder"
    );
    assert_eq!(h.token(&h.usd_ata_b), LEG1_USD_CENTS, "B keeps leg 1 USD");

    // Atomic: the short CAD vault must revert and leave no state behind.
    let before = snapshot(&h, &atomic);
    let ix = ix_settle_atomic(&h, &atomic, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    let after = snapshot(&h, &atomic);
    assert_eq!(
        before, after,
        "a failed atomic settlement must leave balances and status bit identical"
    );
    assert_eq!(after.status, RaceStatus::Paying);

    h.mark_failed(&atomic, "cad vault short at settlement");
    assert_eq!(h.scenario(&atomic).status, RaceStatus::Failed);
}

#[test]
fn partial_payment_at_6000_bps_settles_partial_then_default() {
    let mut h = setup();
    let cad_60 = bps(LEG2_CAD_CENTS, 6_000);
    assert_eq!(cad_60, 78_000, "6000 bps must be integer exact");

    let seq = h.open_lane(1, SettlementPath::Sequential, LEG1_USD_CENTS, cad_60);
    let atomic = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, cad_60);

    h.release_leg1(&seq);
    h.release_leg2_partial(&seq, cad_60);
    h.advance(&seq, PAST_GAP_MS);
    h.declare_default(&seq);

    let scenario = h.scenario(&seq);
    assert_eq!(scenario.status, RaceStatus::Defaulted);
    assert_eq!(
        scenario.paid_cad_cents, cad_60,
        "paid_cad_cents must equal 60 percent of leg 2"
    );
    assert_eq!(h.token(&h.cad_ata_a), cad_60, "A keeps the partial CAD");
    assert_eq!(
        h.token(&seq.vault_cad),
        0,
        "the 6000 bps remainder was fully paid, reclaim is zero"
    );
    assert_eq!(
        h.token(&h.cad_ata_b),
        B_CAD_START - 2 * cad_60,
        "B is out its two lane escrows minus the sequential reclaim"
    );
    assert_eq!(h.token(&h.usd_ata_b), LEG1_USD_CENTS);

    // Atomic cannot settle on a partial vault and moves nothing.
    let before = snapshot(&h, &atomic);
    let ix = ix_settle_atomic(&h, &atomic, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    assert_eq!(
        before,
        snapshot(&h, &atomic),
        "the failed atomic attempt must move nothing"
    );
    assert_eq!(h.scenario(&atomic).status, RaceStatus::Paying);
}

// Guard tests

#[test]
fn guard_cross_lane_instructions_fail_with_wrong_path() {
    let mut h = setup();
    let seq = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    let atomic = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, LEG2_CAD_CENTS);
    let atomic_before = snapshot(&h, &atomic);
    let seq_before = snapshot(&h, &seq);

    // settle_atomic on a sequential lane.
    let ix = ix_settle_atomic(&h, &seq, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::WrongPath);

    // release_leg1 on an atomic lane.
    let ix = ix_release1(&h, &atomic, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::WrongPath);

    // declare_default on an atomic lane.
    let ix = ix_declare_default(&h, &atomic, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::WrongPath);

    // Neither lane moved.
    assert_eq!(atomic_before, snapshot(&h, &atomic));
    assert_eq!(seq_before, snapshot(&h, &seq));
    assert_eq!(h.scenario(&seq).status, RaceStatus::Paying);
    assert_eq!(h.scenario(&atomic).status, RaceStatus::Paying);
}

#[test]
fn guard_gap_boundary_and_double_release() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    h.release_leg1(&lane);

    // Exactly at the deadline the default is still premature: the guard
    // requires virtual_now strictly greater than leg1 stamp plus gap.
    h.advance(&lane, DEADLINE_MS);
    let ix = ix_declare_default(&h, &lane, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::GapNotExpired);

    // A second release of leg 1 is a one way transition violation.
    let ix = ix_release1(&h, &lane, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);

    assert_eq!(h.scenario(&lane).status, RaceStatus::Paying);
    assert_eq!(
        h.token(&h.usd_ata_b),
        LEG1_USD_CENTS,
        "the rejected second release must not move more USD"
    );
    assert_eq!(h.token(&lane.vault_usd), 0);
}

#[test]
fn guard_start_race_requires_acks_and_exact_usd() {
    let mut h = setup();

    // Scenario 1: acknowledge and funding gates in sequence.
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);

    // start_race before any acknowledgement: BadState (status New).
    let signer = h.driver.pubkey();
    let ix = ix_start(&h, &lane, &signer, SettlementPath::Sequential);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);

    // One acknowledgement is not enough: still BadState.
    let ix = ix_ack(&h, &lane, &h.party_a.pubkey());
    send(&mut h.ctx, ix, &h.party_a).assert_success();
    assert_eq!(h.scenario(&lane).status, RaceStatus::New);
    let ix = ix_start(&h, &lane, &signer, SettlementPath::Sequential);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);

    // Both acks reach Ack, then full USD with zero CAD: NotFullyFunded.
    let ix = ix_ack(&h, &lane, &h.party_b.pubkey());
    send(&mut h.ctx, ix, &h.party_b).assert_success();
    assert_eq!(h.scenario(&lane).status, RaceStatus::Ack);
    h.fund_usd(&lane, LEG1_USD_CENTS);
    let ix = ix_start(&h, &lane, &signer, SettlementPath::Sequential);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::NotFullyFunded);

    // A single cent of CAD satisfies the confirmed rule: USD exact, CAD
    // nonzero. Full CAD is deliberately not required at race start.
    h.fund_cad(&lane, 1);
    h.advance(&lane, T_START_MS);
    h.start(&lane, SettlementPath::Sequential);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Paying);
    assert_eq!(scenario.path, SettlementPath::Sequential);
    assert_eq!(scenario.race_started_at_ms, T_START_MS);
    assert_eq!(scenario.funded_usd_cents, LEG1_USD_CENTS);
    assert_eq!(scenario.funded_cad_cents, 1);

    // Scenario 2: inexact USD is rejected even with full CAD escrow.
    let lane2 = h.initialize(2, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    h.acknowledge_both(&lane2);
    h.fund_usd(&lane2, LEG1_USD_CENTS - 1);
    h.fund_cad(&lane2, LEG2_CAD_CENTS);
    let ix = ix_start(&h, &lane2, &signer, SettlementPath::Atomic);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::NotFullyFunded);
    assert_eq!(h.scenario(&lane2).status, RaceStatus::Ack);
}

#[test]
fn guard_zero_virtual_time_rejects_start_and_leg1_release() {
    let mut h = setup();
    // A scenario that never advanced the clock sits at virtual time 0,
    // where the zero sentinel reads as "not started" and "not released".
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    h.acknowledge_both(&lane);
    h.fund_usd(&lane, LEG1_USD_CENTS);
    h.fund_cad(&lane, 1);

    // start_race at virtual time 0 is rejected instead of stamping
    // race_started_at_ms = 0 (without the guard this succeeded and left
    // the "not started" sentinel in place).
    let signer = h.driver.pubkey();
    let ix = ix_start(&h, &lane, &signer, SettlementPath::Sequential);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Ack);
    assert_eq!(scenario.race_started_at_ms, 0);

    // release_leg1 at virtual time 0 is rejected BadState too. After the
    // start guard, a Paying lane at time 0 is unreachable, so the guard is
    // defense in depth; this pins the observable contract at time 0.
    let ix = ix_release1(&h, &lane, &signer);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);
    assert_eq!(h.scenario(&lane).status, RaceStatus::Ack);
    assert_eq!(h.token(&h.usd_ata_b), 0, "no USD may move at time 0");

    // After advancing, both instructions succeed with positive stamps.
    h.advance(&lane, T_START_MS);
    h.start(&lane, SettlementPath::Sequential);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Paying);
    assert_eq!(scenario.race_started_at_ms, T_START_MS);
    h.release_leg1(&lane);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.leg1_released_at_ms, T_START_MS);
    assert_eq!(h.token(&h.usd_ata_b), LEG1_USD_CENTS);
}

#[test]
fn guard_mark_failed_is_driver_only() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );

    // Neither counterparty can force a terminal FAILED on a running race.
    let ix = ix_mark_failed(&h, &lane, &h.party_a.pubkey(), "party a grief");
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::NotParty);
    let ix = ix_mark_failed(&h, &lane, &h.party_b.pubkey(), "party b grief");
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::NotParty);
    assert_eq!(h.scenario(&lane).status, RaceStatus::Paying);

    // The driver still marks failures in Paying.
    h.mark_failed(&lane, "driver marks the failure");
    assert_eq!(h.scenario(&lane).status, RaceStatus::Failed);
}

#[test]
fn guard_clock_parties_and_zero_amounts() {
    let mut h = setup();
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    let outsider = h
        .ctx
        .svm
        .create_funded_account(WALLET_LAMPORTS)
        .expect("outsider airdrop");

    // Acknowledgement by a non party: NotParty.
    let ix = ix_ack(&h, &lane, &outsider.pubkey());
    let result = send(&mut h.ctx, ix, &outsider);
    expect_settlement_error(&result, SettlementError::NotParty);

    // Virtual clock must be monotonic: forward works, backward is rejected.
    h.advance(&lane, T_START_MS);
    let signer = h.driver.pubkey();
    let ix = ix_advance(&h, &lane, &signer, T_START_MS - 1);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::ClockRegression);
    assert_eq!(h.scenario(&lane).virtual_now_ms, T_START_MS);

    // Funding guards need the Ack status.
    h.acknowledge_both(&lane);

    // Party B cannot fund the USD leg: NotParty.
    let signer_b = h.party_b.pubkey();
    let ix = ix_fund(
        &h,
        &lane,
        &signer_b,
        h.usd_ata_b,
        Leg::Leg1Usd,
        LEG1_USD_CENTS,
    );
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::NotParty);

    // Zero amount funding: AmountZero.
    let signer_a = h.party_a.pubkey();
    let ix = ix_fund(&h, &lane, &signer_a, h.usd_ata_a, Leg::Leg1Usd, 0);
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::AmountZero);

    let scenario = h.scenario(&lane);
    assert_eq!(
        scenario.funded_usd_cents, 0,
        "failed funding must not record"
    );
    assert_eq!(scenario.funded_cad_cents, 0);
}

#[test]
fn guard_terminal_state_never_reopens() {
    let mut h = setup();
    let seq = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    let atomic = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, LEG2_CAD_CENTS);

    h.mark_failed(&seq, "terminal guard fixture");
    assert_eq!(h.scenario(&seq).status, RaceStatus::Failed);

    // Every driver signed state instruction after Failed must fail with BadState.
    let signer = h.driver.pubkey();
    for ix in [
        ix_advance(&h, &seq, &signer, 9_999),
        ix_fund(&h, &seq, &signer, h.usd_ata_a, Leg::Leg1Usd, 1),
        ix_start(&h, &seq, &signer, SettlementPath::Sequential),
        ix_release1(&h, &seq, &signer),
        ix_declare_default(&h, &seq, &signer),
        ix_mark_failed(&h, &seq, &signer, "second failure"),
    ] {
        let result = send(&mut h.ctx, ix, &h.driver);
        expect_settlement_error(&result, SettlementError::BadState);
    }

    // Party signed state instructions are blocked by the same terminal guard.
    let ix = ix_ack(&h, &seq, &h.party_a.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::BadState);
    let ix = ix_release2(&h, &seq, &h.party_b.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::BadState);

    // The atomic lane closes the same way, then settle_atomic is blocked too.
    h.mark_failed(&atomic, "terminal guard fixture");
    let ix = ix_settle_atomic(&h, &atomic, &signer);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);

    assert_eq!(h.scenario(&seq).status, RaceStatus::Failed);
    assert_eq!(h.scenario(&atomic).status, RaceStatus::Failed);
    assert_eq!(
        h.token(&h.usd_ata_b),
        0,
        "failed lanes never move leg 1 USD"
    );
    assert_eq!(
        h.token(&h.cad_ata_a),
        0,
        "failed lanes never move leg 2 CAD"
    );
    assert_eq!(
        h.token(&seq.vault_usd),
        LEG1_USD_CENTS,
        "sequential USD escrow must be untouched"
    );
    assert_eq!(
        h.token(&seq.vault_cad),
        LEG2_CAD_CENTS,
        "sequential CAD escrow must be untouched"
    );
    assert_eq!(
        h.token(&atomic.vault_usd),
        LEG1_USD_CENTS,
        "atomic USD escrow must be untouched"
    );
    assert_eq!(
        h.token(&atomic.vault_cad),
        LEG2_CAD_CENTS,
        "atomic CAD escrow must be untouched"
    );
}

#[test]
fn guard_anchor_chain_head_requires_terminal_status() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    let chain_head = chain_head_pda(&lane.scenario);

    // Paying is not terminal: BadState, and no ChainHead PDA is created.
    let signer = h.driver.pubkey();
    let ix = ix_anchor_chain_head(&h, &lane, &signer, [9u8; 32], 3, T_START_MS);
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::BadState);
    assert!(!h.ctx.account_exists(&chain_head));
    assert_eq!(h.scenario(&lane).status, RaceStatus::Paying);

    // Positive control: the same instruction succeeds once terminal.
    h.mark_failed(&lane, "terminal before anchoring");
    let ix = ix_anchor_chain_head(&h, &lane, &signer, [9u8; 32], 3, T_START_MS);
    let result = send(&mut h.ctx, ix, &h.driver);
    result.assert_success();
    let head: ChainHead = h
        .ctx
        .get_account(&chain_head)
        .expect("chain head must exist after anchoring");
    assert_eq!(head.scenario, lane.scenario);
    assert_eq!(head.final_hash, [9u8; 32]);
    assert_eq!(head.event_count, 3);
    assert_eq!(head.anchored_virtual_ms, T_START_MS);
    // LiteSVM's genesis Clock starts at unix time 0, so compare against the
    // sysvar rather than a nonzero wall clock.
    let clock: Clock = h.ctx.svm.get_sysvar();
    assert_eq!(head.anchored_unix_ts, clock.unix_timestamp);
}

#[test]
fn guard_initialize_scenario_rejects_duplicate_party() {
    let mut h = setup();

    // party_a == party_b must be rejected with NotParty.
    let ix = ix_initialize(
        &h,
        1,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
        GAP_MS,
        &h.party_a.pubkey(),
        &h.party_a.pubkey(),
    );
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::NotParty);

    let scenario = scenario_pda(&h.driver.pubkey(), 1);
    assert!(
        !h.ctx.account_exists(&scenario),
        "the rejected initialize must leave no scenario account behind"
    );

    // A valid initialize with distinct parties still works on the same id.
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    let stored = h.scenario(&lane);
    assert_ne!(stored.party_a, stored.party_b);
    assert_eq!(stored.status, RaceStatus::New);
}

// Atomicity invariant

#[test]
fn atomicity_invariant_no_half_settled_state() {
    let mut h = setup();

    // Honest lanes: sequential SETTLED always implies full CAD paid and
    // drained vaults; atomic SETTLED only ever comes from settle_atomic.
    let seq = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    let atomic_ok = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, LEG2_CAD_CENTS);
    h.release_leg1(&seq);
    h.advance(&seq, PAST_GAP_MS);
    h.release_leg2(&seq);
    assert_sequential_settled(&h, &seq);
    h.settle_atomic(&atomic_ok);
    assert_atomic_settled(&h, &atomic_ok);

    // Underfunded atomic lane at 9000 bps: revert leaves a full snapshot.
    let atomic_90 = h.open_lane(
        3,
        SettlementPath::Atomic,
        LEG1_USD_CENTS,
        bps(LEG2_CAD_CENTS, 9_000),
    );
    let before_90 = snapshot(&h, &atomic_90);
    let ix = ix_settle_atomic(&h, &atomic_90, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    assert_eq!(before_90, snapshot(&h, &atomic_90));
    assert_ne!(
        h.scenario(&atomic_90).status,
        RaceStatus::Settled,
        "a reverted settle must never produce SETTLED"
    );

    // No cross-lane path can half settle an atomic lane either. This runs
    // before the next lane opens so the harness-wide snapshot stays valid.
    let ix = ix_release1(&h, &atomic_90, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::WrongPath);
    assert_eq!(before_90, snapshot(&h, &atomic_90));

    // Underfunded atomic lane at 6000 bps: same invariant.
    let atomic_60 = h.open_lane(
        4,
        SettlementPath::Atomic,
        LEG1_USD_CENTS,
        bps(LEG2_CAD_CENTS, 6_000),
    );
    let before_60 = snapshot(&h, &atomic_60);
    let ix = ix_settle_atomic(&h, &atomic_60, &h.driver.pubkey());
    let result = send(&mut h.ctx, ix, &h.driver);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    assert_eq!(before_60, snapshot(&h, &atomic_60));
    assert_eq!(h.scenario(&atomic_60).status, RaceStatus::Paying);

    // The failed lanes can only close as FAILED, never as SETTLED.
    h.mark_failed(&atomic_90, "revert closes the lane");
    h.mark_failed(&atomic_60, "revert closes the lane");
    assert_eq!(h.scenario(&atomic_90).status, RaceStatus::Failed);
    assert_eq!(h.scenario(&atomic_60).status, RaceStatus::Failed);
    assert_eq!(h.token(&atomic_90.vault_usd), LEG1_USD_CENTS);
    assert_eq!(h.token(&atomic_90.vault_cad), bps(LEG2_CAD_CENTS, 9_000));
    assert_eq!(h.token(&atomic_60.vault_usd), LEG1_USD_CENTS);
    assert_eq!(h.token(&atomic_60.vault_cad), bps(LEG2_CAD_CENTS, 6_000));
}

// Security regression tests (Phase 2 security review fixes)

#[test]
fn guard_orchestration_instructions_are_driver_only() {
    let mut h = setup();
    let seq = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    let atomic = h.open_lane(2, SettlementPath::Atomic, LEG1_USD_CENTS, LEG2_CAD_CENTS);
    h.release_leg1(&seq);
    let seq_before = snapshot(&h, &seq);
    let atomic_before = snapshot(&h, &atomic);

    // Neither counterparty can force the settlement sequence or drive
    // time: start_race, advance_clock, release_leg1, declare_default, and
    // settle_atomic all reject party signers with NotParty.
    for party in [&h.party_a, &h.party_b] {
        let signer = party.pubkey();
        for ix in [
            ix_start(&h, &seq, &signer, SettlementPath::Sequential),
            ix_advance(&h, &seq, &signer, PAST_GAP_MS),
            ix_release1(&h, &seq, &signer),
            ix_declare_default(&h, &seq, &signer),
            ix_settle_atomic(&h, &atomic, &signer),
        ] {
            let result = send(&mut h.ctx, ix, party);
            expect_settlement_error(&result, SettlementError::NotParty);
        }
    }
    assert_eq!(
        seq_before,
        snapshot(&h, &seq),
        "rejected party calls must not move status, balances, or the clock"
    );
    assert_eq!(atomic_before, snapshot(&h, &atomic));

    // The driver still orchestrates the whole sequence end to end.
    h.advance(&seq, PAST_GAP_MS);
    h.declare_default(&seq);
    assert_eq!(h.scenario(&seq).status, RaceStatus::Defaulted);
    h.settle_atomic(&atomic);
    assert_atomic_settled(&h, &atomic);
}

#[test]
fn vault_donation_cannot_overpay_funded_cad_or_brick_default() {
    let mut h = setup();
    let cad_60 = bps(LEG2_CAD_CENTS, 6_000);
    assert_eq!(cad_60, 78_000, "6000 bps must be integer exact");
    let lane = h.open_lane(1, SettlementPath::Sequential, LEG1_USD_CENTS, cad_60);
    h.release_leg1(&lane);

    // An outside wallet donates the funding shortfall straight into the
    // vault PDA, so the live balance reaches the full notional while the
    // recorded funding stays at 60 percent.
    let donor = h
        .ctx
        .svm
        .create_funded_account(WALLET_LAMPORTS)
        .expect("donor airdrop");
    let cad_mint = h.cad_mint;
    let donor_ata = h
        .ctx
        .svm
        .create_associated_token_account(&cad_mint, &donor)
        .expect("donor cad ata");
    let donation = LEG2_CAD_CENTS - cad_60;
    h.ctx
        .svm
        .mint_to(&cad_mint, &donor_ata, &h.driver, donation)
        .expect("mint donation");
    let ix = ix_token_transfer(&donor_ata, &lane.vault_cad, &donor.pubkey(), donation);
    send(&mut h.ctx, ix, &donor).assert_success();
    assert_eq!(
        h.token(&lane.vault_cad),
        LEG2_CAD_CENTS,
        "donation tops the live vault balance up to the notional"
    );

    let before = snapshot(&h, &lane);

    // Full release: remaining equals leg2, which exceeds funded minus
    // paid, so a topped up vault cannot settle an underfunded lane.
    let ix = ix_release2(&h, &lane, &h.party_b.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);

    // Partial release above funded minus paid fails even though both the
    // remaining-notional cap and the live vault balance would allow it.
    let ix = ix_release2_partial(&h, &lane, &h.party_b.pubkey(), LEG2_CAD_CENTS);
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    let ix = ix_release2_partial(&h, &lane, &h.party_b.pubkey(), cad_60 + 1);
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);

    assert_eq!(
        before,
        snapshot(&h, &lane),
        "rejected payouts must not move balances or paid progress"
    );
    assert_eq!(h.scenario(&lane).paid_cad_cents, 0);

    // The default path still works: reclaim equals funded minus paid, so
    // the checked_sub never overflows even with the donation in place.
    h.advance(&lane, PAST_GAP_MS);
    h.declare_default(&lane);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Defaulted);
    assert_eq!(scenario.paid_cad_cents, 0);
    assert_eq!(
        h.token(&h.cad_ata_b),
        B_CAD_START,
        "B reclaimed exactly its recorded funding"
    );
    assert_eq!(h.token(&h.cad_ata_a), 0, "A received nothing");
    assert_eq!(
        h.token(&lane.vault_cad),
        donation,
        "the donation residue stays locked in the vault"
    );
}

#[test]
fn guard_advance_clock_keeps_default_deadline_below_i64_max() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    h.release_leg1(&lane);
    let bound = i64::MAX - settlement_race::instructions::MAX_GAP_MS;

    // Targets above the bound are rejected: a leg 1 stamp up there would
    // make declare_default's deadline checked_add overflow forever.
    let signer = h.driver.pubkey();
    for to_virtual_ms in [i64::MAX, bound + 1] {
        let ix = ix_advance(&h, &lane, &signer, to_virtual_ms);
        let result = send(&mut h.ctx, ix, &h.driver);
        expect_settlement_error(&result, SettlementError::BadState);
        assert_eq!(
            h.scenario(&lane).virtual_now_ms,
            T_START_MS,
            "the rejected advance must not move the clock"
        );
    }

    // The bound itself is accepted and the default deadline still
    // computes, closing the gap window without any overflow.
    h.advance(&lane, bound);
    h.declare_default(&lane);
    assert_eq!(h.scenario(&lane).status, RaceStatus::Defaulted);
}

// Coverage gap tests (Phase 2 code review routed items, 2026-11-11)

#[test]
fn guard_fund_leg_caps_deposits_at_leg_notional() {
    let mut h = setup();
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    h.advance(&lane, T_START_MS);
    h.acknowledge_both(&lane);
    assert_eq!(h.scenario(&lane).status, RaceStatus::Ack);

    // A single deposit one cent beyond the CAD notional is rejected
    // outright, before any token moves.
    let ix = ix_fund(
        &h,
        &lane,
        &h.party_b.pubkey(),
        h.cad_ata_b,
        Leg::Leg2Cad,
        LEG2_CAD_CENTS + 1,
    );
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    assert_eq!(h.scenario(&lane).funded_cad_cents, 0);
    assert_eq!(h.token(&lane.vault_cad), 0);

    // The cap applies to the cumulative sum, not to each deposit: after
    // LEG1 - 1 cents, a further 2 cents would exceed the notional.
    h.fund_usd(&lane, LEG1_USD_CENTS - 1);
    let ix = ix_fund(&h, &lane, &h.party_a.pubkey(), h.usd_ata_a, Leg::Leg1Usd, 2);
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.funded_usd_cents, LEG1_USD_CENTS - 1);
    assert_eq!(h.token(&lane.vault_usd), LEG1_USD_CENTS - 1);

    // Reaching the notional exactly is allowed, one cent more is not.
    h.fund_usd(&lane, 1);
    let ix = ix_fund(&h, &lane, &h.party_a.pubkey(), h.usd_ata_a, Leg::Leg1Usd, 1);
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.funded_usd_cents, LEG1_USD_CENTS);
    assert_eq!(h.token(&lane.vault_usd), LEG1_USD_CENTS);
    assert_eq!(h.token(&h.usd_ata_a), A_USD_START - LEG1_USD_CENTS);
    assert_eq!(
        h.token(&h.cad_ata_b),
        B_CAD_START,
        "rejected CAD funding never moves tokens"
    );
}

#[test]
fn guard_acknowledge_rejects_double_acknowledge_by_same_party() {
    let mut h = setup();
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);

    // First acknowledge by party A: accepted, status stays New.
    let ix = ix_ack(&h, &lane, &h.party_a.pubkey());
    send(&mut h.ctx, ix, &h.party_a).assert_success();
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::New);
    assert!(scenario.ack_a && !scenario.ack_b);

    // The second acknowledge by the same party is a one shot transition:
    // BadState, and the lane must not promote itself.
    let ix = ix_ack(&h, &lane, &h.party_a.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::BadState);
    let scenario = h.scenario(&lane);
    assert_eq!(
        scenario.status,
        RaceStatus::New,
        "the rejected repeat must not promote the status"
    );
    assert!(scenario.ack_a && !scenario.ack_b);

    // Party B completes the pair, which reaches Ack.
    let ix = ix_ack(&h, &lane, &h.party_b.pubkey());
    send(&mut h.ctx, ix, &h.party_b).assert_success();
    assert_eq!(h.scenario(&lane).status, RaceStatus::Ack);

    // Once the status left New, any further acknowledge is BadState for
    // both parties.
    let ix = ix_ack(&h, &lane, &h.party_a.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::BadState);
    let ix = ix_ack(&h, &lane, &h.party_b.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::BadState);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Ack);
    assert!(scenario.ack_a && scenario.ack_b);
}

#[test]
fn guard_release_leg2_full_requires_full_funding_dust_vault() {
    let mut h = setup();
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    h.advance(&lane, T_START_MS);
    h.acknowledge_both(&lane);
    h.fund_usd(&lane, LEG1_USD_CENTS);
    h.fund_cad(&lane, 1); // dust: one cent against a 130,000 cent notional
    h.start(&lane, SettlementPath::Sequential);
    h.release_leg1(&lane);
    assert_eq!(h.token(&lane.vault_cad), 1, "fixture must be a dust vault");

    let before = snapshot(&h, &lane);

    // Full release pins funded == leg2: a dust vault cannot settle the
    // lane even though the live balance covers the (huge) shortfall the
    // recorded funding does not.
    let ix = ix_release2(&h, &lane, &h.party_b.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    assert_eq!(
        before,
        snapshot(&h, &lane),
        "the rejected full release must move nothing"
    );

    // The dust can only leave the vault through the partial path, which
    // records progress without settling.
    h.release_leg2_partial(&lane, 1);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.paid_cad_cents, 1);
    assert_eq!(
        scenario.status,
        RaceStatus::Paying,
        "a dust partial never settles the lane"
    );
    assert_eq!(h.token(&h.cad_ata_a), 1);
    assert_eq!(h.token(&lane.vault_cad), 0);

    // After the dust is paid out, funded (1 cent) still never reaches
    // leg2, so the full release stays rejected forever.
    let ix = ix_release2(&h, &lane, &h.party_b.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Paying);
    assert_eq!(scenario.paid_cad_cents, 1);
    assert_eq!(h.token(&h.cad_ata_a), 1);
}

#[test]
fn guard_release_leg2_partial_amount_bounds() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    h.release_leg1(&lane);
    let before = snapshot(&h, &lane);

    // Amount zero is rejected even from the paying party: AmountZero.
    let ix = ix_release2_partial(&h, &lane, &h.party_b.pubkey(), 0);
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::AmountZero);

    // One cent above what is still owed exceeds remaining leg 2:
    // InsufficientEscrow (and available is identical on this fully
    // funded lane, so the remaining cap is what binds here).
    let ix = ix_release2_partial(&h, &lane, &h.party_b.pubkey(), LEG2_CAD_CENTS + 1);
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::InsufficientEscrow);

    assert_eq!(
        before,
        snapshot(&h, &lane),
        "rejected partials must not move balances or paid progress"
    );
    assert_eq!(h.scenario(&lane).paid_cad_cents, 0);
    assert_eq!(h.token(&h.cad_ata_a), 0);
    assert_eq!(h.token(&lane.vault_cad), LEG2_CAD_CENTS);
}

#[test]
fn guard_initialize_scenario_validates_amounts_and_gap() {
    let mut h = setup();
    let max_gap = settlement_race::instructions::MAX_GAP_MS;

    // Zero leg notionals are AmountZero; a zero, negative, or above
    // MAX_GAP_MS window is BadState. Every rejection must roll back the
    // init constraint and leave no scenario account behind.
    for (leg1, leg2, gap, expected) in [
        (0u64, LEG2_CAD_CENTS, GAP_MS, SettlementError::AmountZero),
        (LEG1_USD_CENTS, 0, GAP_MS, SettlementError::AmountZero),
        (LEG1_USD_CENTS, LEG2_CAD_CENTS, 0, SettlementError::BadState),
        (
            LEG1_USD_CENTS,
            LEG2_CAD_CENTS,
            -1,
            SettlementError::BadState,
        ),
        (
            LEG1_USD_CENTS,
            LEG2_CAD_CENTS,
            max_gap + 1,
            SettlementError::BadState,
        ),
    ] {
        let ix = ix_initialize(
            &h,
            1,
            leg1,
            leg2,
            gap,
            &h.party_a.pubkey(),
            &h.party_b.pubkey(),
        );
        let result = send(&mut h.ctx, ix, &h.driver);
        expect_settlement_error(&result, expected);
        let scenario = scenario_pda(&h.driver.pubkey(), 1);
        assert!(
            !h.ctx.account_exists(&scenario),
            "a rejected initialize must leave no account (leg1={leg1}, leg2={leg2}, gap={gap})"
        );
    }

    // The MAX_GAP_MS boundary itself is accepted, and a valid initialize
    // still works on the same scenario id afterwards.
    let ix = ix_initialize(
        &h,
        1,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
        max_gap,
        &h.party_a.pubkey(),
        &h.party_b.pubkey(),
    );
    send(&mut h.ctx, ix, &h.driver).assert_success();
    let scenario = h.scenario(&h.lane(1));
    assert_eq!(scenario.status, RaceStatus::New);
    assert_eq!(scenario.gap_ms, max_gap);
}

#[test]
fn guard_anchor_chain_head_rejects_double_anchor() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    h.mark_failed(&lane, "terminal before anchoring");
    let chain_head = chain_head_pda(&lane.scenario);
    let signer = h.driver.pubkey();

    // First anchor succeeds and writes the ChainHead PDA.
    let ix = ix_anchor_chain_head(&h, &lane, &signer, [1u8; 32], 1, T_START_MS);
    send(&mut h.ctx, ix, &h.driver).assert_success();
    let head: ChainHead = h
        .ctx
        .get_account(&chain_head)
        .expect("chain head after the first anchor");
    assert_eq!(head.final_hash, [1u8; 32]);
    assert_eq!(head.event_count, 1);
    assert_eq!(head.anchored_virtual_ms, T_START_MS);

    // The second anchor fails: the ChainHead PDA carries an init
    // constraint, so the replay is rejected at the account level (not by
    // a SettlementError guard) and the first head stays intact.
    let ix = ix_anchor_chain_head(&h, &lane, &signer, [2u8; 32], 2, PAST_GAP_MS);
    let result = send(&mut h.ctx, ix, &h.driver);
    assert!(
        result.error().is_some(),
        "the second anchor must fail, error: {:?}",
        result.error()
    );
    let logs = result.logs().join("\n");
    let settlement_guard = [
        "InsufficientEscrow",
        "NotParty",
        "BadState",
        "GapNotExpired",
        "ClockRegression",
        "NotFullyFunded",
        "WrongPath",
        "AmountZero",
        "Overflow",
    ]
    .iter()
    .any(|name| logs.contains(&format!("Error Code: {}", name)));
    assert!(
        !settlement_guard,
        "the replay must be an init constraint failure, not a program guard, logs:\n{}",
        logs
    );
    // Observed failure shape: the init constraint's system program CPI
    // (create_account_allow_prefund) rejects the already existing ChainHead
    // account with InvalidInstructionData, so the transaction dies with
    // InstructionError(0, InvalidInstructionData) and no program guard runs.
    let init_failure = logs.contains("invalid instruction data")
        || logs.contains("already in use")
        || logs.contains("AccountAlready")
        || logs.contains("InvalidAccountOwner")
        || logs.contains("AccountFailedToBeInitialized");
    assert!(
        init_failure,
        "expected an init constraint failure, error: {:?}, logs:\n{}",
        result.error(),
        logs
    );

    let head: ChainHead = h
        .ctx
        .get_account(&chain_head)
        .expect("the chain head must survive the rejected anchor");
    assert_eq!(head.final_hash, [1u8; 32]);
    assert_eq!(head.event_count, 1);
    assert_eq!(head.anchored_virtual_ms, T_START_MS);
}

#[test]
fn guard_release_leg2_requires_party_b_signer() {
    let mut h = setup();
    let lane = h.open_lane(
        1,
        SettlementPath::Sequential,
        LEG1_USD_CENTS,
        LEG2_CAD_CENTS,
    );
    h.release_leg1(&lane);
    let outsider = h
        .ctx
        .svm
        .create_funded_account(WALLET_LAMPORTS)
        .expect("outsider airdrop");
    let before = snapshot(&h, &lane);

    // Party A may not trigger the payout of its own CAD escrow: NotParty.
    let ix = ix_release2(&h, &lane, &h.party_a.pubkey());
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::NotParty);

    // An outside wallet is rejected the same way.
    let ix = ix_release2(&h, &lane, &outsider.pubkey());
    let result = send(&mut h.ctx, ix, &outsider);
    expect_settlement_error(&result, SettlementError::NotParty);

    assert_eq!(
        before,
        snapshot(&h, &lane),
        "rejected releases must move nothing"
    );
    assert_eq!(h.token(&h.cad_ata_a), 0);
    assert_eq!(h.scenario(&lane).status, RaceStatus::Paying);

    // Positive control: the paying party still releases and settles.
    h.release_leg2(&lane);
    let scenario = h.scenario(&lane);
    assert_eq!(scenario.status, RaceStatus::Settled);
    assert_eq!(scenario.paid_cad_cents, LEG2_CAD_CENTS);
    assert_eq!(h.token(&h.cad_ata_a), LEG2_CAD_CENTS);
}

#[test]
fn guard_fund_leg_rejects_wrong_source_ata() {
    let mut h = setup();
    let lane = h.initialize(1, LEG1_USD_CENTS, LEG2_CAD_CENTS, GAP_MS);
    h.advance(&lane, T_START_MS);
    h.acknowledge_both(&lane);
    let before = snapshot(&h, &lane);

    // Party A's CAD ATA cannot fund leg 2 even when the correct party B
    // signs: the source must be the funding party's own ATA, so the
    // require_party_ata check rejects it with NotParty.
    let ix = ix_fund(
        &h,
        &lane,
        &h.party_b.pubkey(),
        h.cad_ata_a,
        Leg::Leg2Cad,
        LEG2_CAD_CENTS,
    );
    let result = send(&mut h.ctx, ix, &h.party_b);
    expect_settlement_error(&result, SettlementError::NotParty);

    // Party A signing its own CAD ATA for leg 2 fails the signer check
    // first, also NotParty.
    let ix = ix_fund(
        &h,
        &lane,
        &h.party_a.pubkey(),
        h.cad_ata_a,
        Leg::Leg2Cad,
        LEG2_CAD_CENTS,
    );
    let result = send(&mut h.ctx, ix, &h.party_a);
    expect_settlement_error(&result, SettlementError::NotParty);

    assert_eq!(
        before,
        snapshot(&h, &lane),
        "rejected funding must move nothing"
    );
    assert_eq!(h.token(&lane.vault_cad), 0);
    assert_eq!(h.token(&h.cad_ata_b), B_CAD_START);
    assert_eq!(h.token(&h.cad_ata_a), 0);
}
