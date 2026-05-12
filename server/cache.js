'use strict';

// In-memory cache with a background refresh loop.
//
// Responsibilities:
//   1. Periodically pull the boosted/trending universe from DexScreener.
//   2. Fetch pair details in batches.
//   3. Remember the first-seen liquidity for every pair so LSS has a baseline.
//   4. Run the scoring engine, apply filters, keep only the top N by FPS.
//   5. Serve the latest snapshot synchronously to HTTP handlers.

const config = require('./config');
const dex = require('./sources/dexscreener');
const { scorePair, interpretFps } = require('./scoring');

const state = {
  // pairAddress -> { liquidityInitialUsd, firstSeenAt }
  pairBaseline: new Map(),

  // Latest computed snapshot served to the API.
  snapshot: {
    updatedAt: null,
    tokenCount: 0,
    tokens: [],
    lastError: null,
    refreshes: 0
  },

  refreshing: false,
  timer: null
};

function pickBestPair(pairs) {
  // DexScreener returns one row per pair; for a given token we keep the pair
  // with the deepest liquidity (most representative price).
  let best = null;
  for (const p of pairs) {
    const liq = Number(p?.liquidity?.usd) || 0;
    if (!best || liq > (Number(best?.liquidity?.usd) || 0)) best = p;
  }
  return best;
}

function groupPairsByToken(pairs) {
  const byToken = new Map();
  for (const p of pairs) {
    const addr = p?.baseToken?.address;
    const chain = p?.chainId;
    if (!addr || !chain) continue;
    const key = `${chain}:${addr.toLowerCase()}`;
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key).push(p);
  }
  return byToken;
}

function rememberBaseline(pair) {
  const key = pair?.pairAddress;
  if (!key) return Number(pair?.liquidity?.usd) || 0;
  const existing = state.pairBaseline.get(key);
  const currentLiq = Number(pair?.liquidity?.usd) || 0;
  if (!existing) {
    state.pairBaseline.set(key, {
      liquidityInitialUsd: currentLiq,
      firstSeenAt: Date.now()
    });
    return currentLiq;
  }
  return existing.liquidityInitialUsd || currentLiq;
}

function buildTokenRow(pair, score) {
  return {
    // Identity
    id: `${pair.chainId}:${pair.baseToken?.address?.toLowerCase()}`,
    chain: pair.chainId,
    dex: pair.dexId,
    pairAddress: pair.pairAddress,
    url: pair.url,
    name: pair.baseToken?.name || pair.baseToken?.symbol || 'Unknown',
    symbol: pair.baseToken?.symbol || '',
    quoteSymbol: pair.quoteToken?.symbol || '',

    // Market data
    priceUsd: Number(pair.priceUsd) || 0,
    priceChange: {
      m5: Number(pair.priceChange?.m5) || 0,
      h1: Number(pair.priceChange?.h1) || 0,
      h24: Number(pair.priceChange?.h24) || 0
    },
    volume: {
      h1: Number(pair.volume?.h1) || 0,
      h6: Number(pair.volume?.h6) || 0,
      h24: Number(pair.volume?.h24) || 0
    },
    liquidityUsd: Number(pair.liquidity?.usd) || 0,
    marketCap: Number(pair.marketCap) || Number(pair.fdv) || 0,
    fdv: Number(pair.fdv) || 0,
    pairCreatedAt: pair.pairCreatedAt || null,

    // Scoring
    fps: score.fps,
    status: interpretFps(score.fps),
    components: score.components
  };
}

function passesFilters(pair, score) {
  if ((Number(pair?.liquidity?.usd) || 0) < config.minLiquidityUsd) return false;
  // "Token tanpa buy activity nyata" -> require at least some real h1 buys.
  if ((Number(pair?.txns?.h1?.buys) || 0) < 1) return false;
  // "Volume spike tidak valid" -> V1h > 0 and V6h should be sane (non-negative).
  if ((Number(pair?.volume?.h1) || 0) <= 0) return false;
  return true;
}

function markAgeBucket(token) {
  const hours = token.components.ageHours;
  if (hours == null) return 'unknown';
  if (hours < 24) return 'new';
  if (hours < 24 * 7) return 'recent';
  return 'established';
}

async function refreshOnce() {
  if (state.refreshing) return;
  state.refreshing = true;
  const t0 = Date.now();
  try {
    const tokens = await dex.fetchBoostedTokens();
    if (!tokens.length) {
      state.snapshot = {
        ...state.snapshot,
        updatedAt: Date.now(),
        lastError: 'No tokens returned from boost feeds',
        refreshes: state.snapshot.refreshes + 1
      };
      return;
    }

    const capped = tokens.slice(0, config.maxPairsPerRefresh);
    const pairs = await dex.fetchPairsForTokens(capped);
    const grouped = groupPairsByToken(pairs);

    const rows = [];
    for (const pairList of grouped.values()) {
      const best = pickBestPair(pairList);
      if (!best) continue;

      const baseline = rememberBaseline(best);
      if (!passesFilters(best)) continue;

      const score = scorePair(best, baseline);
      const row = buildTokenRow(best, score);
      row.ageBucket = markAgeBucket(row);
      rows.push(row);
    }

    rows.sort((a, b) => b.fps - a.fps);
    const top = rows.slice(0, config.maxResults);

    state.snapshot = {
      updatedAt: Date.now(),
      tokenCount: top.length,
      tokens: top,
      lastError: null,
      refreshes: state.snapshot.refreshes + 1
    };

    const elapsed = Date.now() - t0;
    console.log(
      `[cache] refresh #${state.snapshot.refreshes} ok: ${top.length}/${rows.length} tokens in ${elapsed}ms`
    );
  } catch (err) {
    state.snapshot = {
      ...state.snapshot,
      updatedAt: Date.now(),
      lastError: err.message || String(err),
      refreshes: state.snapshot.refreshes + 1
    };
    console.warn('[cache] refresh failed:', err.message);
  } finally {
    state.refreshing = false;
  }
}

function start() {
  if (state.timer) return;
  // Kick one immediately, then on interval.
  refreshOnce();
  state.timer = setInterval(refreshOnce, config.refreshIntervalMs);
  state.timer.unref?.();
}

function stop() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function getSnapshot() {
  return state.snapshot;
}

module.exports = { start, stop, getSnapshot, refreshOnce };
