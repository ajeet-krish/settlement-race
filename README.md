# Settlement Race

> I built the reason CLS exists, in miniature, then made the risk disappear atomically and let you watch both timelines race.

Settlement Race is a tokenized USD/CAD exchange on Solana devnet where a sequential pay-first settlement lane races an atomic delivery-versus-payment lane from one identical trade ticket: USD 10,000.00 against CAD 13,500.00 at rate 1.350000, paid in integer cents on a shared virtual clock. The sequential lane releases one leg and then waits, so you watch the amber risk window open; the atomic lane moves both legs inside one transaction or none at all, so the window never opens. Every step lands in a hash-chained provenance log whose head is anchored in one devnet transaction.

**Devnet play money only: no real funds, no mainnet, and no claim of legal settlement finality. This is an educational demo, not investment or legal advice, and it is provided with no warranty.**

## Screenshots

> TODO (capture): none of the five images below exist yet. The capture recipe for all five is in [docs/screenshots/README.md](docs/screenshots/README.md).

![Race view with both settlement lanes side by side under one shared virtual clock header: the amber SEQUENTIAL pay-first lane and the teal ATOMIC delivery-versus-payment lane, with the scenario picker, timeline controls, balance panel, and event log all in frame](docs/screenshots/race-view.png)

Race tab with a scenario selected (suggest **Default after leg 1**, `default_after_leg1`): both lanes side by side, SEQUENTIAL in amber and ATOMIC in teal, with the shared virtual clock header, balance panel, and event log in frame, captured at 1440x900.

![Default after leg 1 run with the sequential lane's amber hatched risk window open between leg 1 release and default, labeled Exposure open with the USD amount at risk and elapsed virtual seconds, while the atomic lane shows no exposure strip at all](docs/screenshots/risk-window.png)

The signature shot: the sequential lane with the amber hatched risk window open (after leg 1 released, before leg 2 or default), showing the "Exposure open: <amount> at risk for <duration> s (virtual)" label, with the atomic lane showing no exposure strip for contrast. In `default_after_leg1` the window stays open until default, so capturing mid run, or just after a completed default run with the closed window duration and the loss block, are both acceptable options.

![Tickets view with the trade ticket slip for USD 10,000.00 against CAD 13,500.00 at rate 1.350000, both party desks and wallets, the four step lifecycle rail with the current state highlighted, and the schema reference underneath](docs/screenshots/tickets-view.png)

Tickets tab after a run: the single ticket both lanes raced on, rebuilt from the run's provenance events and checked against the recorded ticket hash, with the lifecycle rail and the field by field schema reference in frame.

![Provenance view with the verify card's verdict slab above a chain table listing every record by seq, virtual time, lane, event, actor, signature, prev_hash, and hash, with the tamper demo card and the devnet transaction evidence card below](docs/screenshots/provenance-view.png)

Provenance tab after a run: Verify recomputes every hash link and prints the verdict, the chain table lists each record in chain order, the tamper demo fires on a copy while the original stays VALID, and the transaction evidence card reads the run's signatures from devnet. The mode badge names the ledger behind it.

![Theory view anchored to the "What CLS does that this does not" honesty box, showing the listed missing protections and the surrounding risk window narrative](docs/screenshots/learn-view.png)

Theory tab anchored to the "What CLS does that this does not" honesty box (`#honest-limits`), showing the box plus surrounding section context.

## Primary Features

1. **Side-by-side settlement race**: sequential pay-first and atomic delivery-versus-payment lanes stream from one identical ticket on one shared virtual clock.
2. **Five scenarios**: honest baseline, default after leg 1, late payment, atomic revert, and partial payment, each with expected terminal states pinned in code.
3. **Trade ticket view**: the agreed ticket rebuilt from provenance events, with a lifecycle rail and a schema reference.
4. **Provenance chain**: verify every hash link, fire a tamper demo on a copy, and read devnet transaction evidence per signature.
5. **Theory view**: the Herstatt to CLS to atomic DvP narrative with citations keyed to [docs/research.md](docs/research.md).
6. **Live and offline modes**: one switch between real devnet transactions and an in-memory mock on the same engine.

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
- Cluster guard: before any transaction the script compares the endpoint's genesis hash against the pinned Solana devnet hash and aborts on mismatch, so a wrong `SOLANA_RPC_URL` can never spend your wallet or create mints on another cluster. The script is idempotent: reruns reuse recorded keypairs and mints and only top balances up; `--reset` starts fresh and orphans earlier devnet mints.

### (b) Run the app

```bash
cd app && npm run dev
```

Open http://localhost:5199. The app fetches the demo accounts at startup (no browser wallet extension required: party A, party B, and the driver come from that file) and the engine source connects to devnet. While it loads, Run is disabled and the slip explains why; once connected, pick a scenario in the picker (Honest both sides, Default after leg 1, Late payment, Atomic revert, Partial payment) and press Run. Each run streams both lanes, then the chain pill reports the verification result: chain valid, chain broken, or chain pending, suffixed with its evidence (devnet or mock).

If port 5199 is already in use, the server exits with an error instead of moving to another port (`strictPort` in `app/vite.config.ts`), so the URL above is either correct or nothing is served. If you override the port on the command line, the terminal prints the URL the server actually uses.

### (c) Tests

```bash
cd app && npm test
cargo test-sbf --manifest-path programs/settlement-race/Cargo.toml --tools-version v1.54 --arch v0
anchor build
```

- Run `cargo test-sbf` before `anchor build`: the pinned command builds the SBPF arch v0 artifact that the LiteSVM suite loads, while `anchor build` emits an arch v3 artifact the harness rejects. After `anchor build`, re-run the pinned `cargo test-sbf` command to leave the arch v0 artifact on disk.
- `anchor test` uses the same pinned command from `Anchor.toml`, but it can stop at its devnet pre-deployment step when the configured wallet lacks lamports; run the `cargo test-sbf` command directly instead.
- Current roster: see the Tests section below.

## Full Feature breakdown

Everything below describes the shipped app: four live tabs behind one engine, one program, and one provenance chain.

### Race view

The race tab is the product. A scenario picker offers the five specs, the timeline control drives Run, play or pause, speed, and the virtual clock readout, and the track renders both lanes over the same timeline. Under them sit the balance panel (both lanes' escrow and paid amounts from the event stream) and the event log (every engine step in stream order). The chain pill in the header reports VALID, BROKEN, or PENDING and names its evidence (devnet or mock), and the mode switch picks the ledger: Live devnet or Offline demo.

Both lanes settle the same trade:

| Path | How it settles | What you watch |
|------|----------------|----------------|
| Sequential (pay first) | Leg 1 (USD) releases into the gap, leg 2 (CAD) releases later and needs party B's signature | The amber risk window opens the moment A's USD leaves escrow and closes only when B pays or the gap expires; a default leaves A short and returns the CAD remainder to B |
| Atomic (delivery versus payment) | Both legs move inside one `settle_atomic` instruction, or the whole transaction reverts and nothing moves | No window ever opens: a short escrow reverts the transaction with `InsufficientEscrow`, and exposure on the exchange itself is zero |

Both lanes run from the same ticket, the same funding, and the same virtual clock, so the only difference on screen is the settlement mechanism.

### The five scenarios

All five trade USD 10,000.00 against CAD 13,500.00 at rate 1.350000 with a 5000 ms virtual gap, defined in `app/src/engine/scenarios.ts`:

- **Honest both sides**: both sides pay on time. Sequential settles after the gap closes (SETTLED), atomic settles in one transaction (SETTLED).
- **Default after leg 1**: party B takes the USD leg and never pays CAD. Sequential declares default at gap expiry (DEFAULTED) while A is short the paid-out USD; the atomic lane settles untouched (SETTLED).
- **Late payment**: party B pays only at gap expiry. Sequential settles late with the exposure window fully open and the record stamped LATE (SETTLED); atomic has no window at all (SETTLED).
- **Atomic revert**: leg 2 is funded at 90 percent in both lanes (`fund_bps` 9000), so the lanes start equal. Sequential releases leg 1, pays only the available 90 percent of leg 2 as a partial payment, and the gap expiry declares a default so A bears the loss (DEFAULTED); the atomic instruction reverts with `InsufficientEscrow` and nothing moves (FAILED).
- **Partial payment**: party B pays 60 percent of the owed CAD leg and then stops (`fund_bps` 6000), so partial money moves before the gap expiry declares the default (DEFAULTED); the matching atomic attempt is underfunded at 60 percent and reverts (FAILED), because partial payment is impossible by construction.

### Tickets

Everything on the tab derives from the run, and the component holds no run state of its own. `deriveTicketView` rebuilds the canonical ticket from the scenario spec and the party wallets, freezes the lifecycle at NEW exactly as the engine writes it, and compares the rebuilt `ticket_hash` against the one carried in the `TICKET_CREATED` provenance record, so drift shows as a failed hash check with an honesty line instead of a silently different slip. The slip prints the ticket id, lifecycle word, both money cells in cents, both party desks and wallets, and the full hash. Beside it the four step lifecycle rail (NEW, ACK, PAYING, terminal) maps the sequential lane's events onto the state machine with the rule and cause for each step, while the atomic lane's state rides along as a lane chip. The schema reference lists every field with its meaning. Before any run the panel shows an invite rather than a half built ticket.

### Provenance

The tab derives its rows from the same event stream the race view consumed, so the chain and the race can never disagree. The verify card recomputes every hash link over the current records and prints a verdict slab (NOT VERIFIED before the first press, then VALID or BROKEN with the broken sequence number), plus the anchor comparison the run already performed from `chain_ok`, claiming only what that flag supports. The chain table lists every record in chain order: seq, virtual time, lane, event, actor, transaction signature, `prev_hash`, and hash, with per row details. The tamper card edits one field in a deep copy of the chain and verifies the copy: verification stops at the edited record, the result reads BROKEN at that sequence number, and the original chain is untouched and still VALID. The devnet evidence card reads up to 10 distinct signatures from devnet RPC, one call each, and reports found, our program id, and success per row, with an evidence check that passes only when every fetched signature exists on chain; offline mode never fetches and says plainly that the mock ledger's signatures no cluster has seen. A mode badge (Devnet live or Offline demo) names the ledger behind every verdict.

### Theory

The Theory tab carries the education layer, all as pure data in `app/src/components/learn/learnContent.ts`. A left "On this page" table of contents lists the seven sections, sticky at wide widths and a horizontal strip below 64rem. The risk window section tells the Herstatt story (Bankhaus Herstatt, 26 June 1974) and ties it to the amber hatch in the race view, with the pull quote that the gap between the two legs is the exposure. The CLS section explains payment versus payment and multilateral netting, with sourced figures (daily payment value, funding saved by netting, T+2, the 2013 USD/CAD same day session) each carrying its confidence wording. The honesty box at `#honest-limits` lists every protection this toy lacks: no multilateral netting, no intraday credit, no central bank money, no legal finality, a scripted counterparty, toy scale, and play money on devnet. The atomic settlement section gives both sides of the on-chain DvP argument, the comparison table puts wire, CLS, and stablecoin atomic DvP across six dimensions, and the trust note spells out what a VALID verdict actually trusts. Inline citations use `[n]` tokens keyed to section 10 of [docs/research.md](docs/research.md), which holds all 43 sources.

### Live versus offline mode

`app/src/lib/raceSource.ts` is the bridge between the race view and the settlement stack: one state machine (loading, missing accounts, error, ready) serves both modes.

- **Live** loads and validates `app/public/demo-accounts.json`, builds one devnet `Connection`, and returns a ready source that runs a full `ScenarioEngine` pass with `anchor_head` enabled and a fresh scenario id base per call. The base is probed on chain before each run, so a run never lands on an account from an earlier session, and it stays odd and clear of the engine defaults. Verification compares the local chain against the `ChainHead` PDA and arrives as `chain_ok`.
- **Offline** skips the accounts file, the connection, and every RPC probe, so no network can fail. It generates three keypairs and two mint addresses in memory for the session and runs the same engine against a fresh `MockProgramClient` per call, then verifies against that mock's anchored head with the same three checks (chain rehashes, head matches, count matches).
- **Both**: `runScenario` never rejects. Every failure arrives as `{ chain_ok: null, error }` with typed guidance: rate limits (429 or 410) become retry advice, a missing accounts file carries the setup command, and low SOL or token balances point at the command that tops them up. Switching modes mid run is blocked, and a switch clears the race so a verdict from one ledger can never describe the other. The offline note states in the UI that runs use the same engine and provenance logic against an in-memory ledger with no transactions and no on-chain evidence.

## Methodology: the rules the code enforces

1. **Money is integer cents only.** `u64` on chain, `bigint` in TypeScript, decimal integer strings in JSON, never floats or doubles. `parse_cents` rejects anything but an integer digit string, money never appears as a JSON number, and rates are formatted for display only, never used in money math.
2. **One deterministic virtual clock.** Race time is integer virtual milliseconds owned by `VirtualClock` and mirrored on chain by `advance_clock` (monotonic, and terminal states reject it). Devnet block time and transaction signatures are evidence only: each provenance record carries `virtual_ts_ms` plus `real_ts_iso` and `tx_sig`, so timelines stay reproducible while every claim still points at a real devnet transaction.
3. **Hash-chained provenance.** Every record is sha256 over canonical JSON (keys sorted, no whitespace, the `hash` field removed), linked by `prev_hash` from a 64-zero genesis. One devnet transaction anchors the finished head in the `ChainHead` PDA. Verification recomputes every link, then compares head and event count against that account, which turns a self-consistent log into tamper evidence and also detects truncation.
4. **Identical-ticket fairness.** Both lanes start from the same ticket, the same funding, and the same clock: the engine snapshots start balances as a fairness assert, and `fund_bps` applies identically to both lanes. The settlement mechanism is the only difference between them.
5. **Honest limits.** Devnet play money, a scripted counterparty bot instead of a real default, no claim of legal settlement finality, and an in-app Theory honesty box that lists every protection this toy does not have before any rail comparison.

## Demo script

| Scenario | What to watch |
|----------|---------------|
| Honest both sides | The baseline race: sequential settles after the gap, atomic settles in one transaction, both lanes end SETTLED |
| Default after leg 1 | The moment A's USD leaves escrow and never comes back, while the atomic lane settles untouched |
| Late payment | Exposure duration quantified: party B pays only at gap expiry, the record is stamped LATE, and the race between default and payment plays out |
| Atomic revert | All-or-nothing protects: at 90 percent funding sequential releases leg 1 then partially pays and defaults, while the atomic instruction reverts and no state changes |
| Partial payment | 60 percent of CAD still loses on sequential (DEFAULTED with partial received); on the atomic lane a partial payment is impossible by construction |

## Tests

- **Vitest (app)**: 348 tests in 27 files, all green, via `cd app && npm test`. Covers money and ticket canonicalization (with a pinned `ticket_hash` golden), provenance hashing plus tamper and truncation detection, the virtual clock, the scenario engine and scripted bot, the devnet and mock program clients, the race source (including all five specs driven through `createRaceSource({ mode: "offline" })`), the live-to-offline auto-fallback session transitions, and component suites for all four panels.
- **Rust**: 32 tests, all green, via the pinned `cargo test-sbf` command in Quick start (c): 27 LiteSVM integration tests in `programs/settlement-race/tests/settlement_race.rs` (escrow, both settlement paths, clock guards, the driver-only signer matrix, vault donation, and default deadline overflow guards) plus 5 state schema tests in `programs/settlement-race/tests/state_schema.rs`.
- Run order matters: `cargo test-sbf` before `anchor build`, as noted in Quick start (c).
- Suite history, live devnet smoke evidence, and the npm audit note live in [docs/tests.md](docs/tests.md).

## Architecture

```text
React app (Vite, strict TS): tabs for race, tickets, provenance, learn
   all four tabs live: race (scenario picker, lanes, timeline, balances,
   event log, chain pill), tickets, provenance, and learn views
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
app/src/lib/               money, ticket, provenance, pda, ProgramClient (anchor and mock), evidence, race source
app/src/engine/            virtual clock, scenario engine, scripted bot, five scenarios, anchor flow
app/src/components/        race, tickets, provenance, and learn panels (all four tabs are live)
app/src/styles/            theme, shell, race, tickets, provenance, and learn stylesheets
scripts/                   setup-devnet plus the devnet smoke scripts
docs/                      architecture, decisions, research, tests, reviews, tradeops schema, screenshots
```

Deep detail, including the full instruction list, signer matrix, PDA derivations, and data flow: [docs/architecture.md](docs/architecture.md).

Further reading:

- [docs/decisions.md](docs/decisions.md): decision records, including the Anchor 1.2.2 pin, the demo account keys, and the driver-only signer matrix
- [docs/tradeops-schema.md](docs/tradeops-schema.md): trade ticket fields, lifecycle transitions, canonical JSON, and provenance record schemas
- [docs/research.md](docs/research.md): sourced research behind the Theory view, with the honest limits of this toy and 43 citations
- [docs/tests.md](docs/tests.md): suite results, live devnet smoke evidence, and the npm audit note
- [docs/reviews.md](docs/reviews.md): code and security review history and routed gap closures

## Evidence and verification

- **Provenance verify**: every engine step appends a `ProvenanceRecord` (sha256 over canonical JSON, linked by `prev_hash`). Verification recomputes every link, then compares the head and the event count against the `ChainHead` account written on chain, which turns a self-consistent log into tamper evidence and detects truncation.
- **Trust anchors**: a VALID verdict means local recomputation matched the chain head as reported by the RPC endpoint you are connected to, written by the demo driver key. The evidence module (`app/src/lib/evidence.ts`) and the shipped evidence card in the Provenance view fetch each attached transaction from the same RPC and check program id plus success: the card reads up to 10 signatures, one RPC call each, and reports an evidence check of PASS only when every fetched signature exists on chain.
- **Live devnet evidence**: transaction signatures for the Phase 3 smoke (sequential lane at scenario id 7101, atomic lane at 7300, anchor, evidence phase) and the Phase 4 wiring smoke (20 transactions, both lanes SETTLED, chain verification VALID, 0.01084 SOL spent) are recorded in [docs/tests.md](docs/tests.md). Live runs stay under a 0.05 SOL budget per smoke.
- **Program id** (devnet): `4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3`, matching `declare_id!`, `Anchor.toml`, and the committed IDL copy in `app/src/lib/`.

## Conventions and security

- Money is integer cents only: `u64` in Rust, `bigint` in TypeScript, decimal strings of cents in JSON, never floats. Devnet only: never deploy to or reference mainnet, and never handle real funds. Docs and code comments carry no em dashes, double hyphens, or dash equivalents.
- Production builds exclude `app/public/demo-accounts.json`: a build-only Vite plugin removes it from `dist` and prints a warning on every `npm run build`.
- The dev server sets `cors: false`, so a page open elsewhere on your machine cannot read the demo keys cross-origin while `npm run dev` runs.
- Demo keys are gitignored devnet secrets (`scripts/devnet-accounts.json`, `scripts/devnet-keypairs.json`, `app/public/demo-accounts.json`, mode 600). They are play money, but never deploy this build publicly with them.
- `npm audit` reports 12 transitive advisories (7 moderate, 5 high) in the `toml`, `bigint-buffer`, `stream-json`, and `uuid` chains reached through the Anchor and web3 packages. The fixes are breaking-change-only, none touch transaction signing or signature verification (tweetnacl is unaffected), and the advisories are accepted for a devnet demo that parses no untrusted input; see the npm audit note in [docs/tests.md](docs/tests.md).

## License and disclaimer

No license file is published yet; treat this repository as educational material. Everything runs on Solana devnet with play money, the demo counterparty is a scripted bot, and nothing here carries a warranty or constitutes financial, legal, or investment advice.
