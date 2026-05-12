// Data pipeline: fetch -> filter -> score -> sort -> top N.
// Called by the /api/tokens route.

import { fetchBoostedTokens, fetchPairsForTokens } from './dexscreener';
import { scorePair, interpretFps } from './scoring';

const MIN_LIQUIDITY_USD = 10_000;
const MAX_RESULTS = 100;
const MAX_PAIRS_PER_REFRESH = 300;

function pickBestPair(pairs) {
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
    const key = `${chain}:${String(addr).toLowerCase()}`;
    if (!byToken.has(key)) byToken.set(key, []);
    byToken.get(key).push(p);
  }
  return byToken;
}

function passesFilters(pair) {
  if ((Number(pair?.liquidity?.usd) || 0) < MIN_LIQUIDITY_USD) return false;
  if ((Number(pair?.txns?.h1?.buys) || 0) < 1) return false;
  if ((Number(pair?.volume?.h1) || 0) <= 0) return false;
  return true;
}

function ageBucketOf(hours) {
  if (hours == null) return 'unknown';
  if (hours < 24) return 'new';
  if (hours < 24 * 7) return 'recent';
  return 'established';
}

function buildTokenRow(pair, score) {
  return {
    id: `${pair.chainId}:${String(pair.baseToken?.address || '').toLowerCase()}`,
    chain: pair.chainId,
    dex: pair.dexId,
    pairAddress: pair.pairAddress,
    url: pair.url,
    name: pair.baseToken?.name || pair.baseToken?.symbol || 'Unknown',
    symbol: pair.baseToken?.symbol || '',
    quoteSymbol: pair.quoteToken?.symbol || '',

    priceUsd: Number(pair.priceUsd) || 0,
    priceChange: {
      m5: Number(pair.priceChange?.m5) || 0,
      h1: Number(pair.priceChange?.h1) || 0,
      h24: Number(pair.priceChange?.h24) || 0,
    },
    volume: {
      h1: Number(pair.volume?.h1) || 0,
      h6: Number(pair.volume?.h6) || 0,
      h24: Number(pair.volume?.h24) || 0,
    },
    liquidityUsd: Number(pair.liquidity?.usd) || 0,
    marketCap: Number(pair.marketCap) || Number(pair.fdv) || 0,
    fdv: Number(pair.fdv) || 0,
    pairCreatedAt: pair.pairCreatedAt || null,

    fps: score.fps,
    status: interpretFps(score.fps),
    components: score.components,
    ageBucket: ageBucketOf(score.components.ageHours),
  };
}

export async function buildSnapshot() {
  const started = Date.now();
  const tokens = await fetchBoostedTokens();
  if (!tokens.length) {
    return {
      updatedAt: Date.now(),
      tokens: [],
      tokenCount: 0,
      totalAvailable: 0,
      elapsedMs: Date.now() - started,
      warning: 'No tokens returned from boost feeds',
    };
  }

  const capped = tokens.slice(0, MAX_PAIRS_PER_REFRESH);
  const pairs = await fetchPairsForTokens(capped);
  const grouped = groupPairsByToken(pairs);

  const rows = [];
  for (const pairList of grouped.values()) {
    const best = pickBestPair(pairList);
    if (!best) continue;
    if (!passesFilters(best)) continue;

    // Without persistent cache in serverless, treat current liquidity as its
    // own baseline -> LSS = 1.0 (stable). Rest of the formula stays intact.
    const baseline = Number(best?.liquidity?.usd) || 0;
    const score = scorePair(best, baseline);
    rows.push(buildTokenRow(best, score));
  }

  rows.sort((a, b) => b.fps - a.fps);
  const top = rows.slice(0, MAX_RESULTS);

  return {
    updatedAt: Date.now(),
    tokens: top,
    tokenCount: top.length,
    totalAvailable: rows.length,
    elapsedMs: Date.now() - started,
    warning: null,
  };
}
