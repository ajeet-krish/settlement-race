# Screenshot capture recipe

The five images referenced by the top level README are not captured yet. This file is the recipe: add each PNG to this directory and remove the TODO blockquote above it in README.md.

## Prerequisites

- Devnet setup done once: `npx tsx scripts/setup-devnet.ts` (writes the gitignored `app/public/demo-accounts.json`)
- App running: `cd app && npm run dev`, then open http://localhost:5199
- A capture tool. Playwright CLI works headlessly once its browser is installed:

```bash
npx -y playwright@latest install chromium
npx -y playwright@latest screenshot --viewport-size=1440,900 http://localhost:5199 docs/screenshots/race-view.png
```

## What to capture (viewport 1440x900)

1. `race-view.png`: on the race view, select **Default after leg 1** and press Run; capture once both lanes render side by side with the shared clock header, balance panel, and event log visible.
2. `risk-window.png`: stay on **Default after leg 1** and press Run; capture while the sequential lane shows the amber hatched risk window open (mid run, or just after default with the closed window duration and loss block), with the atomic lane still showing no exposure strip.
3. `tickets-view.png`: after any completed run, switch to the **Tickets** tab; capture the trade ticket slip (money cells, both parties, and the ticket_hash verdict line), the four step lifecycle rail, and the schema reference in one frame.
4. `provenance-view.png`: after the same run, switch to the **Provenance** tab; capture the verify card with its verdict slab, the chain table rows, the tamper demo card, and the devnet evidence card, with the mode badge visible.
5. `learn-view.png`: switch to the **Learn** tab and anchor to the "What CLS does that this does not" box (`#honest-limits`); capture the box plus surrounding section context in one frame.

## Housekeeping

- Kill the dev server after capture; do not leave background processes running.
- Keep PNGs under about 400 KB each; crop browser chrome out, keep only the app.
- Re-capture after significant race view or Learn view redesigns so the README stays truthful.
