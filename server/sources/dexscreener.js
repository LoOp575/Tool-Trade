'use strict';

// DexScreener HTTP client. Uses the global fetch available in Node >= 18.
// Docs: https://docs.dexscreener.com/api/reference

const config = require('../config');

const USER_AGENT = 'ToolTrade-PumpRadar/0.1 (+https://github.com/LoOp575/Tool-Trade)';

async function fetchJson(url, { timeoutMs = config.httpTimeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Returns an array of { chainId, tokenAddress } harvested from both boost feeds.
async function fetchBoostedTokens() {
  const urls = [
    config.dexscreener.base + config.dexscreener.boostsLatest,
    config.dexscreener.base + config.dexscreener.boostsTop
  ];

  const results = await Promise.allSettled(urls.map((u) => fetchJson(u)));

  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const list = Array.isArray(r.value) ? r.value : [];
    for (const item of list) {
      if (!item || !item.tokenAddress || !item.chainId) continue;
      const key = `${item.chainId}:${item.tokenAddress.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chainId: item.chainId, tokenAddress: item.tokenAddress });
    }
  }
  return out;
}

// Fetches pair data for up to `tokenBatchSize` token addresses per request.
// Returns a flat array of pair objects.
async function fetchPairsForTokens(tokens) {
  if (!tokens.length) return [];

  const batches = [];
  for (let i = 0; i < tokens.length; i += config.tokenBatchSize) {
    batches.push(tokens.slice(i, i + config.tokenBatchSize));
  }

  const allPairs = [];
  // Run batches in parallel but cap concurrency to avoid rate limits.
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      const addrs = batch.map((t) => t.tokenAddress).join(',');
      const url = config.dexscreener.base + config.dexscreener.tokensByAddress + addrs;
      try {
        const data = await fetchJson(url);
        const pairs = (data && Array.isArray(data.pairs)) ? data.pairs : [];
        allPairs.push(...pairs);
      } catch (err) {
        // Swallow batch errors so one bad request doesn't sink the refresh.
        console.warn('[dexscreener] batch failed:', err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return allPairs;
}

module.exports = {
  fetchBoostedTokens,
  fetchPairsForTokens
};
