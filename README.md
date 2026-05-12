# Tool-Trade — Token Pump Radar

Next.js crypto analytics dashboard that ranks tokens by a **Final Pump
Score (FPS)**. Deployed on Vercel, data from DexScreener (public API,
no key required).

## Deploy to Vercel

1. Push this repo to GitHub (already done).
2. On vercel.com → **Add New → Project → Import** this repo.
3. Accept the defaults (framework: Next.js, build: `next build`, output: `.next`).
4. Deploy. No environment variables required.

## Local dev

```bash
npm install
npm run dev        # http://localhost:3000
```

## Architecture

```
app/
  api/
    tokens/route.js   GET /api/tokens   (the only data endpoint the frontend calls)
    health/route.js   GET /api/health
  layout.js           Root HTML layout
  page.js             Home page (server component shell)
  RadarTable.js       Client component: fetches /api/tokens, renders the table
  globals.css
lib/
  dexscreener.js      DexScreener HTTP client (public API, no key)
  scoring.js          FPS formula engine (all components normalised to [0,1])
  pipeline.js         fetch -> filter -> score -> sort -> top 100
```

- **Frontend** only calls `/api/tokens`. It never talks to DexScreener directly.
- **API route** runs on the Node.js runtime with `revalidate = 15` so the
  CDN serves the same response to every visitor for 15 s (keeps upstream
  request volume low).
- **Error handling**: the route never throws — it returns `{ ok: false, error }`
  with an empty `tokens` array. The frontend surfaces that in the table.

## Scoring

```
FPS = 25·VAI_norm + 20·PMI_norm + 20·BPR + 15·LSS + 10·SMS_norm + 10·AS_norm
```

| Component | What it measures                 | Source                                 |
| --------- | -------------------------------- | -------------------------------------- |
| VAI       | `V1h / (V6h / 6)` — vol. accel.  | DexScreener `volume.h1`, `volume.h6`   |
| PMI       | 1h price change (%)              | DexScreener `priceChange.h1`           |
| BPR       | `buys / (buys + sells)`, 1h      | DexScreener `txns.h1.buys/sells` (count proxy — per-side USD volumes are not exposed) |
| LSS       | `liquidity_now / liquidity_init` | defaults to `1.0` on Vercel serverless (no persistent baseline) |
| SMS       | Smart-money proxy                | BPR + 5m-vs-1h txn acceleration        |
| AS        | Age bucket                       | DexScreener `pairCreatedAt`            |

Status labels:

| FPS     | Status             |
| ------- | ------------------ |
| 80–100  | EARLY PUMP GEM     |
| 60–79   | WATCHLIST          |
| 40–59   | SIDEWAYS           |
| < 40    | NO TRADE           |

## Filtering (server-side)

- Top 100 by FPS.
- Liquidity must be ≥ `$10,000`.
- Pair must have at least one h1 buy txn.
- 1h volume must be positive.

## API

- `GET /api/tokens?filter=all|trending|new|highscore&search=<q>&limit=<n>` —
  filtered snapshot, always JSON.
- `GET /api/health` — liveness probe.
