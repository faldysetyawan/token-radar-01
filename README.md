# Launch Radar — a token launch radar for make.fun's token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/faldysetyawan/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/faldysetyawan/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar reads the sealed DefiLlama snapshot of the protocol universe, works out which protocols
still record no token and are not a wrapped, staked or bridged product of one that trades, ranks them
by what their launch would be worth, and hands in a dashboard that shows the board, a detail view for
every protocol, and the steps to farm each one.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22.18 or later, standard library only. The program writes `board.json` (the ranked board),
`data.js` (the dashboard's data), `dashboard/` and `screenshots/` (copied from this repository) and
`dossier.json` (built with `vendor/makefun-board.ts`) into the output directory. It is deterministic:
the same snapshot in, the same bytes out.

## The screen

One screen, applied at every size — the snapshot watchlist's own rule without its $50M floor. A
protocol is ranked when it records no token (no market cap, no CoinGecko id, no symbol) and is not a
product of a token that trades: its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid
Restaking, Restaked BTC or CEX, its name carries no whole word *wrapped*, *staked* or *staking*, no
version marker (V2, 2.0, …) and no exchange's name. On this snapshot the screen keeps 198 protocols —
all 40 watchlist protocols plus 158 early ones below the floor — and sets 144 wrapped, staked, bridged
and exchange products aside. Protocols whose token already trades are never ranked; the dashboard's
Live tokens view shows the largest of them with the market's own values.

## The value model (`launch-radar-2`, in `lib/model.ts`)

Implied value is calibrated from the snapshot itself, never from a list of names:

- **Peer multiple.** For each category, take the snapshot's live-token protocols in it that record a
  positive market cap, and the median of `mcap_usd / tvl_usd` — the price the market already pays for
  a dollar of TVL in that category. A category with fewer than 3 such peers falls back to the whole
  market's median ($0.214 per $1 of TVL on this snapshot, from 128 peers).
- **Base** = `tvl_usd × peer_multiple`.
- **Growth** = `1 + clamp(change_7d, -50, 100) / 100 × 0.35` (unreported growth counts as 0).
- **Maturity** = `0.70 + 0.30 × min(age_days, 1460) / 1460`, where age is the time since DefiLlama
  first tracked the protocol — how long it has run with no token (an unknown age counts as 365 days).
- **Implied value** = `max(1, round(base × growth × maturity))`, a whole number of dollars.

The same function scores every row. The dashboard states the formula, shows the calibration table,
decomposes every row's value in its detail view, recomputes the row in the page as a check against
`board.json`, and offers a what-if sandbox that re-ranks the board under different growth and
maturity weights (the board itself always carries the stated constants).

## Farm plans

Every row carries a seven-step farm plan derived from the protocol's own record — its category sets
the core action (supply and borrow for lending, swap and provide liquidity for a DEX, a delta-neutral
pair for basis trading, and so on), its chains set the gas tier and whether the plan repeats the
position on a second chain, its TVL sets the suggested capital ($50–$500), and its age sets the hold
(30–90 days). Each step states what it costs and how long it takes.

## Layout

- `main.ts` — the program: snapshot in, board, data, dashboard, screenshots and dossier out.
- `lib/model.ts` — the screen, the calibration, the value model and the farm plans.
- `vendor/makefun-board.ts` — the make.fun dossier library, as shipped in the competition kit.
- `dashboard/` — the static page (board, live view, model view, detail drawer); renders with no network.
- `screenshots/` — the board, a protocol's detail view and a filtered view, rendered from this page.

An implied value is this board's own claim about what a launch would be worth if a protocol's record
stayed as it is. It is not a prediction that a token will be issued, and it is not a price.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tznygv96&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
