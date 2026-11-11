# Settlement Race Test Results

Last updated: 2026-11-10

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
