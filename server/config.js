'use strict';

// Central configuration. All durations in milliseconds, all thresholds in USD.
module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,

  // How often the background worker refreshes data.
  refreshIntervalMs: parseInt(process.env.REFRESH_INTERVAL_MS, 10) || 20_000,

  // Upper bound on tokens returned to the client.
  maxResults: 100,

  // Filtering rules from the spec.
  minLiquidityUsd: 10_000,

  // DexScreener limits: token endpoint accepts up to 30 comma-separated addresses.
  tokenBatchSize: 30,

  // Cap total pairs processed per refresh to keep latency low.
  maxPairsPerRefresh: 300,

  // HTTP timeouts (ms) for upstream calls.
  httpTimeoutMs: 8_000,

  dexscreener: {
    base: 'https://api.dexscreener.com',
    // Boosted / trending feeds seed the universe of tokens we track.
    boostsLatest: '/token-boosts/latest/v1',
    boostsTop: '/token-boosts/top/v1',
    // Detail endpoint: /latest/dex/tokens/{addr1,addr2,...}
    tokensByAddress: '/latest/dex/tokens/'
  }
};
