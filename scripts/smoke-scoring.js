'use strict';

// Offline unit check for the scoring engine. No network required.
const assert = require('node:assert');
const { scorePair, interpretFps, _internals } = require('../server/scoring');

// --- Interpretation buckets ---
assert.strictEqual(interpretFps(95), 'EARLY_PUMP_GEM');
assert.strictEqual(interpretFps(70), 'WATCHLIST');
assert.strictEqual(interpretFps(45), 'SIDEWAYS');
assert.strictEqual(interpretFps(10), 'NO_TRADE');

// --- Component bounds ---
const { vai, pmi, bpr, lss, sms, ageScore, clamp01 } = _internals;
assert.strictEqual(clamp01(-0.2), 0);
assert.strictEqual(clamp01(1.5), 1);

assert.deepStrictEqual(vai(0, 0), { raw: 0, norm: 0 });
const vaiStrong = vai(1000, 600); // baseline = 100 -> raw = 10 -> norm 1
assert.ok(vaiStrong.norm === 1 && vaiStrong.raw === 10);

assert.strictEqual(pmi(25).norm, 1);
assert.strictEqual(pmi(-5).norm, 0);
assert.strictEqual(pmi(10).norm, 0.5);

assert.deepStrictEqual(bpr(0, 0), { raw: 0, norm: 0, totalTxns: 0 });
const bprBull = bpr(80, 20);
assert.strictEqual(bprBull.raw, 0.8);

const lssStable = lss(1000, 1000);
assert.ok(lssStable.norm > 0.8 && lssStable.norm <= 1);

const smsHigh = sms({ bprRaw: 0.8, txns5m: 50, txns1h: 120, txns6h: 400 });
assert.ok(smsHigh.raw >= 7 && smsHigh.raw <= 10);

const now = Date.now();
assert.strictEqual(ageScore(now - 1 * 3600_000).raw, 10);      // <24h
assert.strictEqual(ageScore(now - 48 * 3600_000).raw, 7);      // 24h-3d
assert.strictEqual(ageScore(now - 5 * 24 * 3600_000).raw, 4);  // 3d-7d
assert.strictEqual(ageScore(now - 30 * 24 * 3600_000).raw, 1); // >7d

// --- End-to-end on a fake DexScreener pair ---
const fakePair = {
  chainId: 'solana',
  dexId: 'raydium',
  pairAddress: 'PAIR1',
  url: 'https://dexscreener.com/solana/pair1',
  baseToken: { address: '0xabc', name: 'FakeCoin', symbol: 'FAKE' },
  quoteToken: { symbol: 'SOL' },
  priceUsd: '0.0123',
  priceChange: { m5: 2.1, h1: 18, h24: 45 },
  volume: { h1: 250_000, h6: 600_000, h24: 900_000 },
  txns: {
    m5: { buys: 40, sells: 10 },
    h1: { buys: 400, sells: 100 },
    h6: { buys: 1500, sells: 600 }
  },
  liquidity: { usd: 120_000 },
  marketCap: 4_500_000,
  fdv: 5_000_000,
  pairCreatedAt: now - 5 * 3600_000
};

const result = scorePair(fakePair, 100_000);
console.log('FPS:', result.fps, 'status:', interpretFps(result.fps));
console.log('components:', result.components);
assert.ok(result.fps > 0 && result.fps <= 100, 'FPS out of bounds');
// This pair is obviously pump-shaped -> expect high FPS.
assert.ok(result.fps >= 80, `expected gem, got ${result.fps}`);

// --- FPS upper bound under extreme inputs (must still be <= 100) ---
const extreme = scorePair({
  ...fakePair,
  priceChange: { h1: 500 },
  volume: { h1: 1e9, h6: 1 },
  txns: {
    m5: { buys: 1e6, sells: 0 },
    h1: { buys: 1e6, sells: 0 },
    h6: { buys: 1, sells: 0 }
  },
  liquidity: { usd: 1e9 },
  pairCreatedAt: now - 1000
}, 1);
assert.ok(extreme.fps <= 100 + 1e-6, `FPS exceeded 100: ${extreme.fps}`);

console.log('OK: all scoring assertions passed');
