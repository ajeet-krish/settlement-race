# Settlement Race

A tokenized USD/CAD exchange on Solana devnet that compares sequential (pay-first) settlement against atomic on-chain delivery-versus-payment, presented in a side-by-side race UI. Settled amounts are play money on devnet only.

## Quick Commands

```bash
anchor build            # Build the Anchor program
anchor test             # Run Anchor program tests
cd app && npm run dev   # Start frontend dev server
cd app && npm run build # Build frontend for production
cd app && npm test      # Run frontend tests
cd app && npm run lint  # Lint frontend (when configured)
```

## Conventions

- Money is integer cents only. Never use floats or doubles for money math in Rust or TypeScript.
- Rust uses `u64` (or wider) for token amounts; TypeScript uses `bigint` or integer arithmetic.
- Devnet play money only. Never deploy to or reference mainnet, and never handle real funds.
- TypeScript runs in strict mode. No implicit `any`, no unchecked nulls.
- Anchor conventions apply: declared accounts with `#[account]` constraints, custom error enums instead of panics, and CPI for token transfers.
- Rust follows standard `rustfmt` style; frontend follows the configured linter.
- Documentation and code comments contain no em dashes, double hyphens, or dash equivalents. Use commas, colons, and parentheses instead.

## Project Map

- `programs/` Anchor program (Rust): ledger, provenance, and settlement instructions.
- `app/` React frontend (TypeScript): side-by-side race UI, wallet integration, offline mode.
- `docs/` Specifications, architecture, decisions, research, reviews, and test docs.
- `scripts/` Devnet setup: mints, airdrops, token accounts, and demo fixtures.
- `Anchor.toml` Anchor workspace configuration (cluster: devnet).
- `app/package.json` Frontend scripts: dev, build, test, lint.

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Bootstrap and schema | Complete |
| 2 | Anchor program and tests | Complete |
| 3 | Provenance module | In Progress |
| 4 | Race UI | |
| 5 | Educational layer | |
| 6 | Offline mode and polish | |

## Deep Docs

- [Architecture](docs/architecture.md)
- [Decisions](docs/decisions.md)
- [Research](docs/research.md)
- [Reviews](docs/reviews.md)
- [Tests](docs/tests.md)
