# Settlement Race Test Results

Last updated: 2026-11-12 (Phase 6 final)

## 2026-11-10 - Phase 1: Test Report

Phase 1 scope: bootstrap, schemas, core libs, devnet setup script. Program logic arrives Phase 2.

### Suite results

| Suite | Command | Result |
|-------|---------|--------|
| Vitest (app) | `cd app && npm test` | PASS: 6 files, 84 tests (62 pre-existing, 22 new) |
| Type check | `cd app && npx tsc --noEmit` | PASS (strict mode, exit 0) |
| Production build | `cd app && npm run build` | PASS (tsc + vite, exit 0) |
| Rust unit tests | `cargo test --manifest-path programs/settlement-race/Cargo.toml` | PASS: 5 tests in new `state_schema` suite; lib placeholder still has 0 unit tests |
| Rust SBF tests | `cargo test-sbf --manifest-path programs/settlement-race/Cargo.toml` | PASS (exit 0; same 5 host tests, no LiteSVM suite yet) |

Baseline before this phase's new tests: 62 Vitest tests in 5 files, 0 Rust tests. Final: 84 Vitest tests in 6 files, 5 Rust tests in 1 file.

### Per-test results (new tests)

| Test | Verdict | Notes |
|------|---------|-------|
| money fmt edges (1 cent, exact dollars, negative grouping, u64 max) | PASS | formatting derived from integer division only |
| ticketHash changes for each of 14 single field mutations | PASS | includes nested party fields, lifecycle, rate, gap |
| canonicalJson null preservation, JSON.stringify escape parity, UTF-16 key order | PASS | control chars, lone surrogate, emoji, non ASCII keys |
| buildTicket copies party references (input mutation isolation) | PASS | later input mutation cannot alter the built ticket |
| validateTicket rejects JSON number money, wrong literals, bad enum members | PASS | covers schema section 1.2 rejection rules |
| validateTicket validates hash shape but not hash content | PASS | pinned documented behavior; callers compare via ticketHash |
| buildTicket accepts any lifecycle off chain (transition gap pin) | PASS | transition guards land on chain in Phase 2 |
| provenance worked example hashes from schema section 5.3 | PASS | doc and code agree byte for byte |
| recordHash omits the hash field itself (canonical rule 8) | PASS | |
| verifyRecords detects a tampered seq number | PASS | reports broken_at = 1 |
| provenance rejects bigint payloads (money as decimal strings only) | PASS | throws at append, chain stays empty |
| VirtualClock equal timestamp tie-break by insertion order | PASS | time order then insertion order |
| VirtualClock nested schedule runs on next advance, not recursively | PASS | equal advance runs the pending due callback |
| VirtualClock rejects negative schedule time | PASS | |
| scenarios fund_bps integer in 0 to 10000 for every spec | PASS | |
| scenarios atomic lane settles only at full funding (10000 bps) | PASS | also checks bot_behavior set and default gap |
| scenarioPda determinism plus bump range 0 to 255 | PASS | new file pda.test.ts |
| scenarioPda distinct per driver and scenario id | PASS | |
| scenarioPda u64 bounds (0 and u64 max ok, minus 1 and 2^64 rejected) | PASS | |
| vault and chain head PDAs distinct per kind and per scenario | PASS | |
| PROGRAM_ID sync with declare_id! in lib.rs and Anchor.toml | PASS | reads both source files at test time |
| default program id derivation matches explicit program id | PASS | |
| Scenario SPACE equals serialization plus 8 equals 221 | PASS | Rust, state_schema.rs |
| Scenario round trip through AnchorDeserialize | PASS | Rust |
| ChainHead SPACE equals serialization plus 8 equals 97 | PASS | Rust |
| RaceStatus Borsh discriminants 0 through 5 in schema order | PASS | Rust |
| SettlementPath and Leg Borsh discriminants in schema order | PASS | Rust |

Total new tests: 27 (22 Vitest, 5 Rust). All pass.

### Coverage summary

- Money: parse_cents (valid, invalid, length bounds), add, sub_checked, fmt (0, 1, 5, 99, 100, 1000, negatives, grouping, u64 max). Fully covered for Phase 1 scope.
- Ticket: golden hash, stability, hash field omission, per field hash sensitivity, canonical JSON rules 1 to 8 (key order, no whitespace, array order, escaping, undefined omission, null preservation, rejection of bigint and non finite numbers, circular guard), buildTicket defaults and copy semantics, validateTicket rejections (types, literals, enums, dates, u64 range, string length, hash shape). No content level hash verification, documented and pinned.
- Provenance: genesis head, link chain, determinism, seq enforcement, tamper detection for data, hash, prev_hash, genesis link, and seq, verifyRecords broken_at reporting, doc worked example golden hashes, payload type guard.
- Clock: init, monotonic advance, regression error, equal advance, time ordered callbacks, insertion order tie-break, past scheduling, nested scheduling, negative schedule rejection.
- Scenarios: five unique kinds, integer cent amounts, string gap, fund_bps bounds, terminal membership, atomic funding invariant, bot behavior set, default gap, getScenario error.
- PDA (previously 0 percent): determinism, distinctness, u64 bounds, cross file program id sync with declare_id! and Anchor.toml.
- Rust (previously 0 percent): Scenario and ChainHead account space against exact Borsh serialization, Borsh round trip, enum discriminant order for RaceStatus, SettlementPath, and Leg.
- Not covered by design: instruction transition guards (Phase 2), on chain ChainHead anchoring (Phase 3), scenario engine and bot execution (Phase 4), offline mode (Phase 6), scripts/setup-devnet.ts (requires live devnet network access, exercised manually).

### Findings (no source code was modified)

- F1 (informational, not a bug): No TypeScript code enforces the lifecycle transition table in tradeops-schema.md section 2.1. validateTicket checks enum membership only, and buildTicket accepts any lifecycle value directly, including terminal states with no history. This is consistent with the documented plan (section 7: instruction guards arrive in Phase 2 on chain), but the off-chain ticket lifecycle field must not be trusted as evidence of state until Phase 2 guards exist. Pinned by the test "accepts any lifecycle off chain; transition guards are Phase 2".
- F2 (observation): canonicalJson throws on an undefined array element, while JSON.stringify converts it to null. Schema rule 5 only specifies behavior for undefined object properties, so the implementation is arguably compliant, but it is stricter than JSON.stringify. Arrays do not occur in schema version 1 tickets or provenance data, so no hash impact exists today. Phase 2 should decide whether to document the throw or match JSON.stringify.
- F3 (observation): validateTicket accepts non canonical integer strings such as "007" for amounts and gap, because only digits and the u64 range are checked. Padding does not affect validation, and "007" and "7" produce different canonical JSON and therefore different hashes. No schema rule forbids this today; if canonicality matters for cross producer hashing, Phase 2 should reject leading zeros explicitly.

Failure analysis: none. No test failed, so no fixes were required.

### Recurring patterns for other agents

- None. All suites are green.

## 2026-11-11 - Phase 2 chunk B: LiteSVM integration suite

Scope: end to end integration coverage for the twelve program instructions (five scenario specs, guards, atomicity invariants) plus the architecture and decision doc alignments for the confirmed start_race funding rule (funded USD equals leg 1 exactly, funded CAD nonzero; full CAD enforcement lives in settle_atomic InsufficientEscrow).

### Suite results

| Suite | Command | Result |
|-------|---------|--------|
| LiteSVM integration (Rust) | `cargo test-sbf --manifest-path programs/settlement-race/Cargo.toml --tools-version v1.54 --arch v0` (identical to the Anchor.toml scripts.test entry) | PASS: 14 tests, 0 failures, 0 warnings |
| Rust host tests | `cargo test --manifest-path programs/settlement-race/Cargo.toml` | PASS: 14 integration plus 5 Phase 1 schema units, 0 warnings |
| Anchor program build | `anchor build` | PASS: exit 0, 0 warnings (does not run the integration suite; it only runs the filtered IDL printer test) |
| Vitest (app) | `cd app && npm test` | PASS: 6 files, 84 tests, unchanged from Phase 1 |

### Per-test results (new tests in programs/settlement-race/tests/settlement_race.rs)

| Test | Verdict | Notes |
|------|---------|-------|
| honest_sequential_settles_both_legs_exactly | PASS | exact balances: B receives leg 1 USD, A receives leg 2 CAD, both vaults drain to zero, SETTLED with paid_cad_cents == leg2_cad_cents |
| honest_atomic_settles_both_legs_in_one_tx | PASS | both legs move in the single settle_atomic transaction, exact party balances, vaults zero, paid progress untouched |
| default_after_leg1_sequential_vs_atomic_contrast | PASS | A is short the leg 1 USD, B keeps it, B reclaims the sequential CAD remainder, paid_cad_cents == 0, identically funded atomic lane settles cleanly |
| late_payment_still_settles_then_default_is_blocked | PASS | release after gap expiry still reaches SETTLED, later declare_default fails BadState, terminal never reopens |
| atomic_revert_at_9000_bps_reverts_then_mark_failed | PASS | sequential partial at 9000 bps then DEFAULTED with paid == 90 percent of leg 2, atomic snapshot bit identical after InsufficientEscrow, mark_failed reaches FAILED |
| partial_payment_at_6000_bps_settles_partial_then_default | PASS | paid == 6000 bps of leg 2 then DEFAULTED with remainder reclaim, atomic attempt moves nothing |
| guard_cross_lane_instructions_fail_with_wrong_path | PASS | settle_atomic on sequential, release_leg1 and declare_default on atomic all fail WrongPath, lane snapshots unchanged |
| guard_gap_boundary_and_double_release | PASS | declare at exactly leg1 stamp plus gap fails GapNotExpired (strictly greater required), second release_leg1 fails BadState |
| guard_start_race_requires_acks_and_exact_usd | PASS | New status and single acknowledgement fail BadState, zero CAD fails NotFullyFunded, inexact USD with full CAD fails NotFullyFunded, exact USD plus one cent CAD opens the race |
| guard_clock_parties_and_zero_amounts | PASS | non party acknowledgement NotParty, backward clock ClockRegression, wrong party fund_leg NotParty, zero amount fund_leg AmountZero |
| guard_terminal_state_never_reopens | PASS | eight state instructions after mark_failed all fail BadState with escrow untouched, settle_atomic after Failed fails BadState |
| guard_anchor_chain_head_requires_terminal_status | PASS | Paying anchor fails BadState with no ChainHead PDA created, terminal anchor succeeds and every ChainHead field matches |
| guard_initialize_scenario_rejects_duplicate_party | PASS | party_a == party_b rejected NotParty, no scenario account left behind, valid initialize still works on the same id |
| atomicity_invariant_no_half_settled_state | PASS | snapshot equality after failed settle_atomic at 9000 and 6000 bps, cross lane release fails WrongPath with snapshot equal, sequential SETTLED only when paid == leg 2, atomic SETTLED only via settle_atomic success |

Total new integration tests: 14, all pass. Combined host run: 19 tests (14 integration plus 5 schema units).

### How to run

```bash
# Canonical (rebuilds the SBF artifact the suite loads, pinned in Anchor.toml):
cargo test-sbf --manifest-path programs/settlement-race/Cargo.toml --tools-version v1.54 --arch v0
# Host rerun against the artifact already on disk:
cargo test --manifest-path programs/settlement-race/Cargo.toml
# Frontend:
cd app && npm test
```

Run order note: the suite loads target/deploy/settlement_race.so at test runtime. The pinned cargo test-sbf command rebuilds it in the shape LiteSVM accepts. A bare `anchor build` produces an SBPF arch v3 artifact (platform-tools v1.57) that LiteSVM 0.11 rejects, so rebuild with the cargo command above before a host cargo test after any anchor build; the harness fails fast with that exact guidance. `anchor test` currently stops at its standard devnet pre deployment step because the configured wallet lacks the required lamports, so tests are run with the script command directly until devnet deployment is scheduled (Phase 5).

### Findings (no program source was modified)

- F4 (build tooling, fixed in Anchor.toml): unpinned cargo test-sbf resolves the platform-tools version over the network and falls back to the built-in v1.51 (cargo 1.84) when the lookup fails. That cargo cannot parse the edition 2024 manifests of the new dependency tree (block-buffer 0.12.1) and the run aborts before compiling. Fixed by pinning `--tools-version v1.54 --arch v0` in the Anchor.toml test script with an explanatory comment.
- F5 (artifact flavors, documented): anchor build invokes cargo-build-sbf with `--tools-version v1.57 --arch v3` (e_flags 3, e_machine 247, 3 program headers) while the pinned test path builds arch v0 (e_flags 0, e_machine 263, 4 program headers). The agave 3.1 loader inside LiteSVM 0.11 (solana-sbpf 0.13.1, strict parser for SBPF V3) only loads the arch v0 shape. The harness reads the ELF header and fails fast with the rebuild command instead of a cryptic InvalidAccountData. Devnet deployment must later confirm which artifact flavor the target validator expects.
- F6 (pre-existing, untouched): `cargo fmt --check` reports drift in five chunk A files under programs/settlement-race/src/instructions/ (single line require! calls rustfmt wants split). The new test file is rustfmt clean. Routed for a cleanup pass outside this chunk.
- F7 (observation): the chunk A summary mentions 6 unit tests; the repository currently contains 5 unit tests (all in tests/state_schema.rs) and 0 lib unit tests, verified by grepping for the test attribute. Nothing was removed in this chunk.

### Recurring patterns for other agents (additions)

- LiteSVM reuses one blockhash until expire_blockhash is called, so two identical signed transactions collide as AlreadyProcessed. Test helpers must rotate the blockhash before every send when a test intentionally resends the same instruction.
- Snapshot assertions that include harness wide balances (party ATAs are shared across lanes) must be taken and compared with no successful transaction in between; opening another lane moves those balances by design.
- LiteSVM's genesis Clock has unix_timestamp 0, so provenance assertions compare against the sysvar rather than a nonzero wall clock.

## 2026-11-11 - Phase 2: Coverage gap tests and full suite verification

Correction note (supersedes earlier counts): the Phase 2 chunk B section above records a 14-test LiteSVM roster and lists F6 (rustfmt drift) as open. Both entries are stale. The fix round added `guard_zero_virtual_time_rejects_start_and_leg1_release` and `guard_mark_failed_is_driver_only` (16 tests), the security round added `guard_orchestration_instructions_are_driver_only`, `vault_donation_cannot_overpay_funded_cad_or_brick_default`, and `guard_advance_clock_keeps_default_deadline_below_i64_max` (19 tests), and this round adds 8 coverage gap tests for a final roster of 27 integration tests. F6 is CLOSED: `cargo fmt --check` exits 0 over the whole program package (verified 2026-11-11, before and after this round). No program source file was modified in this round (instruction handler mtimes unchanged; only `programs/settlement-race/tests/settlement_race.rs` gained tests).

Scope: independent re-execution of every Phase 2 verification command plus the code review routed coverage gaps from docs/reviews.md (Phase 2 code review, fix round, and security review rows).

### Suite results (all re-run by the tester)

| Suite | Command | Result |
|-------|---------|--------|
| rustfmt | `cargo fmt --check --manifest-path programs/settlement-race/Cargo.toml` | PASS: exit 0, no diff (F6 closed) |
| LiteSVM integration (Rust) | `cargo test-sbf --manifest-path programs/settlement-race/Cargo.toml --tools-version v1.54 --arch v0` (pinned Anchor.toml script) | PASS: 27 integration plus 5 unit tests, 0 failures, 0 warnings |
| Rust host tests | `cargo test --manifest-path programs/settlement-race/Cargo.toml` (after test-sbf, v0 artifact on disk) | PASS: exit 0, 27 integration plus 5 unit |
| Anchor program build | `anchor build` (after cargo test-sbf, per run order) | PASS: exit 0, 0 warnings |
| Vitest (app) | `cd app && npm test` | PASS: 6 files, 84 tests |
| Type check | `cd app && npx tsc --noEmit` | PASS: exit 0 |

Run order observed: cargo fmt, pinned cargo test-sbf, host cargo test, anchor build, then one final pinned cargo test-sbf so the arch v0 artifact (the shape LiteSVM loads) is what stays on disk after the arch v3 anchor build.

### New tests (8 added to programs/settlement-race/tests/settlement_race.rs)

| Test | Verdict | Notes |
|------|---------|-------|
| guard_fund_leg_caps_deposits_at_leg_notional | PASS | single deposit one cent over the CAD notional rejected InsufficientEscrow; cumulative excess (LEG1 minus 1 then plus 2) rejected; exact notional accepted; rejected deposits move no tokens |
| guard_acknowledge_rejects_double_acknowledge_by_same_party | PASS | repeat ack by party A in New fails BadState and does not promote status; both parties fail BadState after Ack |
| guard_release_leg2_full_requires_full_funding_dust_vault | PASS | funded 1 cent against a 130,000 cent notional: full release InsufficientEscrow with identical snapshot; dust pays only through the partial path (paid 1, stays Paying); full release stays rejected after the dust drains, pinning funded == leg2 for full release |
| guard_release_leg2_partial_amount_bounds | PASS | amount 0 fails AmountZero from the paying party; remaining plus 1 fails InsufficientEscrow; balances and paid progress unchanged |
| guard_initialize_scenario_validates_amounts_and_gap | PASS | leg1 0 and leg2 0 fail AmountZero; gap 0, gap minus 1, and gap MAX_GAP_MS plus 1 fail BadState; every rejection rolls back with no scenario account left; the MAX_GAP_MS boundary itself is accepted |
| guard_anchor_chain_head_rejects_double_anchor | PASS | second anchor fails at the account level with InstructionError(0, InvalidInstructionData) from the init constraint's system CPI, no SettlementError guard fires, and the first ChainHead stays byte intact |
| guard_release_leg2_requires_party_b_signer | PASS | party A and an outside wallet both fail NotParty with an unchanged snapshot; party B positive control settles exactly |
| guard_fund_leg_rejects_wrong_source_ata | PASS | correct signer party B with party A's CAD ATA fails NotParty (require_party_ata); party A signing its own CAD ATA fails NotParty at the signer check; no movement |

Skipped with evidence: acknowledge by a non party already fails NotParty in `guard_clock_parties_and_zero_amounts` (outsider ix_ack expects NotParty), verified passing in this run, so no duplicate test was added.

### Final roster (supersedes all earlier counts)

- LiteSVM integration: 27 tests (19 prior plus 8 new) in `tests/settlement_race.rs`.
- Rust unit: 5 tests in `tests/state_schema.rs`; lib.rs unit tests: 0.
- Rust total: 32. Vitest: 84 in 6 files. Grand total: 116 tests, all passing.

### Findings (no program source was modified)

- F8 (observation, not a bug): a rejected double `anchor_chain_head` reports `InstructionError(0, InvalidInstructionData)` from the system program CPI inside the init constraint rather than a named Anchor error code. The replay is still blocked, the stored head is untouched, and the frozen nine-variant error enum has no duplicate account variant, so this is the expected account level rejection. Pinned by the new test, which also asserts no SettlementError guard fired.
- No program bug found: all nine routed gap items behaved exactly as specified (cap, one shot ack, funded == leg2 full release, partial amount bounds, initialize validation, one shot anchor, party B signer, wrong source ATA, non party acknowledge pre-covered).
- Test code fix during this round: the first draft of the double anchor test expected an Anchor named init error; the observed message is `invalid instruction data`, so the assertion was updated to pin the actual shape (test file only).

### Recurring patterns for other agents (additions)

- An Anchor `init` constraint rejecting an existing account fails inside the system program CPI with `invalid instruction data`, not with a named Anchor error; assert on the error string, the absence of program guard logs, and state immutability instead of an error code name.
- Coverage gap tests that reuse a lane must take snapshots with no successful transaction in between, matching the pattern already used by the atomicity tests.

## 2026-11-11 - Phase 3: provenance anchor, evidence, and program clients

Scope: the devnet ProgramClient implementation (`app/src/lib/anchorClient.ts`), the evidence module (`app/src/lib/evidence.ts`), the offline MockProgramClient (`app/src/lib/mockClient.ts`), the anchor flow glue (`app/src/engine/anchorFlow.ts`), the committed IDL copies the app build needs (`app/src/lib/settlement_race.json`, `app/src/lib/settlementRaceTypes.ts`), and four new Vitest suites. Program source (Rust) was not touched this phase, so no cargo command was rerun; the Phase 2 roster of 32 Rust tests stands as recorded above.

### Interface mapping (13 methods to 12 instructions plus one read)

| ProgramClient method | Instruction or action |
|----------------------|----------------------|
| `initScenario` | `initialize_scenario`, counterparties as remaining accounts `[party_a, party_b]` |
| `ack` | `acknowledge` |
| `fundLeg` | `fund_leg` (Leg enum from `LegName`, party ATA derived from the signer) |
| `startRace` | `start_race` (path replayed from the path registered at `initScenario`) |
| `releaseLeg1` | `release_leg1` (party B USD ATA) |
| `releaseLeg2` | `release_leg2` (party A CAD ATA) |
| `releaseLeg2Partial` | `release_leg2_partial` |
| `declareDefault` | `declare_default` (party B CAD ATA) |
| `settleAtomic` | `settle_atomic` (both party ATAs) |
| `markFailed` | `mark_failed` (reason defaults to empty string) |
| `advanceClock` | `advance_clock` |
| `anchorChainHead` | `anchor_chain_head` (ChainHead PDA) |
| `fetchScenario` | `program.account.scenario.fetch` decoded into `ScenarioAccount` |
| extension `fetchChainHead` | `program.account.chainHead.fetch` (AnchorClient and MockProgramClient, clearly marked beyond the frozen interface) |

### Suite results

| Suite | Command | Result |
|-------|---------|--------|
| Vitest (app) | `cd app && npm test` | PASS: 10 files, 127 tests (84 pre-existing, 43 new) |
| Type check | `cd app && npx tsc --noEmit` | PASS (strict mode, exit 0) |
| Production build | `cd app && npm run build` | PASS (tsc + vite, exit 0) |
| Rust suites | not rerun | program source untouched this phase; artifact caveat from Phase 2 still applies |

### New tests (43 across 4 files)

| Test group | Count | Verdict | Notes |
|------------|-------|---------|-------|
| Mock five scenario happy paths (`mockClient.test.ts`) | 5 | PASS | one `it.each` over `SCENARIOS`; both lanes per spec driven through the frozen interface to `expected_sequential_terminal` and `expected_atomic_terminal`, with funded, paid, and vault counter assertions (honest settles at the deadline, late payment races an open default window, underfunded lanes partial pay then default, atomic reverts then `mark_failed`) |
| Mock signer guards | 2 | PASS | driver only and party B only matrix surfaced as `NotParty`, non party ack, no state movement after rejections |
| Mock gap and clock rules | 2 | PASS | `GapNotExpired` exactly at the deadline then success one millisecond later, `ClockRegression` on a backwards move |
| Mock terminal never reopens | 1 | PASS | eight transitions after `SETTLED` all `BadState` on both lanes |
| Mock path, funding, account guards | 4 | PASS | `WrongPath` cross lane moves, start race ack and funding gates (inexact USD, zero CAD, zero clock), funding cap and `AmountZero`, duplicate init `AccountAlreadyInUse` |
| Anchor flow anchoring (`anchorFlow.test.ts`) | 2 | PASS | anchor lands, mock `ChainHead` equals `chain.head()`, `verifyAgainstChainHead` returns all four fields valid; pre terminal `BadState`, non driver `NotParty`, double anchor `AccountAlreadyInUse` |
| Anchor flow tamper and truncation | 3 | PASS | edited record fails verification while head and count still match; truncated chain passes standalone verify yet fails `event_count_match` against the anchor; missing or foreign account yields `on_chain_head: null` |
| `headToBytes` | 2 | PASS | round trip of a real chain head, malformed hex rejected |
| Evidence fetch (`evidence.test.ts`) | 9 | PASS | success row with ISO block time, failed tx clears `success`, foreign program clears `program_id_match`, missing tx unfetched, 429 retried then succeeds (3 calls), 410 exhausts the retry budget (`fetched_ok: false`), parsed to raw fallback, v0 `programIdIndex` resolved against static plus loaded keys, mixed batch keeps order and never throws |
| Evidence attach and verify | 5 | PASS | index aligned stamping without overwrite or input mutation, valid and missing signature reporting, unfetched rows counted missing, null `tx_sig` records skipped |
| AnchorClient decode (`anchorClient.test.ts`) | 3 | PASS | `ScenarioAccount` projection from a coder encoded account (status, path, bigints, flags, ticket hash), missing account error, program id getter |
| AnchorClient authority guards | 3 | PASS | unregistered signer and driver rejected `NotParty` before any network call, unknown lane path rejected, `registerLanePath` clears the path gate |
| `keypairWallet` | 2 | PASS | partial signs a legacy transaction, signs a batch; `verifySignatures` true |

Total new tests: 43, all pass. Combined with the pre-existing suites the app is at 127 Vitest tests; with the Phase 2 Rust roster the repository total is 159 tests (Rust not rerun this phase).

### Findings and judgment calls (no program source modified)

- J1 (package): the pinned `@anchor-lang/core@1.2.2` exists on npm and was installed and used, matching the decisions.md record; `@coral-xyz/anchor` (legacy, latest 0.32.1) was not needed.
- J2 (build artifacts): `target/` is gitignored, so the generated IDL (`settlement_race.json`) and its type helper (`settlementRaceTypes.ts`) were copied into `app/src/lib/` and `resolveJsonModule` was enabled. Both files must be refreshed together after any `anchor build`.
- J3 (interface gap): the frozen `StartRaceArgs` carries no path, while `start_race` needs one. Both clients register the requested path at `initScenario` (`InitScenarioArgs.path`) and replay it at `startRace`; a lane created elsewhere must call the marked `registerLanePath` extension instead of silently defaulting to sequential.
- J4 (signing): the Anchor provider wallet is party A (wallet adapter), so it pays and signs every transaction; the driver and party B keypairs partial sign their own instructions. `keypairWallet` exists for headless callers.
- J5 (mock trust model): the mock treats `args.signer` the way the program treats a signature, then enforces the identical role guards. Account level rejections are typed `AccountAlreadyInUse`, `AccountNotFound`, and `InvalidInstructionData`; on chain a double anchor surfaces as `InvalidInstructionData` (docs/tests.md F8), the mock uses the descriptive name with identical semantics (rejected, no state change).
- J6 (truncation): `verifyAgainstChainHead` requires chain integrity, head equality, and event count equality together, which closes the reviews.md Phase 3 note that standalone `verifyRecords` accepts any prefix. The code comment in `anchorFlow.ts` documents the length comparison as the truncation detector.
- J7 (evidence semantics): `success` means fetched and `meta.err` null; `program_id_match` is a separate dimension, matching the architecture wording that the panel checks program id plus success. 429 and 410 responses are retried with linear backoff, then degrade to `fetched_ok: false`; `fetchEvidence` never throws.
- J8 (no network in tests): all four suites use in memory state or connection doubles, so vitest stays offline by design; live devnet confirmation belongs to the Phase 4 to 5 smoke run once the program is deployed.
- J9 (typed client): `Program<SettlementRace>` gives compile time checking of instruction names, arguments, and accounts; the runtime IDL is the raw snake case JSON (the package camel cases it internally), while `BorshAccountsCoder` used directly by `anchorFlow` decodes with the raw field names.

### How to run

```bash
cd app && npm test          # 127 tests, 10 files
cd app && npx tsc --noEmit  # strict type check
cd app && npm run build     # tsc + vite production build
```

### Recurring patterns for other agents (additions)

- Program failures from either client are strings of the form `ErrorName: message`; `programErrorCode` in `app/src/lib/mockClient.ts` parses the code, and `AnchorClient.formatTxError` produces the same shape from `AnchorError` and `ProgramError`.
- The committed IDL pair (`settlement_race.json` plus `settlementRaceTypes.ts`) is the app's source of truth for the program interface; regenerate both from `anchor build` output together or method typing silently drifts.
- `BorshAccountsCoder` over the raw IDL yields snake case field names (`final_hash`), while `program.account.*.fetch` yields camel case (`finalHash`); the anchor flow decode and the AnchorClient decode intentionally differ in that one respect.
- Mock transaction signatures are `mock_sig_` plus a zero padded counter, so fixtures and offline records are visibly synthetic.

## 2026-11-11 - Phase 3: Tester round (encoding tests, live devnet smoke, audit record)

Scope: independent re-execution of the Phase 3 verification commands, closure of the routed Medium coverage gap (offline instruction encoding for the devnet client), the first live devnet smoke of the Phase 3 clients, and the npm audit record. Program source (Rust) was not touched this phase, so no cargo or anchor build command was run and the Phase 2 roster of 32 Rust tests stands as recorded above.

### Suite results (all re-run by the tester)

| Suite | Command | Result |
|-------|---------|--------|
| Vitest (app) | `cd app && npm test` | PASS: 11 files, 144 tests (136 baseline after the fix round, plus 8 new encoding tests) |
| Type check (app) | `cd app && npx tsc --noEmit` | PASS (strict mode, exit 0) |
| Production build | `cd app && npm run build` | PASS (tsc + vite, exit 0) |
| Type check (scripts) | `npm run typecheck` at repo root | PASS (exit 0; now covers `scripts/smoke-phase3.ts` plus its app/src imports) |
| npm audit (app) | `cd app && npm audit` | 12 vulnerabilities (7 moderate, 5 high); see the audit note below |
| Rust suites | not rerun | program source untouched this phase; Phase 2 artifact caveat still applies |

### Routed gap status from docs/reviews.md Phase 3

| Routed item | Status |
|-------------|--------|
| Medium: instruction encoding path untested (code review) | CLOSED by the 8 new encoding tests below |
| Low: mock zero clock isolation and overstated comment (code review) | CLOSED in the fix round: `rejects start_race on a fully funded lane while the clock is zero` (release_leg1 at time 0 stays unreachable behind the status guard, which the test documents) |
| Low: anchorFlow transport error propagation unpinned (code review) | CLOSED in the fix round: `propagates transport failures instead of reporting an invalid chain` |
| Low: caret ranges on signing path packages (code review and security review) | CLOSED in the fix round: `@anchor-lang/core`, `@solana/web3.js`, and `@solana/spl-token` are exact pinned in app/package.json |
| Low: evidence signature shape validation, retry and batch bounds (security review) | CLOSED in the fix round: 5 tests under `fetchEvidence: input validation and bounds` |
| Info: formatTxError bare message for plain Errors (code review) | Left open (optional, marked "optionally" in the review) |

### New tests (8 in app/src/lib/__tests__/encoding.test.ts)

Harness: the file intercepts `AnchorProvider.prototype.sendAndConfirm` in `beforeAll` and restores it in `afterAll`, so every client method runs its real builder path (`methods.<ix>()`, `accountsStrict`, `remainingAccounts`, then the BorshInstructionCoder encode inside the transaction factory) and the assembled `TransactionInstruction` is captured instead of sent. No network, no mocked coder. Discriminators are recomputed in the test from `sha256("global:<snake_case_name>")` first 8 bytes (node:crypto), and a separate check pins the committed IDL's stored discriminators against the same computation, so neither side is trusted.

| Test | Verdict | Notes |
|------|---------|-------|
| discriminators for every capture plus all twelve IDL names covered | PASS | 16 captures mapped onto 12 distinct snake case names, set compared against the IDL instruction list, program id asserted per instruction |
| initialize_scenario account order and flags | PASS | 10 keys exactly as anchorClient builds them: scenario, driver, usd mint, cad mint, vault usd, vault cad, token program, system program, then the two remaining party accounts read only and non signer; flag matrix asserted |
| initialize_scenario data layout | PASS | 72 bytes: discriminator, scenario_id 0x1122334455667788 as 8 byte LE (proves width and order), ticket hash verbatim at bytes 16 to 48, both notionals u64 LE, gap_ms 86400000 as i64 LE |
| fund_leg both leg variants | PASS | leg discriminant { leg1Usd: {} } to 0 and { leg2Cad: {} } to 1, amount u64 LE, 17 byte payload, per signer ATA and vault key order for both legs |
| start_race both path variants | PASS | { sequential: {} } to 0, { atomic: {} } to 1, 9 byte payload, keys scenario plus driver for both lanes |
| settle_atomic account order and flags | PASS | scenario, driver, vault usd, vault cad, party B USD ATA, party A CAD ATA, token program; bare discriminator payload; driver is signer but read only, matching the Rust `mut` set (only scenario is mut) |
| no argument instructions | PASS | acknowledge (both parties), release_leg1, release_leg2, declare_default each carry exactly the 8 byte discriminator with the role correct key order |
| advance_clock, release_leg2_partial, mark_failed, anchor_chain_head args | PASS | i64 LE clock stamp, u64 LE partial amount, mark_failed u32 LE length plus UTF-8 with the empty default (12 bytes), anchor payload discriminator plus 32 byte hash plus u64 count plus i64 stamp (56 bytes) |

The harness correction during this round: the first draft expected the settle_atomic driver account to be writable; the IDL and the Rust source both keep it read only, so the assertion was updated to pin the actual shape (test file only, no source change).

### Live devnet smoke (scripts/smoke-phase3.ts, run with `npx tsx`)

Two runs were executed against `https://api.devnet.solana.com` with the program at 4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3. Party A (provider wallet, fee payer) and party B come from scripts/devnet-keypairs.json (mode 600, secrets never printed); the driver is the CLI wallet from `~/.config/solana/id.json` and pays the init rents. Run 1 completed the sequential lane, the anchor, and the evidence phase, then crashed on an escaped websocket 429 while starting the atomic lane (see finding S2); its sequential lane settled at scenario id 7100 and spent 0.01076 SOL. Run 2, with step pacing and process level fault handlers added, completed everything and is the recorded result below.

Run 2 preflight: program executable, driver 1.44743 SOL, party A 0.99079 SOL, party B 0.99091 SOL, party A USD 900000 cents, party B CAD 1220000 cents (both reduced by run 1, so the balances prove run 1's token movements too). Scenario id 7101 at `7fsY4iaLcasjGvF7pfAHtgsSYQCdSfa5VU6sp5d5y3vs`.

Honest sequential flow (12 transactions, order: init, advance, ack A, ack B, fund USD, fund CAD, start, advance, release leg 1, advance past gap, release leg 2, plus the anchor):

| Step | Signature |
|------|-----------|
| init_scenario | 5XQ8HLAffUa1EWF6xFSQXz1CUewFz6PDhW26f8qsR2xmRSijpNuwkidheL3ccB8JxMJBfJeugLaUJ6yNtCnDXdmr |
| advance_clock | 5aZhsU1cH2FVZrxYemQ7GPUhQJtiPDGaPFxNtaxFJuFs3WTmfeKTHp8XCjSbdHvcrNZy1HYwyjeNyvmGVfR6X5gb |
| ack_a | 1LaPat1e1ETXW4znGqfQJQid6JjD8h5JPq1f4AU1WJsqQZFA1RJf5qoSxmt87A2MPBsxqiXJuMzbjRauCC5kKki |
| ack_b | 5rSbeLdjiLx3uVqKjQfR2vC76jctiBFSd9aSVQs3Lpse3v6CzSrBaQ9PNBS6mUWeERhN14shWauuLRCGK5Y2oen4 |
| fund_leg_usd | 5XUgjh82PenHNJTcMCgjAUpsAUgeJeEcL7o7MM2ScvvJPRiWHAW9nKRshnyQonFJyT1PnMmgsaLtjbcPUKCx69Hx |
| fund_leg_cad | Ci6m3q741iXHoqnar847i9k5cCzMs1zruUENzozPhHQZ6GzxhdXzfet6a2tT7kSo8rH4vYzy9RSFUc73x1UtCTh |
| start_race | 2fqidcc6JQRaVpSqRrpsgcxceqQP5T2YN7ak9C3gJmSe1aovvaj2y9sc6G4xiMXsEbBJNjpvxuSJZiyxrZz59MaX |
| advance_clock | 4oyG1ooAKGC5ns3C4j4XwT2xQR8JyKyFiS7ktvcbn8MQwDa9uqBhWVJVwmmjkfKVK2e9X2KWFRJW5FNWSeh2brJc |
| release_leg1 | 4Y6vC8opiNvk8LVNrXbTFoiVYt9HeKgMmngMFXBwsJTbC6ZW3pPzSfUkKqEpqgFxjA4FCfRSfWzQPihv8fEPKBZF |
| advance_clock | NYrmqELsXBPWFa2YP2iSDiRq6BWMHsQRJKTRk2kGeUMdqC5CRLP2NswsQW4AVDghAPUtqXnWuLx6FpJt7mGb4g5 |
| release_leg2 | 44fxd9VrVqDVcWXfBKLZeQQPF1SjFsN32fXMBunaMQoscXypnF8q5YZg7MDNwDHMp3f6aEkgJzbTiUr9RUDhS4JU |
| anchor_chain_head | cuHtAojMqiHTByDjRR6Fvypcr56LGAPQfG1tRDLnYYHetZLugTgkFtEYgWeNuWdeptrJ9qZBFRvw9gcoUicVmbw |

Final states and verification:

- Sequential lane: `fetchScenario` returned status SETTLED with `paid_cad_cents` 130000 equal to `leg2_cad_cents` 130000 (integer cents, amounts 100000 USD and 130000 CAD, gap 5000 ms).
- Provenance chain: 8 records (TICKET_CREATED with null signature, ACK_A, ACK_B, LEG_FUNDED twice, RACE_STARTED, LEG1_RELEASED, LEG2_RELEASED, each with its captured signature), self verified, head `7f3b88709b690894d14770bc4601e728e32c9f1e0dbbae8629e6f0def86e1329`. CHAIN_ANCHORED was excluded before anchoring as specified.
- `anchorTerminalChain` landed, `fetchChainHead` returned the same head with `event_count` 8, and `verifyAgainstChainHead` returned `valid: true`, `head_match: true`, `event_count_match: true`.
- Evidence: `fetchEvidence` on 4 signatures (init, fund USD, release leg 1, anchor) returned 4/4 `fetched_ok`, 4/4 `program_id_match`, 4/4 `success`.
- Atomic lane: 8 transactions (init at scenario id 7300, advance, ack A, ack B, fund USD, fund CAD, start, settle_atomic) ending in status SETTLED with `paid_cad_cents` 0, as the atomic path never touches sequential paid progress.
- SOL spent in run 2: 0.01082 (wallets 3.42913 to 3.41831), well under the 0.05 SOL budget; cumulative across both runs about 0.0216 SOL, also under 0.05. The script prints a compact PASS/FAIL summary and exits 0 on PASS.

Run 1 note: the first run's sequential lane (scenario id 7100) also settled with paid 130000 and its anchor verified `valid: true`, so the client path was proven twice; only the atomic phase of run 1 was lost to finding S2.

### Final Phase 3 roster (supersedes the 127 count in the earlier Phase 3 entry)

- Vitest: 144 tests in 11 files. Composition: 127 recorded in the Phase 3 entry above, plus 9 from the fix round (5 evidence input validation and bounds tests, 2 anchorClient typed error code tests, the mock zero clock test, and the anchorFlow transport propagation test), plus 8 encoding tests from this round.
- Rust: 32 (27 LiteSVM integration plus 5 schema units), unchanged and not rerun this phase.
- Repository total: 176 tests, all passing.

### npm audit note (app workspace)

`npm audit` reports 12 vulnerabilities, 7 moderate and 5 high, all in transitive dependencies reached through `@anchor-lang/core`, `@solana/web3.js`, and `@solana/spl-token`: the advisory leaves are toml (TOML parsing, high), bigint-buffer (buffer to BigInt conversion, high), stream-json (JSON streaming, moderate), and uuid (identifier generation, moderate), with no advisory in the transaction signing or signature verification path (both run through tweetnacl, which is unaffected). No non breaking fix exists: `npm audit fix --force` would install `@anchor-lang/core@0.0.0` and `@solana/web3.js@3.2.1`, breaking the pinned client API, so the advisories are accepted for this devnet demo context (play money only, no real funds, no user supplied parsing input). Recorded rather than fixed; revisit if the app ever parses untrusted TOML or streams untrusted JSON.

### Findings (no program or client source was modified)

- S1 (flow note, not a bug): `start_race` requires `virtual_now_ms > 0` (start_race.rs:36, pinned by `guard_zero_virtual_time_rejects_start_and_leg1_release`), so the smoke moves the clock with advanceClock before start_race. The prescribed order (init, acks, funds, start, advance, release1, advance, release2) would fail start_race with BadState at time 0; the executed order inserts one advance before the start and otherwise follows the prescription. release_leg2 has no gap deadline, so releasing after the gap expiry still settles, as the Phase 2 late payment test already pinned.
- S2 (robustness observation, reported not fixed): `@anchor-lang/core`'s `sendAndConfirm` copy calls `connection.confirmTransaction(signature, commitment)` without a blockhash strategy whenever the provider options carry no blockhash, which makes web3.js confirm over a websocket subscription. Under devnet rate limiting, a websocket rejection can escape the await chain and become an uncaught exception (run 1 died this way between the evidence and atomic phases). The smoke script now paces transactions by 400 ms, retries only clear rate limit errors inside `must` and `mustFetch`, and installs `uncaughtException` and `unhandledRejection` handlers that print whatever completed and report PARTIAL for network shaped faults instead of crashing. A future hardening for anchorClient (pass a blockhash confirmation strategy) is available if the orchestrator wants it routed; no source change was made this phase.
- S3 (observation): the repo carries two physical installs of `@solana/web3.js` (root for scripts, app for the frontend), both 1.99.0. Cross instance objects are compatible here because the web3 APIs used are duck typed (`equals` compares `_bn`, PDA derivation reads bytes) and our transactions are legacy, which keeps evidence fetches on the parsed path where program ids are rendered with `toString`. The only `instanceof PublicKey` branch in evidence.ts (keyToString) would miss a foreign instance, but it is reached only for compiled v0 messages with object account keys, which this app never produces. Worth knowing before a script sends versioned transactions.
- No program or client bug found: all twelve instructions encoded correctly offline and all twenty live transactions landed with the expected state transitions on the first run and the second.

### How to run

```bash
cd app && npm test          # 144 tests, 11 files
cd app && npx tsc --noEmit  # strict type check
cd app && npm run build     # tsc + vite production build
npm run typecheck           # repo root, covers scripts/
npx tsx scripts/smoke-phase3.ts   # live devnet smoke (spends SOL, prints a summary)
```

### Recurring patterns for other agents (additions)

- The smoke script's free scenario id scan (base 7100 for sequential, 7300 for atomic) makes reruns safe against already used PDAs; scenario PDAs are seeded by driver plus id, so only the CLI driver's history matters.
- web3.js websocket errors during confirmation can arrive outside the promise chain; scripts that must report honestly should install process level handlers in addition to try catch, and pace sends to stay under the public devnet rate limit (400 ms per step eliminated all 429s in run 2).
- The zero time precondition of start_race means any end to end flow needs an advanceClock before the first start_race, even when the surrounding scenario never mentions the clock.
- Smoke token amounts were chosen at 100000/130000 integer cents (the Rust suite's values) rather than the UI's 1000000/1350000, because the devnet accounts hold exactly one UI sized lane; two lanes at the UI size would exceed party A's USD balance with the faucet closed.

## 2026-11-12 - Phase 4: Tester round (suite verification, coverage gap tests, build and dist evidence)

Scope: independent re-execution of the Phase 4 verification commands, closure of the coverage gaps routed by the Phase 4 code review and security review (and their two re-reviews) in docs/reviews.md, and a manual double run of scripts/setup-devnet.ts for the driver top-up guard. Test code only: no source file under app/src, scripts/, or programs/ was modified, and no cargo or anchor command was run (Rust untouched this phase).

### Suite results (all re-run by the tester)

| Suite | Command | Result |
|-------|---------|--------|
| Vitest (app) | `cd app && npm test` | PASS: 23 files, 263 tests (247 baseline after the two fix rounds, plus 16 new below) |
| Type check (app) | `cd app && npx tsc --noEmit` | PASS (strict mode, exit 0) |
| Type check (repo root) | `npx tsc --noEmit` at repo root (same as `npm run typecheck`) | PASS (exit 0) |
| Production build | `cd app && npm run build` | PASS (tsc + vite, exit 0) with the expected demo-accounts exclusion warning; see dist evidence below |
| npm audit (app) | `cd app && npm audit` | 12 vulnerabilities (7 moderate, 5 high), unchanged; see the npm audit note from the Phase 3 tester round |
| Rust suites | not rerun | program source untouched this phase; Phase 2 roster of 32 stands |

### New tests (16 added across 5 files, all PASS)

| Test file | Test | Verdict | Notes |
|-----------|------|---------|-------|
| `src/lib/__tests__/raceSourceIdBase.test.ts` (new) | formula returns `((now mod 1e6) * 2 + 1)` exactly on a fresh session | PASS | `1_700_000_123_456` to `246_913`, odd; fresh module per case via `vi.resetModules` because the base is module scoped state |
| same | formula is odd and exact at the modulus boundaries | PASS | `0`, `1`, `999_999`, `1_000_000`, `2_500_000_999_999` each to the exact expected odd base |
| same | never hands out the same base twice in one session | PASS | repeat steps `+2`, an earlier timestamp also steps `+2` above the last base (session monotonic guard) |
| `src/lib/__tests__/raceSource.test.ts` | never overlaps lane ids across two consecutive runs when the probe reports every PDA free | PASS | probe mocked returning null; two runs yield `[s1, a1, s2, a2]` with `a1 = s1+1`, `a2 = s2+1`, and `s2 > a1` (strict non-collision); probe consulted at least 4 times |
| `src/engine/__tests__/scenarioEngine.test.ts` | skips the anchor phase entirely when `anchor_head` is false | PASS | no `CHAIN_ANCHORED` event, `anchorChainHead` spy never called, local chain still verifies, `fetchChainHead` finds no stored head |
| same | throws an unfair start error when the lane notionals diverge | PASS | `fetchScenario` wrapper reports `leg2_cad_cents + 1n` on the atomic lane; run rejects with `ScenarioEngine: unfair start: leg2_cad_cents` (first real negative test of the fairness assert) |
| same | throws with the failing label when a client transaction fails | PASS | `initScenario` returns `BadState`; run rejects with `ScenarioEngine: initialize sequential lane failed: BadState: ...` and yields zero events |
| `src/components/__tests__/racePanelProps.test.tsx` (new) | disconnected default copy, disabled Run, pending chain pill | PASS | SSR markup via `react-dom/server` (existing dependency; no DOM testing library added) |
| same | supplied notice replaces the default copy while disconnected | PASS | `role="note"` branch pinned; default copy absent |
| same | live drops the disconnected copy and gates Run on a selected scenario | PASS | run hint flips to `Choose a scenario first`; `role="alert"` branch pinned for a live failure notice |
| same | live with no notice renders neither notice block | PASS | no `race-disconnected` and no `race-notice` elements |
| same | `chainStatus` passes through to pill wording and class | PASS | `VALID` to `chain-pill-valid` / `chain valid`, `BROKEN` to `chain-pill-broken` / `chain broken` |
| same | live plus a scenario prop enables Run and marks the card selected | PASS | Run button has no `disabled` attribute; exactly the selected picker card class appears |
| `src/__tests__/viteExcludeDemoAccounts.test.ts` (new) | plugin is registered and applied to build only | PASS | name `exclude-demo-accounts`, `apply: "build"`, plain `closeBundle` function |
| same | removes a planted `dist/demo-accounts.json` and warns, leaving other dist entries untouched | PASS | plants one file at the guarded path, runs the hook, asserts the file is gone, the dist entry list is byte for byte the pre-plant list, and `console.warn` carries `demo-accounts.json excluded from dist` plus `devnet demo keys` |
| same | still emits the exclusion warning when the file is absent | PASS | warning fires on every build, file absent or not (one call, same text) |

Baseline before this round: 247 tests in 20 files. Final: 263 tests in 23 files (16 new: 3 in one new pure file, 6 in one new component contract file, 3 in one new build guard file, plus 1 and 3 added to existing files).

### Routed gap status from docs/reviews.md Phase 4

| Routed item | Status |
|-------------|--------|
| Code review Medium: raceTiming speed-change monotonicity | Already closed in the fix round (`rescaleWallMs` plus 4 test groups); not re-tested this round |
| Code review Low: `demoAccounts` bad_pubkey cross-check | CONFIRMED present: 3 tests in `demoAccounts.test.ts` (mismatched base58 pair, mismatched number array pair, matching pair), each asserting no secret in the message |
| Code review Info: `scenario_id_base` probe and formula notes | CLOSED by the 4 new raceSource tests above (exact formula, boundaries, session monotonicity, two-run non-collision with a mocked probe) |
| Code review Info: race UI display monotonicity and other UI checks | Already covered by `raceTiming.test.ts`, `panelMaxWidth.test.ts`, `raceLabels.test.ts`, `raceBalances.test.ts`; RacePanel props contract added above |
| Code review Low: `anchorClient` blockhash pairing and commitment level | CONFIRMED present: `anchorClient.test.ts` has `reads the blockhash and confirms at the client's configured commitment` (same level on read and confirm) plus the strategy pairing test |
| Security review Medium: dist ships `demo-accounts.json` | CLOSED: build-only plugin unit tested above plus real build evidence below |
| Security review Medium: dev-server CORS | Fix verified in the security re-review (`server.cors: false`); no test seam exists without starting a server, left as static evidence |
| Security review Low: smoke keypair chmod | Fixed and verified in the security re-review; not re-tested here |
| Security review Low: driver top-up cumulative guard | Verified by manual double run below (not unit testable: `fundDriver` is not exported and importing the script runs `main()` unconditionally at setup-devnet.ts:950) |

### Build and dist evidence (demo-accounts exclusion)

- `cd app && npm run build` exits 0 and prints, after the bundle report: `demo-accounts.json excluded from dist (contains devnet demo keys); run the app with npm run dev after npx tsx scripts/setup-devnet.ts`
- `ls app/dist` after the build: `assets` and `index.html` only. `app/dist/demo-accounts.json` does not exist (verified with `ls`, exit 1 for that path).
- `app/public/demo-accounts.json` is still on disk (the dev server needs it) with mode `600`, before and after the setup script re-ran.
- The unit test plants the guarded path, proves the hook removes it while every other dist entry survives, and restores the pre-test state; it never runs concurrently with a build (vitest and `npm run build` are separate commands), so a real dist cannot be nuked mid-build.

### setup-devnet driver top-up guard: manual double run

`npx tsx scripts/setup-devnet.ts` was executed twice against devnet (no `--reset`, nothing drained):

| Run | Exit | Driver line observed |
|-----|------|----------------------|
| 1 | 0 | `demo driver A5LmqPKK7aVTkh7bHAWvNosj6MBNCjW6eiAHAcyuGYDL already holds 0.239357400 SOL` (skip, no transfer) |
| 2 | 0 | identical line and identical balance (skip, no transfer) |

Both runs also reported the parties already funded (0.990408820 and 0.990908820 SOL), mints reused, and all four token balances already at target (nothing minted). The fresh-run threshold (`DRIVER_MIN_LAMPORTS`, 0.05 SOL) correctly skipped in both processes; the in-run repeat threshold (`DRIVER_TOPPED_LAMPORTS`, 0.1 SOL, setup-devnet.ts:598-617) is not observable from the CLI because `fundDriver` is called exactly once per process (main, setup-devnet.ts:806), so it rests on the static evidence in the security fix round re-verification. Unit testing the guard would require exporting `fundDriver` (a source change) or importing the script, which triggers `main()`; both were out of scope for this test-only round.

### Live smoke reference (Phase 4 wiring, reported by the orchestrator)

The Phase 4 wiring smoke run recorded 20 transactions, both lanes `SETTLED`, chain verification `VALID`, and 0.01084 SOL spent. This round did not re-run the live smoke (the tester round only re-ran offline commands plus the two idempotent setup runs above); the figure is cited from the Phase 4 wiring report.

### Final Phase 4 roster (supersedes the 247 count)

- Vitest: 263 tests in 23 files. Composition: 247 passing tests in 20 files after the two Phase 4 fix rounds, plus 16 tests added in this round (12 tests in 3 new files, 4 tests in 2 existing files).
- Rust: 32 (27 LiteSVM integration plus 5 schema units), unchanged and not rerun this phase.
- Repository total: 295 tests, all passing (Vitest 263 re-executed; Rust roster cited from Phase 2).

### Findings (no source code was modified)

- No bug found. Every routed gap item behaved as specified: the formula base is exactly `((now mod 1e6) * 2 + 1)` and odd, consecutive runs cannot collide (session step of 2 plus the chain probe), the fairness assert really throws on a one cent notional mismatch, `anchor_head: false` skips the anchor phase completely, the build plugin removes the planted key file and warns, and the setup script skips the driver top-up idempotently across reruns.
- T1 (observation, pinned behavior not a bug): RacePanel's notice branch is `disconnected` to `role="note"` (default copy or supplied notice) and `live` with a notice to `role="alert"`; a disconnected panel never escalates to `role="alert"`. The first draft of the new contract test expected `role="alert"` while disconnected and failed; the assertion was corrected to pin the actual branch (test file only).
- T2 (judgment call): no DOM testing library exists (node environment, no jsdom, no testing-library), so RacePanel component tests were written as static markup assertions through `react-dom/server`'s `renderToStaticMarkup`, which is part of the already installed `react-dom`. No dependency was added and the environment stays DOM free; effects never run during server rendering, so the tests pin prop to markup mapping only (defaults, notice branching, run gating, chain pill passthrough) and leave interactive behavior to the pure `raceTiming` suites.
- T3 (testability note for a later phase): `scripts/setup-devnet.ts` exports only `writeDemoAccounts` and executes `main()` on import, so nothing in the driver or funding path is unit testable without a source change (an export or an `import.meta.url` entry guard). If Phase 5 or 6 wants unit coverage there, route an entry-guard refactor to backend-dev first.

### How to run

```bash
cd app && npm test          # 263 tests, 23 files
cd app && npx tsc --noEmit  # strict type check
cd app && npm run build     # tsc + vite; prints the demo-accounts exclusion warning
npx tsc --noEmit            # repo root, covers scripts/
npx tsx scripts/setup-devnet.ts   # devnet setup (idempotent; skips funded wallets)
```

### Recurring patterns for other agents (additions)

- Module scoped session state (like `lastScenarioIdBase`) cannot be tested for exact values from a shared static import; use a fresh module per case (`vi.resetModules` plus dynamic import) or a dedicated test file, and assert exact formula equality only on a fresh instance.
- Build plugins that guard a fixed path are still unit testable through the exported config object: find the plugin by `name` in `config.plugins`, drive its hook directly, plant exactly the one guarded path, and assert the rest of the output directory is untouched.
- Server rendering with `renderToStaticMarkup` pins prop to markup contracts in a node test environment without adding a DOM library; effects do not run, so keep such tests to static mapping and leave interaction to pure logic suites.
- Scripts that run `main()` at import time are untestable by design; the honest options are a manual run (as done here) or an entry guard refactor, and docs/tests.md should record which one was chosen.

## 2026-11-12 - Phase 5: Tester round (suite verification, panelMaxWidth pin extension, citation spot check)

Scope: independent execution of the Phase 5 verification commands, closure of the Low test pin gap routed by the Phase 5 slice 1 code review in docs/reviews.md, and a factual spot check of the Mariana qualifier fix. Rust untouched this phase, so no cargo or anchor command was run; the Phase 2 roster of 32 Rust tests stands as recorded above. Screenshots are intentionally out of scope for this round: the user captures them manually per docs/screenshots/README.md, and no docs/screenshots content was reviewed or tested.

Pre-run state check: `git status --porcelain` showed only the orchestrator's Phase 5 slice 1 changes (app/src/App.tsx, docs/architecture.md, docs/research.md, docs/reviews.md modified; README.md, app/src/components/learn/, app/src/styles/learn.css, docs/screenshots/ untracked) and no partial test edits from the previously interrupted tester session.

### Suite results (all executed by the tester)

| Suite | Command | Result |
|-------|---------|--------|
| Vitest (app) | `cd app && npm test` | PASS: 24 files, 268 tests in the pre-edit run, 269 after the pin extension below (all green in both runs) |
| Type check (app) | `cd app && npx tsc --noEmit` | PASS (strict mode, exit 0; re-run after the test edit, still exit 0) |
| Type check (repo root) | `npx tsc --noEmit` at repo root | PASS (exit 0) |
| Production build | `cd app && npm run build` | PASS (tsc + vite, exit 0) with the expected `demo-accounts.json excluded from dist` warning; see the observation under Findings |
| Rust suites | not rerun | program source untouched this phase; Phase 2 roster of 32 stands |

### Routed gap status from docs/reviews.md Phase 5 slice 1

| Routed item | Status |
|-------------|--------|
| Low: panelMaxWidth pins .panel-race but not .panel-learn; title "for the race panel only" stale | CLOSED by the pin extension below |
| Low: Mariana claim dropped the "hypothetical" qualifier | FIXED by backend-dev before this round; verified by the spot check below |
| Info: README cites 268 tests but tests.md has no Phase 5 run yet | CLOSED by this entry (roster reconciliation below) |
| Info: architecture.md routes row lists stale tab names | documentation-owned; not testable here |
| Info: README Phase 6 wording vs AGENTS.md status cell | documentation-owned; not testable here |
| Info: docs/screenshots/README.md placeholder wording | documentation-owned; screenshots deferred to manual capture by design |
| Security Low: Citations.tsx raw href scheme allowlist | deferred by the security review (static https data today); no test seam beyond the existing static URL assertions |

### panelMaxWidth pin extension (app/src/styles/__tests__/panelMaxWidth.test.ts)

- Added a `learnCss` read of `../learn.css` and a fourth test: the `.panel-learn` rule must set `--panel-max: 66rem` (learn.css:17) with no competing `max-width` inside the same rule block, mirroring the existing `.panel-race` 78rem pin.
- Retitled the modifier test to "sets the override on the race modifier, not a competing declaration" and the pairing test from "for the race panel only" to "for the race and learn panels". The pairing test now also asserts `"panel panel-learn"` appears in App.tsx (App.tsx:129 pairs `panel` with `panel-learn` on the learn tab), alongside the untouched `'"panel panel-race"'` and `': "panel"}'` assertions.
- The file docstring now describes both modifiers. All three pre-existing assertions were kept byte for byte and stay green.
- Result: the file holds 4 tests (was 3); full suite 269 tests in 24 files, all pass.

### Citation spot check (Phase 5 slice 1 code review factual flag)

- Literal grep for `hypothetical wholesale CBDC setup aiming at` in `app/src/components/learn/learnContent.ts` matches exactly one line, learnContent.ts:224: "BIS Project Mariana concluded in 2024 after testing a hypothetical wholesale CBDC setup aiming at atomic PvP settlement on a public blockchain [37]...". Both the `hypothetical` qualifier and the `aiming at` hedge survive the copy fix.
- Citation tokens `[37]` and `[38]` are intact in that same string; `[38]` carries the BIS 2024 survey 77 and 71 percent sentence. The review's factual spot-check holds after the fix.

### Final Phase 5 roster (reconciles README's cited 268)

- Vitest: 269 tests in 24 files. Composition: README.md:75's cited 268 (the Phase 4 final roster of 263 plus the 5 new learnPanel content tests) plus 1 test added in this round (the `.panel-learn` pin above). Both runs passed: 268 in 24 files before the edit, 269 in 24 files after.
- README.md:75 now reads one test low against tests.md; the next documentation pass should bump the cited figure to 269. This round was test-only, so README was not edited (routed as an Info in the Phase 5 code review).
- Rust: 32 (27 LiteSVM integration plus 5 schema units), unchanged and not rerun this phase.
- Repository total: 301 tests, all passing (Vitest 269 re-executed this round; Rust roster cited from Phase 2).

### Findings

- No failure: every command passed on the first attempt, and no assertion needed correction during this round.
- Observation (pre-existing, not a Phase 5 regression): `npm run build` prints two `rolldown:vite-resolve` notes about externalizing `fs` and `process` from `@anchor-lang/core/dist/browser/index.js`, plus a chunk-size warning for the 794.87 kB bundle. All are non-fatal and unrelated to the learn slice; the only documented guard warning remains the `demo-accounts.json excluded from dist` line.

### How to run

```bash
cd app && npm test          # 269 tests, 24 files
cd app && npx tsc --noEmit  # strict type check
cd app && npm run build     # tsc + vite; prints the demo-accounts exclusion warning
npx tsc --noEmit            # repo root, covers scripts/
```

### Recurring patterns for other agents (additions)

- When a second panel modifier copies the `--panel-max` pattern, extend `panelMaxWidth.test.ts` in the same slice: read the new stylesheet, pin the exact rem value inside the modifier rule block, assert no `max-width` in that block, and assert the App.tsx class pairing string. Doing it in-slice avoids the follow-up routing this round closed.
- Qualifier restorations in sourced copy (`hypothetical`, `aiming at`) are verifiable with a literal string grep against the research wording; record the exact matched line so a later rewrite cannot silently drop the hedge again.
- README roster claims and the tests.md entry that records the run should land together; when they cannot, tests.md must state the arithmetic (cited figure plus this round's delta) so the reconciliation is explicit rather than a silent drift.

## 2026-11-12 - Phase 6: Final tester round (suite verification, vite test isolation fix, offline scenario coverage)

Scope: final verification round for Phase 6. Independent execution of the Phase 6 verification commands, closure of the Security Low routed in docs/reviews.md (default-outDir cases in the vite exclusion test planting files in the real app/dist tree), and a permanent vitest pin for the five offline scenarios through `createRaceSource({mode: "offline"})`. Rust untouched this round: no cargo or anchor command was run, and the Phase 2 roster of 32 Rust tests stands as recorded above. Screenshots are out of scope by design (the user captures them manually).

### Suite results (all executed by the tester)

| Suite | Command | Result |
|-------|---------|--------|
| Vitest (app) | `cd app && npm test` | PASS: 26 files, 333 tests before this round's edits, 338 after (5 new offline tests below) |
| Type check (app) | `cd app && npx tsc --noEmit` | PASS (strict mode, exit 0; re-run after the test edits, still exit 0) |
| Type check (repo root) | `npx tsc --noEmit` at repo root | PASS (exit 0) |
| Production build | `cd app && npm run build` | PASS (tsc + vite, exit 0) with the expected `demo-accounts.json excluded from dist` warning; chunk summary below |
| Dash sweep | grep for em dash, en dash, and `--` over README.md and the Phase 6 files (provenance/, tickets/, raceSource.ts, vite.config.ts, the vite exclusion test) | PASS: no prose dashes; every `--` hit is a CLI flag (`--reset`, `--manifest-path`, `--outDir`, `--topup`) or a markdown table rule |
| Rust suites | not rerun | program source untouched this phase; Phase 2 roster of 32 stands |

### Security Low fix: vite exclusion test no longer touches the real dist (app/src/__tests__/viteExcludeDemoAccounts.test.ts)

The Phase 6 security review (docs/reviews.md) flagged that the default-outDir cases planted and removed `dist/demo-accounts.json` inside the real app/dist tree, so a vitest run overlapping a real vite build could delete the build's freshly copied key file mid-build. Fixed this round:

- Both default-outDir cases (`removes a planted dist/demo-accounts.json...` and `still emits the exclusion warning when the file is absent`) now create a fresh mkdtemp root with a `dist` stand-in directory seeded with `index.html` and `assets/app.js` siblings, and point the plugin at it through the same `configResolved` outDir seam the custom-outDir case already used (`{root: tmpRoot, build: {outDir: "dist"}}`).
- The custom-outDir case's default-dist decoy now plants `tmpRoot/dist/demo-accounts.json` under the same temp root instead of the real `app/dist/demo-accounts.json`; its assertions are unchanged in meaning (custom outDir file removed, custom sibling survives, default-dist file survives).
- Assertions kept equivalent: removal happens, siblings survive byte for byte, both warn strings still fire, and the absent-file case still warns exactly once. Temp roots are removed with `rmSync(..., {recursive, force})` in each case's `finally`; `afterEach` still resets the shared plugin instance to the default outDir and restores spies. The real `app/dist` path is no longer referenced by any test (the `distDir`/`plantedPath` constants and the backup/restore logic were removed with it).
- Suite result: the file holds 4 tests (unchanged count), all pass; full suite 338 tests in 26 files.

### Offline mode coverage (app/src/lib/__tests__/raceSource.test.ts)

Pre-existing coverage ran only the `honest` spec through `createRaceSource({mode: "offline"})` (full run with `chain_ok: true`, plus the live-seam throw guards); all five specs were covered only at the `MockProgramClient` level (`mockClient.test.ts` `it.each(SCENARIOS)`). This round added a permanent `it.each(SCENARIOS)` block in the offline describe: each of the five specs runs through `createRaceSource({mode: "offline"})` and must return `chain_ok: true` with no error, exercising the offline source dispatch, the fresh mock client, and the offline anchor verifier together. Result: 5 new tests, all pass; the offline spot-run claim is now pinned in the suite rather than resting on a one-off tsx smoke.

### Final Phase 6 roster (supersedes the 331 static count in the Phase 6 code review)

- Vitest: 338 tests in 26 files. Composition: 333 passing tests after the ATOMIC_REVERTED fix (the Phase 6 code review's static count of 331 plus the fix round's delta), plus 5 offline scenario tests added in this round. The vite test fix changed assertions but not test counts.
- Rust: 32 (27 LiteSVM integration plus 5 schema units), unchanged and not rerun this phase.
- Repository total: 370 tests, all passing (Vitest 338 re-executed this round; Rust roster cited from Phase 2).

### Build chunk summary (Phase 6 lazy loading)

| Asset | Size | Gzip |
|-------|------|------|
| `dist/index.html` | 0.92 kB | 0.48 kB |
| `index-DJlvEoef.css` | 20.55 kB | 3.80 kB |
| `index-DJlvEoef.js` (entry, static: RacePanel + wallet) | 782.74 kB | 229.14 kB |
| `LearnPanel` lazy chunk (JS) | 28.21 kB | 10.00 kB |
| `ProvenancePanel` lazy chunk (JS) | 19.41 kB | 5.86 kB |
| `TicketsPanel` lazy chunk (JS) | 14.37 kB | 4.62 kB |
| `CopyButton` lazy chunk (JS) | 0.81 kB | 0.45 kB |
| `LearnPanel` / `TicketsPanel` / `ProvenancePanel` CSS | 9.41 / 9.67 / 11.36 kB | 1.77 / 1.84 / 2.09 kB |

The three panels are code-split as designed; the entry chunk carries the anchor and wallet dependencies and still triggers vite's 500 kB advisory warning (pre-existing, recorded in the Phase 5 entry). The build prints the `demo-accounts.json excluded from dist` guard warning and `ls app/dist` after the build shows `assets` and `index.html` only.

### Findings

- No failure this round: all commands passed, and both test edits (the mkdtemp isolation fix and the offline `it.each`) passed on the first run after the edits.
- The Phase 6 code review's Low (ATOMIC_REVERTED display in laneLifecycle) was resolved by the fix round before this run (the 333 baseline includes it); not re-tested separately here because the ticketView end-state pins cover all five scenario terminals.

### How to run

```bash
cd app && npm test          # 338 tests, 26 files
cd app && npx tsc --noEmit  # strict type check
cd app && npm run build     # tsc + vite; prints the demo-accounts exclusion warning
npx tsc --noEmit            # repo root, covers scripts/
```

### Closing status

All 6 phases are code-complete pending final commit.
