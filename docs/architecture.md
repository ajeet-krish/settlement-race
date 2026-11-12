# Settlement Race Architecture

Last updated: 2026-11-11 (Phase 3)

## Overview
Tokenized USD/CAD exchange on Solana devnet racing a sequential pay-first settlement path (controllable gap, counterparty default risk) against an atomic delivery-versus-payment path (both legs or neither), from one identical trade ticket, with integer-cent money, a deterministic virtual clock, and hash-chained provenance anchored on-chain.

## Phase Scope
Phase 1 scaffolds the Anchor workspace, freezes the trade ticket and provenance schemas, defines PDAs and instruction interfaces, and creates devnet setup scripts. Phases 2 to 6 implement program, provenance, race UI, education, and offline mode against these contracts.

## Component Breakdown
| Component | Responsibility | File |
|-----------|---------------|------|
| Anchor program | Escrow vaults, both settlement paths, virtual clock, chain-head anchor | programs/settlement-race/src/ |
| Program state | Scenario, ChainHead, RaceStatus, SettlementPath, Leg enums | programs/settlement-race/src/state.rs |
| Program tests | LiteSVM integration suite behind anchor test | programs/settlement-race/tests/ |
| Money module | Integer cents as bigint, checked arithmetic, formatting | app/src/lib/money.ts |
| Trade ticket module | Build, validate, canonical JSON, ticket hash | app/src/lib/ticket.ts |
| Provenance module | Hash-chain append, verify, head computation | app/src/lib/provenance.ts |
| PDA module | Seed derivations shared by UI and tests | app/src/lib/pda.ts |
| Program client | Interface plus Anchor devnet impl and offline mock impl | app/src/lib/programClient.ts, anchorClient.ts, mockClient.ts |
| Evidence module | Attach devnet tx signatures, fetch and verify evidence | app/src/lib/evidence.ts |
| Anchor flow | Anchor the finished chain head in one tx, verify a local chain against it | app/src/engine/anchorFlow.ts |
| Virtual clock | Deterministic monotonic race time | app/src/engine/clock.ts |
| Scenario engine | Orchestrates both lanes from one ticket, asserts identical start | app/src/engine/scenarioEngine.ts |
| Counterparty bot | Scripted Party B behavior per scenario in one browser | app/src/engine/bot.ts |
| Scenario definitions | Honest, default-after-leg1, late, atomic-revert, partial | app/src/engine/scenarios.ts |
| Race UI | Side-by-side lanes, timeline, balances, event log | app/src/components/RaceTrack.tsx and siblings |
| Payments comparison | Wire vs CLS vs stablecoin DvP educational page | app/src/components/PaymentsComparison.tsx |
| Verify tool | Paste chain JSON, recompute hashes, compare chain head | app/src/components/VerifyTool.tsx |
| Devnet setup | USD/CAD mints (2 decimals), airdrops, ATAs | scripts/setup-devnet.ts |
| Fixture generator | Committed offline demo fixtures | scripts/make-fixtures.ts |

## Data Flow
```text
TicketInput -> buildTicket -> ticket_hash (sha256 of canonical JSON)
  -> initialize_scenario x2 (SEQUENTIAL lane, ATOMIC lane, identical legs and gap)
  -> acknowledge x4 (both parties ack each lane; status reaches Ack before funding)
  -> snapshot start balances (fairness assert) -> fund_leg x4 (A funds USD escrow, B funds CAD escrow, both lanes)
  -> start_race(path) per lane (SEQUENTIAL and ATOMIC)
SEQUENTIAL: advance_clock -> release_leg1 (USD escrow -> B) -> virtual risk window
  -> release_leg2 (CAD escrow -> A, B signs) or release_leg2_partial
  -> [gap expired with unpaid remainder] declare_default (CAD remainder -> B) -> DEFAULTED
ATOMIC: settle_atomic (USD -> B and CAD -> A inside one instruction) -> SETTLED
  -> [escrow short] whole tx reverts (nothing moves) -> mark_failed -> FAILED
Every step: engine appends a ProvenanceRecord (virtual_ts, real_ts, tx_sig).
Terminal: anchor_chain_head(final_hash) in one devnet tx; UI renders both lanes.
```
Scenario variations (one line each):
- Honest: sequential settles after the gap; atomic settles instantly; both SETTLED.
- Default after leg 1: bot pays nothing further; clock passes gap; declare_default; A is short the USD paid out, B keeps USD and reclaims CAD escrow; atomic lane settles cleanly for contrast.
- Late payment: bot releases leg 2 after gap expiry; still accepted until declare_default runs; record stamped LATE; shows the race between default and late payment.
- Atomic revert: scenario spec funds leg 2 at 90 percent in both lanes; sequential still releases leg 1 then partially pays; atomic instruction reverts with InsufficientEscrow and nothing moves; A bears the sequential loss, zero exposure on atomic.
- Partial payment: bot releases 60 percent of CAD then stops; declare_default after gap; DEFAULTED with partial received; atomic lane shows partial payment is impossible by construction.

## Virtual Clock and Devnet Evidence
`VirtualClock` owns canonical race time (integer virtual milliseconds). The engine advances it deterministically; the program mirrors it via `advance_clock` (monotonic `virtual_now_ms` in Scenario) and all gap checks compare virtual time. Real devnet block time and transaction signatures are evidence only: each instruction result stores `tx_sig` and `real_ts_iso` in its provenance record, and the evidence panel fetches each tx from devnet RPC and checks program id plus success. This keeps race timelines reproducible and offline-capable while every claim still points at a real devnet transaction.

Phase 2 implementation notes: `settle_atomic` checks the live vault token balances rather than the recorded `funded_*_cents` counters, so a direct vault donation could enable settlement above the recorded funding. That is harmless for this demo (both parties are made whole) and the engine should treat the vault amount as the source of truth for evidence. The sequential payouts (`release_leg2` and `release_leg2_partial`) are capped at `funded_cad_cents - paid_cad_cents`, so a donation can never push `paid_cad_cents` above the recorded funding or overflow `declare_default`'s reclamation. Also, the `reason` string passed to `mark_failed` has no explicit length cap; it is bounded only by the transaction packet size, which is acceptable for a demo.

## File Structure
| File | Purpose | Changes |
|------|---------|---------|
| Anchor.toml | Workspace config, devnet cluster, program id, test script | new |
| Cargo.toml | Rust workspace root | new |
| programs/settlement-race/Cargo.toml | anchor-lang, anchor-spl, idl-build feature | new |
| programs/settlement-race/src/lib.rs | declare_id, instruction handlers, module wiring | new (phase 2) |
| programs/settlement-race/src/state.rs | Scenario, ChainHead, status and path enums | new (phase 1 schema, phase 2 impl) |
| programs/settlement-race/src/errors.rs | SettlementError enum, no panics | new (phase 2) |
| programs/settlement-race/src/instructions/ | One module per instruction (11 modules) | new (phase 2) |
| programs/settlement-race/tests/settlement_race.rs | LiteSVM integration suite run by anchor test | new (phase 2) |
| app/package.json | dev, build, test, lint scripts | new |
| app/vite.config.ts, app/tsconfig.json, app/index.html | Vite + React + strict TS scaffold | new |
| app/src/main.tsx, app/src/App.tsx | Bootstrap and routes (tabs: race, tickets, provenance, learn) | new |
| app/src/lib/money.ts | bigint cents, checked ops, formatters | new (phase 1) |
| app/src/lib/ticket.ts | TradeTicket build, validate, canonical JSON, hash | new (phase 1) |
| app/src/lib/provenance.ts | ProvenanceChain append, verify, head | new (phase 1 types, phase 3 impl) |
| app/src/lib/pda.ts | PDA seed derivations | new (phase 1) |
| app/src/lib/programClient.ts | ProgramClient interface | new (phase 1) |
| app/src/lib/settlement_race.json | Committed copy of the generated IDL (target/ is gitignored) | new (phase 3) |
| app/src/lib/settlementRaceTypes.ts | Committed copy of the generated IDL type helper | new (phase 3) |
| app/src/lib/anchorClient.ts | Devnet ProgramClient implementation | new (phase 3 devnet client, phase 4 wiring) |
| app/src/lib/mockClient.ts | Offline fixture implementation | new (phase 3 interface impl, phase 6 fixtures) |
| app/src/lib/evidence.ts | Tx signature attach, fetch, verify | new (phase 3) |
| app/src/engine/clock.ts | VirtualClock | new (phase 1) |
| app/src/engine/anchorFlow.ts | Anchor chain head glue: anchor and verify | new (phase 3) |
| app/src/engine/scenarioEngine.ts | Race orchestrator | new (phase 4) |
| app/src/engine/bot.ts | Scripted counterparty behaviors | new (phase 4) |
| app/src/engine/scenarios.ts | Five scenario specs | new (phase 1 data, phase 4 logic) |
| app/src/components/ | WalletBar, TicketCard, RaceTrack, LaneView, BalancePanel, TimelineControl, EventLog, ScenarioPicker, PaymentsComparison, VerifyTool | new (phases 4 to 6) |
| app/src/components/learn/learnContent.ts | Learn view copy as pure data: hook, sections, figures, citations | new (phase 5) |
| app/src/components/learn/LearnPanel.tsx | Learn view composition: thesis, anchor nav, narrative sections | new (phase 5) |
| app/src/components/learn/ClsLimitsBox.tsx | Honesty box: what CLS provides that this toy does not | new (phase 5) |
| app/src/components/learn/ComparisonTable.tsx | Three rails by six dimensions comparison table | new (phase 5) |
| app/src/components/learn/Citations.tsx | Inline [n] citation rendering and numbered sources list | new (phase 5) |
| app/src/styles/learn.css | Learn view styles including the amber risk hatch | new (phase 5) |
| app/src/fixtures/ | Committed offline demo fixtures | new (phase 6) |
| scripts/setup-devnet.ts | USD/CAD mints (2 decimals), airdrops, ATAs | new (phase 1) |
| scripts/make-fixtures.ts | Fixture generator | new (phase 6) |
| docs/architecture.md, docs/decisions.md | This snapshot and decision history | new (phase 1) |
| README.md | Top level overview: hook, quick start, demo script, evidence pointers | new |

## PDA Derivations
```text
Scenario  = PDA(["scenario", driver_pubkey, scenario_id_le_u64])
VaultUsd  = PDA(["vault_usd", scenario_pubkey])   // SPL token account, authority = itself
VaultCad  = PDA(["vault_cad", scenario_pubkey])   // SPL token account, authority = itself
ChainHead = PDA(["chain_head", scenario_pubkey])
```

## Interfaces
Schemas (frozen for phase 2; money fields are decimal strings of integer cents so no JSON float ever exists):
```ts
type LifecycleState = "NEW" | "ACK" | "PAYING" | "SETTLED" | "FAILED" | "DEFAULTED";
// NEW -> ACK (both parties acknowledge) -> PAYING (start_race: USD funded exactly, CAD nonzero)
// PAYING -> SETTLED (legs complete or atomic) | DEFAULTED (gap expired, unpaid remainder)
// PAYING -> FAILED (atomic revert or validation failure). Terminal states never reopen.
type TradeTicket = { schema_version: 1; ticket_id: string; cl_ord_id: string; trade_date: string; value_date: string;
  symbol: "USD/CAD"; side: "BUY_CAD" | "SELL_CAD"; party_a: { desk_id: string; wallet: string };
  party_b: { desk_id: string; wallet: string }; base_ccy: "USD"; base_amount_cents: string;
  quote_ccy: "CAD"; quote_amount_cents: string; rate_scaled: string; rate_scale: 1000000;
  settlement_path: "SEQUENTIAL" | "ATOMIC"; scenario: ScenarioKind; gap_ms: string;
  lifecycle: LifecycleState; ticket_hash: string; };
type ProvenanceRecord = { schema_version: 1; seq: number; scenario_id: string; event: EventType;
  actor: "PARTY_A" | "PARTY_B" | "ENGINE" | "DRIVER"; virtual_ts_ms: string; real_ts_iso: string | null;
  data: Record<string, string | number | boolean>; tx_sig: string | null; prev_hash: string; hash: string; };
// EventType: TICKET_CREATED | ACK_A | ACK_B | LEG_FUNDED | RACE_STARTED | LEG1_RELEASED |
// LEG2_RELEASED | LEG2_PARTIAL | DEFAULT_DECLARED | ATOMIC_SETTLED | ATOMIC_REVERTED |
// FAILED_MARKED | CLOCK_ADVANCED | CHAIN_ANCHORED
// hash = sha256(canonical_json(record minus hash)); canonical_json = keys sorted, no whitespace, UTF-8.
// Chain head = hash of last record; verify recomputes every link then compares to on-chain ChainHead.final_hash.
```
Program accounts and instructions (Rust):
```rust
pub enum RaceStatus { New, Ack, Paying, Settled, Defaulted, Failed }
pub enum SettlementPath { Sequential, Atomic }
pub enum Leg { Leg1Usd = 0, Leg2Cad = 1 }
// Scenario { driver, party_a, party_b, ticket_hash[32], status, path, leg1_usd_cents, leg2_cad_cents,
//   funded_usd_cents, funded_cad_cents, paid_cad_cents, ack_a, ack_b, virtual_now_ms,
//   race_started_at_ms, leg1_released_at_ms, gap_ms, scenario_id, bump }
// ChainHead { scenario, final_hash[32], event_count, anchored_unix_ts, anchored_virtual_ms, bump }
// initialize_scenario(id, ticket_hash, leg1_cents, leg2_cents, gap_ms)  driver; NEW
// acknowledge()                     party_a or party_b; sets ack flag
// fund_leg(leg, amount_cents)       A for Leg1Usd, B for Leg2Cad; CPI party ATA -> vault; checked add
// start_race(path)                  driver only; requires ACK, funded_usd == leg1 exactly, funded_cad > 0; PAYING
//                                   (full CAD is not required at start; settle_atomic only settles when both vaults cover both legs)
// advance_clock(to_virtual_ms)      driver only; monotonic, terminal blocked, rejects to_virtual_ms > i64::MAX - MAX_GAP_MS (BadState); writes virtual_now_ms
// release_leg1()                    driver only; sequential, PAYING; CPI USD vault -> B ATA
// release_leg2() / release_leg2_partial(amount_cents)   party_b signer; CPI CAD vault -> A ATA; payouts capped at funded_cad - paid_cad; full -> SETTLED
// declare_default()                 driver only; sequential; virtual_now > leg1_released_at + gap; CAD remainder -> B; DEFAULTED
// settle_atomic()                   driver only; atomic, PAYING; both CPIs in one instruction; vault short -> reverts whole tx
// mark_failed(reason)               driver only; PAYING -> FAILED (used after a reverted atomic attempt; reason is logged, not stored)
// anchor_chain_head(final_hash, event_count, anchored_virtual_ms)   driver only; terminal states only; writes ChainHead
// Errors: InsufficientEscrow, NotParty, BadState, GapNotExpired, ClockRegression, NotFullyFunded, WrongPath, AmountZero, Overflow
```
Signer matrix: `initialize_scenario`, `start_race`, `advance_clock`, `release_leg1`, `declare_default`, `settle_atomic`, `mark_failed`, and `anchor_chain_head` are driver only (`NotParty` otherwise). `acknowledge` and `fund_leg` stay party signers, and `release_leg2` / `release_leg2_partial` stay party B only: the engine (driver) orchestrates the race while parties only acknowledge, fund, and choose whether to pay leg 2, and that choice is the counterparty risk being demonstrated. This also enforces the recorded driver-trusted clock decision, including the `i64::MAX - MAX_GAP_MS` bound that keeps `declare_default`'s deadline `checked_add` from ever overflowing.

Path binding: the engine must derive the `start_race` path from the ticket so both lanes of one scenario match their ticket. Binding `path` to `ticket_hash` stays client-side via provenance rather than an on-chain check; the accepted risk is that an attacker gains nothing by mis-routing their own scenario, since every other guard still applies and the counterparty can always refuse to acknowledge or pay.

TypeScript core:
```text
money.ts         parse_cents(s): bigint; add(a,b); sub_checked(a,b): bigint | Error; fmt(cents, ccy): string
ticket.ts        buildTicket(input): TradeTicket; validateTicket(v: unknown); canonicalJson(v): string; ticketHash(t): string
provenance.ts    class ProvenanceChain { append(e): ProvenanceRecord; head(): string; verify(): boolean }
                 verifyRecords(records): VerifyResult // { valid: boolean; broken_at: number | null }
clock.ts         class VirtualClock { now(): bigint; advance(to_ms: bigint) /* monotonic */; schedule(at_ms, fn) }
programClient.ts interface ProgramClient { initScenario; ack; fundLeg; startRace; releaseLeg1; releaseLeg2;
                   releaseLeg2Partial; declareDefault; settleAtomic; markFailed(reason?); advanceClock;
                   anchorChainHead(final_hash, event_count, anchored_virtual_ms); fetchScenario }
scenarioEngine.ts class ScenarioEngine { run(spec: ScenarioSpec): AsyncGenerator<RaceEvent> }  // drives both lanes
bot.ts           behaviorFor(kind: ScenarioKind): BotBehavior // honest | defaultAfterLeg1 | latePayment | partialPayment
```

## Technology Decisions
| Decision | Choice | Why | Alternative Rejected | Trade-off |
|----------|--------|-----|---------------------|-----------|
| Program framework | Anchor 1.2.2 (pinned via avm) | Account constraints, IDL, PDA-signed CPI ergonomics; anchor-lang and anchor-spl 1.2.2 build against solana CLI 4.3.2; standard for escrow programs | Native Rust | Less low-level control; acceptable at this scope |
| TS client package | @anchor-lang/core | Client package for the pinned Anchor 1.2.2; renamed from @coral-xyz/anchor, which is legacy | Old package name | Older tutorials reference the old name |
| Token standard | Legacy SPL Token, 2 decimals | Wallet and tooling compatibility; base units equal cents | Token-2022 | No transfer hooks; not needed |
| Frontend | React + Vite + strict TS | Locked plan; wallet ecosystem and hiring signal | SolidJS | Heavier runtime; fine for one demo app |
| Wallet | @solana/wallet-adapter | Locked plan; mature React bindings | @solana/kit wallet plugin | Legacy direction per Solana docs; mitigated by isolating wallet code in one hook |
| Money math | u64 cents (Rust), bigint cents (TS), cent strings in JSON | No floats anywhere; JSON numbers are IEEE 754 | f64 | Slightly more verbose payloads |
| Race time | Deterministic virtual clock canonical | Reproducible risk windows; offline capable | Real devnet latency | Virtual clock is driver-trusted; acceptable for a play-money demo |
| Provenance | sha256 hash chain over canonical JSON plus on-chain chain head | Client-verifiable integrity with real tamper evidence | Off-chain log only | One extra tx per scenario |
| Escrow fairness | Both parties pre-fund PDA vaults; sequential leg 2 needs Party B signature | Identical starting balances; preserves a real default window | Direct unescrowed transfers | Default models signature refusal plus reclamation, which must be explained in the UI |
| Counterparty | Scripted in-browser bot | One browser drives both parties; deterministic | Two wallet sessions | Less realistic custody; much faster demo loop |
| Program tests | LiteSVM Rust suite behind anchor test | Fast, deterministic, current Anchor template direction | TS mocha on local validator | TS client glue covered by Vitest instead |
| Offline mode | ProgramClient interface with mock implementation | Phase 6 reuses the whole engine offline | Parallel offline codepath | Interface discipline required up front |
