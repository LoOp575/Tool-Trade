// DexScreener HTTP client. Public API, no key required.
// Docs: https://docs.dexscreener.com/api/reference

const BASE = 'https://api.dexscreener.com';
const USER_AGENT = 'ToolTrade-PumpRadar/0.2 (+https://github.com/LoOp575/Tool-Trade)';
const HTTP_TIMEOUT_MS = 8000;
const TOKEN_BATCH_SIZE = 30; // DexScreener token endpoint takes up to 30 addresses.

async function fetchJson(url, { timeoutMs = HTTP_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: controller.signal,
      // Let Next.js cache this on the edge for a short time.
      next: { revalidate: 15 },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBoostedTokens() {
  const urls = [
    `${BASE}/token-boosts/latest/v1`,
    `${BASE}/token-boosts/top/v1`,
  ];

  const results = await Promise.allSettled(urls.map((u) => fetchJson(u)));

  const seen = new Set();
  const out = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const list = Array.isArray(r.value) ? r.value : [];
    for (const item of list) {
      if (!item || !item.tokenAddress || !item.chainId) continue;
      const key = `${item.chainId}:${String(item.tokenAddress).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chainId: item.chainId, tokenAddress: item.tokenAddress });
    }
  }
  return out;
}

export async function fetchPairsForTokens(tokens) {
  if (!tokens.length) return [];

  const batches = [];
  for (let i = 0; i < tokens.length; i += TOKEN_BATCH_SIZE) {
    batches.push(tokens.slice(i, i + TOKEN_BATCH_SIZE));
  }

  const allPairs = [];
  const concurrency = 4;
  let cursor = 0;

  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      const addrs = batch.map((t) => t.tokenAddress).join(',');
      const url = `${BASE}/latest/dex/tokens/${addrs}`;
      try {
        const data = await fetchJson(url);
        const pairs = data && Array.isArray(data.pairs) ? data.pairs : [];
        allPairs.push(...pairs);
      } catch (err) {
        // Swallow single-batch errors so one bad batch doesn't sink the refresh.
        console.warn('[dexscreener] batch failed:', err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return allPairs;
}
