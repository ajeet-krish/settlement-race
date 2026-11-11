# Settlement Race Decision Records

Last updated: 2026-11-11

## 2026-11-10 (Phase 1): Anchor framework over native Rust
**Context**: The program needs escrow vaults, PDA-signed token CPIs, and a small state machine, built in a 4 to 6 day budget.
**Decision**: Use Anchor 1.0.x for the settlement program.
**Rationale**: Declarative account constraints, generated IDL, and standard escrow CPI patterns cut build and audit time dramatically.
**Trade-offs**: Less control over compute and serialization; entirely acceptable for a devnet educational program.

## 2026-11-10 (Phase 1): Anchor 1.0 toolchain and TS package rename
**Context**: Anchor 1.0 (April 2026) renamed the TS package to @anchor-lang/core and targets Solana 3.x.
**Decision**: Pin Anchor 1.0.x via avm, Solana CLI 3.1.x, and import @anchor-lang/core in app code and tests.
**Rationale**: New workspace should start on the stable major, not the legacy @coral-xyz/anchor line.
**Trade-offs**: Most online tutorials reference old names; README must call out the rename.

## 2026-11-10 (Phase 1): Escrow PDA pre-funding with signature-gated leg 2
**Context**: Fairness requires identical balances and funding for both paths, yet the sequential path must still show a real default window.
**Decision**: Both parties pre-fund program vault PDAs; the atomic path releases both legs in one instruction; the sequential path releases legs in two instructions where leg 2 requires Party B's signature and declare_default returns unpaid CAD escrow to Party B after gap expiry.
**Rationale**: Identical starting state makes the race comparison honest, while a signature-gated second leg keeps a genuine counterparty failure mode (Party A paid out USD and is exposed).
**Trade-offs**: Default is modeled as signature refusal plus escrow reclamation, not raw non-payment; the UI and phase 5 explainer must state this explicitly.

## 2026-11-10 (Phase 1): Virtualized event clock as canonical time
**Context**: Real devnet latency is variable and would make race timelines and risk windows irreproducible.
**Decision**: A deterministic virtual clock (integer virtual milliseconds, monotonic, mirrored on-chain via advance_clock) is canonical for all race timing and gap checks; real block time and tx signatures are recorded as evidence only.
**Rationale**: Reproducible timelines, offline fixture mode, and stable demos depend on deterministic time.
**Trade-offs**: The virtual clock is driver-trusted and gameable; acceptable for play money on devnet, and labeled as a demo control in the UI.

## 2026-11-10 (Phase 1): On-chain chain-head anchoring for provenance
**Context**: A hash-chained log alone proves internal consistency but not existence at a point in time.
**Decision**: Hash-chain provenance records (sha256 over canonical JSON) with client-side verify, plus one devnet tx per scenario storing the final chain hash in a ChainHead PDA.
**Rationale**: The anchor converts self-verifiable history into real tamper evidence at negligible cost.
**Trade-offs**: One extra instruction per scenario and a finalization step before anchoring.

## 2026-11-10 (Phase 1): React + Vite + wallet-adapter over SolidJS and Kit
**Context**: The plan locks React + Vite with wallet-adapter; Solana docs now prefer @solana/kit for new apps.
**Decision**: Follow the lock: React 19 + Vite + strict TS with @solana/wallet-adapter-react; isolate wallet wiring in one hook for a future Kit migration.
**Rationale**: Wallet-adapter is mature, well documented, and matches the approved plan; migration risk is deferred, not ignored.
**Trade-offs**: Building on a legacy direction; accepted under the 4 to 6 day budget.

## 2026-11-10 (Phase 1): Scripted counterparty bot over two wallet sessions
**Context**: The demo must show Party B defaulting, paying late, and paying partially.
**Decision**: One browser drives both parties: the user wallet is Party A, an in-memory devnet keypair played by the scripted bot is Party B.
**Rationale**: Deterministic scenario playback, one-browser demo, no manual coordination.
**Trade-offs**: Party B custody is not wallet-realistic; the bot's keypair handling is clearly labeled devnet play money.

## 2026-11-10 (Phase 1): Integer cents money discipline
**Context**: FX amounts and rates invite floating point drift; JSON numbers are IEEE 754 in JS.
**Decision**: All money is integer cents (u64 in Rust, bigint in TS, decimal strings of cents in JSON); FX rate is an integer scaled by 1,000,000; no floats anywhere.
**Rationale**: Exact arithmetic, byte-stable fixtures, and honest money semantics.
**Trade-offs**: More verbose payloads and explicit conversions at display boundaries.

## 2026-11-10 (Phase 1): Legacy SPL Token mints with 2 decimals
**Context**: Tokenized USD and CAD legs need mint accounts on devnet.
**Decision**: Two legacy SPL Token mints (USD, CAD) with 2 decimals so base units equal cents; mint authority held by the setup script keypair.
**Rationale**: Maximum wallet and tooling compatibility; decimals match the integer-cent convention.
**Trade-offs**: No Token-2022 features (hooks, transfer fees); none are needed.

## 2026-11-10 (Phase 1): LiteSVM Rust suite behind anchor test
**Context**: anchor test must cover escrow invariants and the settlement state machine.
**Decision**: Integration tests in programs/settlement-race/tests/ on the anchor-litesvm crate, run by anchor test; pure state and money logic gets Rust unit tests; app logic gets Vitest suites including golden fixtures.
**Rationale**: LiteSVM is the current recommended Anchor harness: fast, deterministic, no validator boot.
**Trade-offs**: TS client glue is not exercised by anchor test; mitigated by Vitest coverage against the mock client and one devnet smoke script.

## 2026-11-10 (Phase 1): ProgramClient interface for offline fixture mode
**Context**: Phase 6 requires an offline fixture demo with zero code duplication.
**Decision**: Define a ProgramClient interface in app/src/lib/programClient.ts with an Anchor devnet implementation and a mock fixture implementation; the scenario engine, bot, and UI depend only on the interface.
**Rationale**: Offline mode becomes a dependency swap instead of a second app.
**Trade-offs**: Some interface discipline overhead from day one.

## 2026-11-10 (Phase 1): Canonical JSON hashing for tickets and records
**Context**: Hash chains require byte-stable serialization across browser and Node.
**Decision**: canonical JSON (keys sorted lexicographically, no whitespace, UTF-8) is the hash input for ticket_hash and provenance record hashes; genesis prev_hash is 64 hex zeros.
**Rationale**: Deterministic hashing independent of object key order and platform.
**Trade-offs**: Canonicalization bugs would break verification; locked by golden fixture tests in phase 1.

## 2026-11-10 (Phase 1): Anchor pinned to 1.2.2 with solana CLI 4.3.2 (supersedes toolchain record above)
**Context**: The original record assumed Anchor 1.0.x with Solana CLI 3.1.x, but the actual machine has solana CLI 4.3.2 (Agave) installed and the CLI was not to be downgraded. Code review flagged the drift.
**Decision**: Pin avm and anchor-cli to 1.2.2, anchor-lang and anchor-spl to 1.2.2 (same 1.x line, @anchor-lang/core rename still applies). The 1.2.2 crates depend on solana-* 3.x/4.x crates which cover the installed Agave 4.3.2 toolchain.
**Rationale**: Verified compatible: anchor build and cargo test-sbf both pass with zero warnings against the installed toolchain.
**Trade-offs**: The 1.0.x record above is retained as history; this record is authoritative for the pinned versions.

## 2026-11-11 (Phase 2): start_race funding gate is USD exact plus CAD nonzero
**Context**: The race start needs a symmetric commitment signal, but underfunded CAD is precisely the counterparty risk that the default, late payment, and partial payment scenarios must exercise.
**Decision**: start_race requires status Ack, funded_usd_cents == leg1_usd_cents exactly, and funded_cad_cents > 0 (not both legs exact). Full CAD enforcement lives in settle_atomic, which fails with InsufficientEscrow when either vault cannot cover its leg.
**Rationale**: Requiring exact CAD at start would make every underfunded scenario unstartable; the atomic path already re-checks both vaults at settlement time, so its safety does not depend on the start gate.
**Trade-offs**: start_race alone does not imply atomic settleability; the UI and Phase 5 explainer must present atomic readiness as a settlement time property, not a start state.

## 2026-11-11 (Phase 2): validateTicket accepts unknown keys
**Context**: validateTicket enforces schema version 1 field types, literals, and formats, but does not reject keys it does not recognize, and the review asked whether strict key rejection is needed now.
**Decision**: Unknown keys in validateTicket remain ACCEPTED. Canonical JSON includes them, so they are covered by the ticket hash. Strict key rejection is deferred to the Phase 5 paste-import tooling, where untrusted input actually arrives, and will be decided at that time.
**Rationale**: The hash already covers every present key, so an unknown key cannot change a hashed ticket undetected; current callers build tickets from known fields, and rejection only matters when a user pastes external JSON.
**Trade-offs**: A ticket carrying extra keys validates successfully today; hash integrity is unaffected, but a stricter schema check is postponed until the paste-import surface exists.

## 2026-11-11 (Phase 2): Driver-only orchestration matrix and escrow payout cap
**Context**: The security review found three Medium issues. First, anyone can donate SPL tokens straight into a vault PDA, and `release_leg2_partial` only capped payouts at `leg2_cad_cents - paid_cad_cents` and the live vault balance, so a donation let party B push `paid_cad_cents` above `funded_cad_cents`; `declare_default` then failed its `funded - paid` checked_sub with Overflow forever, permanently bricking the default path (the donation attack). Second, `start_race`, `advance_clock`, `release_leg1`, `declare_default`, and `settle_atomic` accepted any authorized signer, so a hostile counterparty could force the settlement route, drive the virtual clock (fast-forward past the gap window to trigger default instantly), and, by advancing to `i64::MAX` before the leg 1 stamp, make the deadline `checked_add` overflow so `declare_default` could never run (clock fast-forward and deadline brick vectors). This also contradicted the recorded driver-trusted clock decision and the docs that assign clock advancement to the driver.
**Decision**: Restrict `start_race`, `advance_clock`, `release_leg1`, `declare_default`, and `settle_atomic` to the driver (`require_keys_eq!(signer, scenario.driver)` -> `NotParty`), joining `initialize_scenario`, `mark_failed`, and `anchor_chain_head`; `acknowledge` and `fund_leg` remain party signers and `release_leg2` / `release_leg2_partial` remain party B only. Cap every sequential payout at `funded_cad_cents - paid_cad_cents` with checked_sub (`InsufficientEscrow` otherwise) in both `release_leg2` and `release_leg2_partial`, alongside the existing remaining-notional and vault-balance caps. Bound `advance_clock` so `to_virtual_ms <= i64::MAX - MAX_GAP_MS` (`BadState` otherwise), which guarantees `leg1_released_at_ms + gap_ms` can never overflow at `declare_default`.
**Rationale**: The engine (driver) orchestrates the race; parties only acknowledge, fund, and choose whether to pay leg 2, and that refusal choice is the counterparty risk the demo exists to show. Binding the full payout to recorded funding means a donation can only ever be a gift that sits in the vault (or is reclaimed at most up to `funded - paid`), never an over-payment that bricks the state machine. The clock bound closes the overflow brick while leaving the driver-trusted clock model intact: full release remains reachable exactly when the lane was fully funded, which is the honest and late-payment flow, and underfunded lanes use the partial release as designed.
**Trade-offs**: A counterparty can no longer self-serve any orchestration step, so a stalled engine (rather than a hostile party) now gates progress; acceptable for a demo where one wallet plays the engine. The path chosen at `start_race` is still not bound to `ticket_hash` on chain; path binding stays client-side via provenance, an accepted risk because an attacker gains nothing by mis-routing their own scenario. The `i64::MAX - MAX_GAP_MS` bound rejects absurd clock targets rather than saturating, and donated tokens remain locked in the vault with no sweep instruction (already documented as an Info finding).
