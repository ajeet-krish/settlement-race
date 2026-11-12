# Settlement Race

> I built the reason CLS exists, in miniature, then made the risk disappear atomically and let you watch both timelines race.

Last updated: 2026-11-12

Settlement Race is a tokenized USD/CAD exchange on Solana devnet where a sequential pay-first settlement path races an atomic delivery-versus-payment path from one identical trade ticket. The sequential lane pays one leg and then waits, so you watch the amber risk window open; the atomic lane moves both legs inside one transaction or none at all, so the window never opens. Both lanes start from identical balances, all money is integer cents, and every step lands in a hash-chained provenance log whose head is anchored on chain.

**Devnet play money only: no real funds, no mainnet, and no claim of legal settlement finality. This is an educational demo, not investment or legal advice, and it is provided with no warranty.**

## Why this exists

An FX trade pays in two currencies through two systems at two times, so between the two payments one side has already paid while the other has not. If the unpaid side fails inside that gap, the paid side keeps nothing: Bankhaus Herstatt closed in Cologne at 16:30 on 26 June 1974, after Deutsche marks had been paid in Frankfurt but before dollars were paid in New York, and the window it opened carries the bank's name to this day. The industry answer is payment versus payment, run at scale by CLS: synchronize both legs inside one settlement window and net the funding, which is why CLS exists. The gap was compressed, not eliminated: about USD 2.2 trillion per day of FX turnover still carried settlement risk in April 2022. The in-app Learn view carries the full sourced narrative with citations, and [docs/research.md](docs/research.md) holds the 43 source citations behind every figure.

## The two paths

| Path | How it settles | What you watch |
|------|----------------|----------------|
| Sequential (pay first) | Leg 1 (USD) releases into the gap, leg 2 (CAD) releases later and needs party B's signature | The amber risk window opens the moment A's USD leaves escrow and closes only when B pays or the gap expires; a default leaves A short and returns the CAD remainder to B |
| Atomic (delivery versus payment) | Both legs move inside one `settle_atomic` instruction, or the whole transaction reverts and nothing moves | No window ever opens: a short escrow reverts the transaction with `InsufficientEscrow`, and exposure on the exchange itself is zero |

Both lanes run from the same ticket, the same funding, and the same virtual clock, so the only difference on screen is the settlement mechanism.

## Screenshots

> TODO (capture): race view with a scenario selected, recipe in docs/screenshots/README.md
![Race view with both lanes side by side](docs/screenshots/race-view.png)

Race tab with a scenario selected (suggest **Default after leg 1**, `default_after_leg1`), both lanes visible side by side: SEQUENTIAL in amber, ATOMIC in teal. Shared virtual clock header, balance panel, and event log all in frame, captured at 1440x900.

> TODO (capture): Default after leg 1, amber risk window open, atomic lane untouched
![Sequential risk window open while the atomic lane stays untouched](docs/screenshots/risk-window.png)

The signature shot: the sequential lane with the amber hatched risk window open (after leg 1 released, before leg 2 or default), showing the "Exposure open: <amount> at risk for <duration> s (virtual)" label, with the atomic lane showing no exposure strip for contrast. In `default_after_leg1` the window stays open until default, so capturing mid run, or just after a completed default run with the closed window duration and the loss block, are both acceptable options.

> TODO (capture): Learn view anchored to the honesty box
![Learn view with the risk window narrative and rail comparison](docs/screenshots/learn-view.png)

Learn tab anchored to the "What CLS does that this does not" honesty box (`#honest-limits`), showing the box plus surrounding section context.

Screenshots are not captured yet; [docs/screenshots/README.md](docs/screenshots/README.md) explains how to produce all three.

## Quick start

### Prerequisites

- Solana CLI (the pinned toolchain builds against Agave 4.3.2)
- Anchor 1.2.2 via avm (pinned in `Anchor.toml`, `anchor_version = "1.2.2"`)
- Node.js 20 or newer
- Dependencies installed: `npm install` at the repo root and `cd app && npm install`

### (a) Set up devnet

```bash
npx tsx scripts/setup-devnet.ts
```

- Creates the two legacy SPL Token mints (USD and CAD, 2 decimals so base units are cents), funds three demo keypairs (party A, party B, driver), and writes `app/public/demo-accounts.json` for the browser. That file holds devnet secrets and is gitignored.
- Funding order: the devnet RPC faucet first, then a transfer from your Solana CLI wallet (`~/.config/solana/id.json`) as the fallback, because the public faucet is often closed (RPC 410) or rate limited (429). With the faucet closed the CLI wallet needs about 2 SOL (the script keeps a 0.5 SOL reserve while funding); top up at https://faucet.solana.com if it runs short. `npm run setup:devnet` at the repo root runs the same script.
- Cluster guard: before any transaction the script compares the endpoint's genesis hash against the pinned Solana devnet hash and aborts on mismatch, so a wrong `SOLANA_RPC_URL` can never spend your wallet or create mints on another cluster.
- The script is idempotent: reruns reuse recorded keypairs and mints and only top balances up. `--reset` starts fresh and orphans earlier devnet mints.

### (b) Run the app

```bash
cd app && npm run dev
```

Open http://localhost:5173. The app fetches the demo accounts at startup (no browser wallet extension required: party A, party B, and the driver come from that file) and the engine source connects to devnet. While it loads, Run is disabled and the slip explains why; once connected, pick a scenario in the picker (Honest both sides, Default after leg 1, Late payment, Atomic revert, Partial payment) and press Run. Each run streams both lanes, then the chain pill reports the local verification result: VALID, BROKEN, or PENDING.

### (c) Tests

```bash
cd app && npm test
cargo test-sbf --manifest-path programs/settlement-race/Cargo.toml --tools-version v1.54 --arch v0
anchor build
```

- Run `cargo test-sbf` before `anchor build`: the pinned command builds the SBPF arch v0 artifact that the LiteSVM suite loads, while `anchor build` emits an arch v3 artifact the harness rejects. After `anchor build`, re-run the pinned `cargo test-sbf` command to leave the arch v0 artifact on disk.
- `anchor test` uses the same pinned command from `Anchor.toml`, but it can stop at its devnet pre-deployment step when the configured wallet lacks lamports; run the `cargo test-sbf` command directly instead.
- Roster: 269 Vitest tests (24 files) plus 32 Rust tests, all green (see [docs/tests.md](docs/tests.md)).

## Demo script

| Scenario | What to watch |
|----------|---------------|
| Honest both sides | The baseline race: sequential settles after the gap, atomic settles instantly, both lanes end SETTLED |
| Default after leg 1 | The moment A's USD leaves escrow and never comes back, while the atomic lane settles untouched |
| Late payment | Exposure duration quantified: party B pays after the gap expiry, the record is stamped LATE, and the race between default and payment plays out |
| Atomic revert | All-or-nothing protects: at 90 percent funding sequential releases leg 1 then partially pays and defaults, while the atomic instruction reverts and no state changes |
| Partial payment | 60 percent still loses on sequential (DEFAULTED with partial received); on the atomic lane a partial payment is impossible by construction |

## Architecture

```text
React app (Vite, strict TS): tabs for race, tickets, provenance, learn
   race view (scenario picker, lanes, timeline, balances, event log, chain pill)
   and learn view are live; tickets and provenance are placeholder copy for now
        |
        v
ProgramClient interface (app/src/lib/programClient.ts)
   anchorClient.ts: devnet, @anchor-lang/core 1.2.2     mockClient.ts: offline fixtures
        |
        v
Anchor program (programs/settlement-race, 12 instructions)
   Scenario state, USD/CAD escrow vault PDAs, driver-trusted virtual clock,
   ChainHead PDA (final provenance hash written by anchor_chain_head)
        ^
        |  one devnet tx per scenario anchors the finished chain head
Provenance chain: sha256 over canonical JSON, each record linked by prev_hash
```

Project layout:

```text
programs/settlement-race/  Anchor program: lib, state, errors, instructions, LiteSVM tests
app/src/lib/               money, ticket, provenance, pda, ProgramClient (anchor and mock), evidence
app/src/engine/            virtual clock, scenario engine, scripted bot, five scenarios, anchor flow
app/src/components/        race view (RacePanel, RaceTrack, lanes, timeline), learn view
app/src/styles/            theme, shell, race, and learn stylesheets
scripts/                   setup-devnet plus the devnet smoke scripts
docs/                      architecture, decisions, research, tests, reviews, tradeops schema, screenshots
```

Deep detail, including the full instruction list, signer matrix, PDA derivations, and data flow: [docs/architecture.md](docs/architecture.md).

Further reading:

- [docs/decisions.md](docs/decisions.md): decision records, including the Anchor 1.2.2 pin, the demo account keys, and the driver-only signer matrix
- [docs/tradeops-schema.md](docs/tradeops-schema.md): trade ticket fields, lifecycle transitions, canonical JSON, and provenance record schemas
- [docs/research.md](docs/research.md): sourced research behind the Learn view, with the honest limits of this toy and 43 citations
- [docs/tests.md](docs/tests.md): suite results, live devnet smoke evidence, and the npm audit note
- [docs/reviews.md](docs/reviews.md): code and security review history and routed gap closures

## Evidence and verification

- **Provenance verify**: every engine step appends a `ProvenanceRecord` (sha256 over canonical JSON, linked by `prev_hash`). Verification recomputes every link, then compares the head and the event count against the `ChainHead` account written on chain, which turns a self-consistent log into tamper evidence and detects truncation.
- **Trust anchors**: a VALID verdict means local recomputation matched the chain head as reported by the RPC endpoint you are connected to, written by the demo driver key. The evidence module (`app/src/lib/evidence.ts`) fetches each attached transaction from the same RPC and checks program id plus success; the in-app evidence panel lands in Phase 6, as the trust note in the Learn view states.
- **Live devnet evidence**: transaction signatures for the Phase 3 smoke (sequential lane at scenario id 7101, atomic lane at 7300, anchor, evidence phase) and the Phase 4 wiring smoke (20 transactions, both lanes SETTLED, chain verification VALID, 0.01084 SOL spent) are recorded in [docs/tests.md](docs/tests.md). Live runs stay under a 0.05 SOL budget per smoke.
- **Program id** (devnet): `4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3`, matching `declare_id!`, `Anchor.toml`, and the committed IDL copy in `app/src/lib/`.

## Conventions and security

- Money is integer cents only: `u64` in Rust, `bigint` in TypeScript, decimal strings of cents in JSON, never floats. Devnet only: never deploy to or reference mainnet, and never handle real funds. Docs and code comments carry no em dashes, double hyphens, or dash equivalents.
- Production builds exclude `app/public/demo-accounts.json`: a build-only Vite plugin removes it from `dist` and prints a warning on every `npm run build`.
- The dev server sets `cors: false`, so a page open elsewhere on your machine cannot read the demo keys cross-origin while `npm run dev` runs.
- Demo keys are gitignored devnet secrets (`scripts/devnet-accounts.json`, `scripts/devnet-keypairs.json`, `app/public/demo-accounts.json`, mode 600). They are play money, but never deploy this build publicly with them.
- `npm audit` reports 12 transitive advisories (7 moderate, 5 high) in the `toml`, `bigint-buffer`, `stream-json`, and `uuid` chains reached through the Anchor and web3 packages. The fixes are breaking-change-only, none touch transaction signing or signature verification (tweetnacl is unaffected), and the advisories are accepted for a devnet demo that parses no untrusted input; see the npm audit note in [docs/tests.md](docs/tests.md).

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Bootstrap and schema | Complete |
| 2 | Anchor program and tests | Complete |
| 3 | Provenance module | Complete |
| 4 | Race UI | Complete |
| 5 | Educational layer | In Progress |
| 6 | Offline mode and polish | Complete |

## License and disclaimer

No license file is published yet; treat this repository as educational material. Everything runs on Solana devnet with play money, the demo counterparty is a scripted bot, and nothing here carries a warranty or constitutes financial, legal, or investment advice.
