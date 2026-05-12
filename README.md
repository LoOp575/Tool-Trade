# Tool-Trade — Token Pump Radar

Lightweight crypto analytics web app that ranks tokens by a **Final Pump Score
(FPS)** so you can spot early pump / hype momentum before it fully breaks out.

- Zero runtime dependencies (Node.js built-ins only).
- Data source: [DexScreener](https://docs.dexscreener.com/api/reference) public
  API. Frontend never calls third-party APIs directly — everything is cached
  server-side.
- Backend refreshes every 20 s (configurable). Frontend polls the cached
  snapshot.
- Compact dark-mode table: search, sort by FPS, filter by Trending / New /
  High Score.

## Quick start

```bash
node server/index.js        # or: npm start
```

Open `http://localhost:3000`.

Configuration via environment variables:

| Variable               | Default | Description                              |
| ---------------------- | ------- | ---------------------------------------- |
| `PORT`                 | `3000`  | HTTP port                                |
| `REFRESH_INTERVAL_MS`  | `20000` | Background refresh cadence               |

## Scoring

FPS is a weighted sum (0–100) of six normalised components:

```
FPS = 25·VAI_norm + 20·PMI_norm + 20·BPR + 15·LSS + 10·SMS + 10·AS
```

| Component | What it measures                 | Source                                 |
| --------- | -------------------------------- | -------------------------------------- |
| VAI       | `V1h / (V6h / 6)` — vol. accel.  | DexScreener `volume.h1`, `volume.h6`   |
| PMI       | 1h price change (%)              | DexScreener `priceChange.h1`           |
| BPR       | `buys / (buys + sells)`, 1h      | DexScreener `txns.h1.buys/sells` (count proxy — per-side USD volumes are not exposed) |
| LSS       | `liquidity_now / liquidity_init` | first-seen liquidity cached per pair   |
| SMS       | Smart-money proxy                | BPR + 5m-vs-1h txn acceleration        |
| AS        | Age bucket                       | DexScreener `pairCreatedAt`            |

Status labels:

| FPS     | Status             |
| ------- | ------------------ |
| 80–100  | EARLY PUMP GEM     |
| 60–79   | WATCHLIST          |
| 40–59   | SIDEWAYS           |
| < 40    | NO TRADE           |

## Filtering rules (enforced server-side)

- Top 100 by FPS.
- Liquidity must be ≥ `$10,000`.
- Pair must have at least one h1 buy txn.
- 1h volume must be positive.

## API

- `GET /api/tokens?filter=all|trending|new|highscore&search=<q>&limit=<n>` —
  returns the cached snapshot.
- `GET /api/health` — uptime / refresh counters.

## Layout

```
server/
  index.js              HTTP server (Node built-in http)
  cache.js              Background refresh loop + in-memory snapshot
  scoring.js            FPS formula engine
  config.js             Env-driven config
  sources/
    dexscreener.js      Upstream HTTP client
public/
  index.html            Dark-mode compact table
  styles.css
  app.js                Frontend polling + rendering
```
