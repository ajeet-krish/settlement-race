# Tradeops Schema

Last updated: 2026-11-10

This document is the contract for the off-chain trade ticket and the provenance hash chain. Both are pure data formats: the ticket is what the counterparties agree to, its hash is what the on-chain Scenario account commits to, and the provenance chain records every event that moves the scenario forward. The capital markets framing (Herstatt risk, payment-versus-payment, delivery-versus-payment) comes from [research.md](research.md), sections 1, 2, 4, and 5.

Ground rules for every format in this file:

- Devnet play money only. No real funds, no mainnet, no claim of legal settlement finality (research.md section 6).
- Money is integer cents only. In TypeScript amounts are `bigint`, on chain they are `u64`, in JSON they are decimal integer strings. Never floats or doubles (research.md section 9).
- Serialization is canonical JSON (rules in section 4), hashed with SHA-256.
- No timestamp inside a hash ever comes from an untrusted wall clock without also being recorded as virtual time; see `virtual_ts_ms` below.

## 1. Trade ticket

The ticket is created by the engine from the scenario parameters, shown to both parties, and acknowledged before any funds move. `ticket_hash` is stored in the on-chain `Scenario` account, so a party can prove which exact ticket text the chain refers to.

### 1.1 Field table

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | literal `1` | Ticket schema version. Any other value is rejected. |
| `ticket_id` | string | Unique trade reference, for example `SR-2026-11-10-0001`. |
| `cl_ord_id` | string | Original client order id carried from the order management side, for audit continuity. |
| `trade_date` | string, `YYYY-MM-DD` | Date the trade was agreed. |
| `value_date` | string, `YYYY-MM-DD` | Settlement value date. The toy does not enforce business day calendars (research.md section 6). |
| `symbol` | literal `"USD/CAD"` | The only pair this project trades. |
| `side` | `"BUY_CAD"` or `"SELL_CAD"` | Direction from party A's perspective. |
| `party_a.desk_id` | string | Party A desk identifier. |
| `party_a.wallet` | string, base58 | Party A Solana wallet. |
| `party_b.desk_id` | string | Party B desk identifier. |
| `party_b.wallet` | string, base58 | Party B Solana wallet. |
| `base_ccy` | literal `"USD"` | Base currency of the pair. |
| `base_amount_cents` | string, non negative integer | Leg 1 notional in USD cents, decimal integer string. |
| `quote_ccy` | literal `"CAD"` | Quote currency of the pair. |
| `quote_amount_cents` | string, non negative integer | Leg 2 notional in CAD cents, decimal integer string. |
| `rate_scaled` | string, non negative integer | Execution rate multiplied by `rate_scale`. `1.350000` is stored as `"1350000"`. |
| `rate_scale` | literal `1000000` | Six decimal places of rate precision. |
| `settlement_path` | `"SEQUENTIAL"` or `"ATOMIC"` | Route for this trade: pay-first with a gap, or atomic delivery-versus-payment. |
| `scenario` | `ScenarioKind` | Replay behavior: `honest`, `default_after_leg1`, `late_payment`, `atomic_revert`, `partial_payment`. |
| `gap_ms` | string, non negative integer | Gap window in milliseconds between the legs on the sequential path. |
| `lifecycle` | `LifecycleState` | Current state, see section 2. |
| `ticket_hash` | string, 64 lowercase hex | SHA-256 of the canonical JSON of the ticket with `ticket_hash` omitted. |

### 1.2 Conventions

- Amount and rate fields are decimal integer strings so JSON never carries a float. `parse_cents` in `app/src/lib/money.ts` rejects anything but `-?[0-9]+`, and additionally rejects digit strings longer than 20 characters before parsing.
- `rate_scaled / rate_scale` is the quoted rate. Ratios are only ever formatted for display, never used in money math (research.md section 9).
- Unknown fields are not part of schema version 1. Validation rejects wrong literal types (`symbol`, `rate_scale`), wrong enum members, malformed dates, and malformed hashes.

## 2. Lifecycle state machine

Lifecycle states are shared by the ticket, the provenance chain, and the on-chain `RaceStatus` enum (Rust variants `New`, `Ack`, `Paying`, `Settled`, `Defaulted`, `Failed`; TypeScript uses the uppercase strings below).

```
NEW      (first acknowledgement)         => NEW
NEW      (both parties acknowledged)     => ACK
ACK      (race started)                  => PAYING
PAYING   (leg 2 released in full, or atomic settle)  => SETTLED
PAYING   (gap expired, default declared)            => DEFAULTED
PAYING   (atomic attempt reverted, failure marked)   => FAILED

SETTLED, DEFAULTED, FAILED: terminal states with no outbound transitions.
```

`SETTLED`, `DEFAULTED`, and `FAILED` are terminal: no transition out of them exists.

### 2.1 Transition rules

| From | Event | To | Guard | Notes |
| --- | --- | --- | --- | --- |
| `NEW` | `ACK_A` | `NEW` | signer is party A, `ack_a` was false | First acknowledgement only. |
| `NEW` | `ACK_B` | `NEW` | signer is party B, `ack_b` was false | Status becomes `ACK` only when both flags are true. |
| `NEW` | `ACK_A` or `ACK_B` | `ACK` | this was the second acknowledgement | Both `ack_a` and `ack_b` true. |
| `ACK` | `RACE_STARTED` | `PAYING` | both parties acknowledged | Funding and the gap clock begin. |
| `PAYING` | `LEG_FUNDED` | `PAYING` | signer is a party, amount greater than zero | Escrow balances increase; never decreases the wrong leg. |
| `PAYING` | `LEG1_RELEASED` | `PAYING` | sequential path, escrow covers leg 1 | Records `leg1_released_at_ms`, starts the gap window. |
| `PAYING` | `LEG2_PARTIAL` | `PAYING` | sequential path, amount less than remaining leg 2 | Partial recovery is visible as `paid_cad_cents`. |
| `PAYING` | `LEG2_RELEASED` | `SETTLED` | sequential path, full leg 2 paid | Allowed after gap expiry only until a default is declared, which is how `late_payment` still settles. |
| `PAYING` | `DEFAULT_DECLARED` | `DEFAULTED` | sequential path, gap expired (`GapNotExpired` otherwise), leg 2 not fully paid | Terminal. `paid_cad_cents` keeps whatever partial amount arrived. |
| `PAYING` | `ATOMIC_SETTLED` | `SETTLED` | atomic path, both legs fully funded in the same transaction | Delivery-versus-payment: both legs or neither (research.md section 5). |
| `PAYING` | `ATOMIC_REVERTED` | `FAILED` | atomic path, funding check failed | The settlement transaction itself rolls back with no funds moved; the engine then marks the scenario failed in a follow-up transaction. |
| `PAYING` | `FAILED_MARKED` | `FAILED` | driver marks an unrecoverable condition | Terminal, used by the engine after a revert and by `mark_failed`. |
| `PAYING` | `CLOCK_ADVANCED` | `PAYING` | `to_ms >= virtual_now_ms` | Virtual time only moves forward; regression is `ClockRegression`. |
| any | anything else | unchanged or error | state does not permit it | Rejected with `BadState`, `NotParty`, `WrongPath`, `InsufficientEscrow`, `AmountZero`, or `Overflow`. |

The race is pedagogical: on the sequential path the gap between `LEG1_RELEASED` and `LEG2_RELEASED` is the Herstatt style exposure window (research.md sections 1 and 6), and the atomic path has no such window because both legs share one transaction.

## 3. Example ticket

Placeholder devnet addresses only. The wallet keys for these examples were generated for documentation and hold no funds that matter; live party keys live in `scripts/devnet-keypairs.json` (gitignored).

```json
{
  "schema_version": 1,
  "ticket_id": "SR-2026-11-10-0001",
  "cl_ord_id": "CLORD-7f3a9c21",
  "trade_date": "2026-11-10",
  "value_date": "2026-11-12",
  "symbol": "USD/CAD",
  "side": "BUY_CAD",
  "party_a": {
    "desk_id": "DESK-A",
    "wallet": "CwzzqAv4n1EqDZ616zB3y5UrBSzoyXhujdLzk3Cf1Ke9"
  },
  "party_b": {
    "desk_id": "DESK-B",
    "wallet": "8iBowKEfGo2qhDT4B6KGGea3BziQi2poHHUJxiCkVuAk"
  },
  "base_ccy": "USD",
  "base_amount_cents": "1000000",
  "quote_ccy": "CAD",
  "quote_amount_cents": "1350000",
  "rate_scaled": "1350000",
  "rate_scale": 1000000,
  "settlement_path": "SEQUENTIAL",
  "scenario": "honest",
  "gap_ms": "5000",
  "lifecycle": "NEW",
  "ticket_hash": "5afdf9f88c139d82f09a38f6dd40fc8cc7de885cddf057fc68003fb925300a62"
}
```

Reading the numbers: USD 10,000.00 (`1000000` cents) against CAD 13,500.00 (`1350000` cents) at a rate of 1.350000, gap window 5000 ms, sequential path. The golden test in `app/src/lib/__tests__/ticket.test.ts` pins `ticket_hash`, so any change to canonicalization fails the suite.

## 4. Canonical JSON and hashing rules

Both `ticket_hash` and every provenance record hash use the same canonical form.

1. Object keys are sorted lexicographically by UTF-16 code unit (JavaScript default `Array.prototype.sort` order), recursively, including nested objects.
2. No whitespace anywhere: no spaces after `:` or `,`, no newlines.
3. Arrays keep their element order. Array order is significant and is never sorted.
4. Strings and keys are escaped exactly as `JSON.stringify` escapes them (quote, backslash, control characters; non ASCII characters pass through as themselves).
5. `undefined` object properties are omitted, matching `JSON.stringify`. `null` is preserved as `null`.
6. Numbers must be finite JSON numbers. Money never appears as a JSON number: amounts are decimal integer strings. `bigint`, `NaN`, `Infinity`, functions, and symbols are rejected.
7. The serialized string is encoded as UTF-8 and hashed with SHA-256, output as 64 lowercase hex characters.
8. For `ticket_hash`, the `ticket_hash` field itself is removed before hashing. For a provenance record, the `hash` field itself is removed before hashing.

Worked example for the ticket in section 3. Canonical form (single line, keys sorted):

```
{"base_amount_cents":"1000000","base_ccy":"USD","cl_ord_id":"CLORD-7f3a9c21","gap_ms":"5000","lifecycle":"NEW","party_a":{"desk_id":"DESK-A","wallet":"CwzzqAv4n1EqDZ616zB3y5UrBSzoyXhujdLzk3Cf1Ke9"},"party_b":{"desk_id":"DESK-B","wallet":"8iBowKEfGo2qhDT4B6KGGea3BziQi2poHHUJxiCkVuAk"},"quote_amount_cents":"1350000","quote_ccy":"CAD","rate_scale":1000000,"rate_scaled":"1350000","scenario":"honest","schema_version":1,"settlement_path":"SEQUENTIAL","side":"BUY_CAD","symbol":"USD/CAD","ticket_id":"SR-2026-11-10-0001","trade_date":"2026-11-10","value_date":"2026-11-12"}
```

SHA-256 of that UTF-8 string:

```
5afdf9f88c139d82f09a38f6dd40fc8cc7de885cddf057fc68003fb925300a62
```

Because keys are sorted before serialization, key insertion order in the producing code cannot change the hash. This is what makes hashes stable across runs, across TypeScript and Rust producers, and across map implementations.

## 5. Provenance record

Every event appends one record to an append-only chain. The chain proves order and content: rewriting any historical record breaks every hash after it.

### 5.1 Field table

| Field | Type | Description |
| --- | --- | --- |
| `schema_version` | literal `1` | Record schema version. |
| `seq` | number | Zero based position in the chain. Must equal the chain length at append time. |
| `scenario_id` | string | Scenario this event belongs to. |
| `event` | `EventType` | One of the event types in section 5.2. |
| `actor` | `"PARTY_A"`, `"PARTY_B"`, `"ENGINE"`, `"DRIVER"` | Who caused the event. `ENGINE` runs the scenario, `DRIVER` advances the virtual clock and anchors the chain. |
| `virtual_ts_ms` | string, decimal integer | Virtual clock time of the event in milliseconds. String form keeps bigint semantics in JSON. |
| `real_ts_iso` | string or `null` | Real wall clock time in ISO 8601 when known, `null` for purely simulated events. |
| `data` | object of string, number, boolean | Event payload. Money values are decimal integer strings (`"amount_cents": "1350000"`); small counts and basis points may be numbers. |
| `tx_sig` | string or `null` | Solana transaction signature when the event happened on chain, `null` otherwise. |
| `prev_hash` | string, 64 hex | Hash of the previous record, or 64 zeros for `seq` 0. |
| `hash` | string, 64 hex | SHA-256 of this record's canonical JSON with `hash` omitted. |

### 5.2 Event types

| Event | Typical actor | Meaning |
| --- | --- | --- |
| `TICKET_CREATED` | `ENGINE` | Ticket agreed, hash recorded, scenario created. |
| `ACK_A` | `PARTY_A` | Party A acknowledged the ticket. |
| `ACK_B` | `PARTY_B` | Party B acknowledged the ticket. |
| `LEG_FUNDED` | `PARTY_A` or `PARTY_B` | A party deposited funds into escrow for a leg. |
| `RACE_STARTED` | `ENGINE` | Both parties acknowledged, race and gap clock running. |
| `LEG1_RELEASED` | `ENGINE` | Leg 1 released to the counterparty, exposure window opens. |
| `LEG2_RELEASED` | `ENGINE` | Leg 2 released in full, sequential settlement complete. |
| `LEG2_PARTIAL` | `ENGINE` | Partial leg 2 payment recorded before the gap expired. |
| `DEFAULT_DECLARED` | `DRIVER` | Gap expired without full payment, default declared. |
| `ATOMIC_SETTLED` | `ENGINE` | Atomic path settled both legs in one transaction. |
| `ATOMIC_REVERTED` | `ENGINE` | Atomic settlement attempt reverted, no funds moved. |
| `FAILED_MARKED` | `DRIVER` | Terminal failure marked on the scenario. |
| `CLOCK_ADVANCED` | `DRIVER` | Virtual clock moved forward. |
| `CHAIN_ANCHORED` | `DRIVER` | Chain head written to the on-chain `ChainHead` account. |

### 5.3 Hash chain rules

- The head of an empty chain is 64 zeros (`GENESIS_HASH`).
- Record `seq` 0 has `prev_hash` equal to `GENESIS_HASH`. Every later record has `prev_hash` equal to the `hash` of the record before it.
- `append` computes `prev_hash` from the current head and `hash` from the record content, so a caller cannot forge a link without recomputing every hash after it.
- `verify` recomputes all three conditions per record (index equals `seq`, `prev_hash` link correct, content hash correct) and returns false at the first broken link. Changing any field of any record without recomputing downstream hashes is detected.
- Verification is content integrity only. Timestamps and `tx_sig` values are claims until the head is compared against the on-chain `ChainHead` account, which is Phase 3.

Worked example, first two records of scenario `SR-2026-11-10-0001`:

```json
[
  {
    "schema_version": 1,
    "seq": 0,
    "scenario_id": "SR-2026-11-10-0001",
    "event": "TICKET_CREATED",
    "actor": "ENGINE",
    "virtual_ts_ms": "0",
    "real_ts_iso": "2026-11-10T12:00:00.000Z",
    "data": { "ticket_id": "SR-2026-11-10-0001", "path": "SEQUENTIAL" },
    "tx_sig": null,
    "prev_hash": "0000000000000000000000000000000000000000000000000000000000000000",
    "hash": "5659a252f893a2593a6e3110304119b639d06a297b0441bc83b17d372950a6cd"
  },
  {
    "schema_version": 1,
    "seq": 1,
    "scenario_id": "SR-2026-11-10-0001",
    "event": "ACK_A",
    "actor": "PARTY_A",
    "virtual_ts_ms": "100",
    "real_ts_iso": null,
    "data": { "desk_id": "DESK-A" },
    "tx_sig": "5xTr7YqEXAMPLESIGNATUREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "prev_hash": "5659a252f893a2593a6e3110304119b639d06a297b0441bc83b17d372950a6cd",
    "hash": "32e9cdf692ca8ddc609513e49396a7ed7b104839c8d21aedd87fa1807e354609"
  }
]
```

The chain head after these two records is `32e9cdf692ca8ddc609513e49396a7ed7b104839c8d21aedd87fa1807e354609`. `ProvenanceChain` in `app/src/lib/provenance.ts` implements `append`, `head`, and `verify`; the tamper tests in `app/src/lib/__tests__/provenance.test.ts` mutate data, `hash`, and `prev_hash` and assert that `verify` fails each time.

## 6. On-chain mapping

| Off-chain concept | On-chain account or field |
| --- | --- |
| Ticket agreement | `Scenario.ticket_hash` (`[u8; 32]`, big endian SHA-256 bytes of `ticket_hash`) |
| Lifecycle state | `Scenario.status` (`RaceStatus` enum) |
| Settlement route | `Scenario.path` (`SettlementPath` enum) |
| Notionals and escrow progress | `Scenario.leg1_usd_cents`, `leg2_cad_cents`, `funded_usd_cents`, `funded_cad_cents`, `paid_cad_cents` (`u64` cents) |
| Acknowledgements | `Scenario.ack_a`, `Scenario.ack_b` |
| Gap window and virtual time | `Scenario.gap_ms`, `virtual_now_ms`, `race_started_at_ms`, `leg1_released_at_ms` (`i64`) |
| Provenance head | `ChainHead.final_hash`, `event_count`, `anchored_unix_ts`, `anchored_virtual_ms` |
| PDA seeds | `["scenario", driver, scenario_id_le_u64]`, `["vault_usd", scenario]`, `["vault_cad", scenario]`, `["chain_head", scenario]` |

The program id placeholder and the seed layout are defined once in `app/src/lib/pda.ts` and mirrored by the Anchor seeds in `programs/settlement-race/src/lib.rs` (Phase 2 adds the full instruction set).

## 7. Open items for later phases

- Phase 2: instruction guards for every transition in section 2.1, plus LiteSVM program tests under `programs/settlement-race/tests/` (run by `anchor test` via `cargo test-sbf`, see docs/decisions.md).
- Phase 3: `CHAIN_ANCHORED` writes to the `ChainHead` account and verification of an anchored head against an off-chain chain.
- Phase 4: the race UI reads `Scenario` accounts and renders both lanes side by side.
