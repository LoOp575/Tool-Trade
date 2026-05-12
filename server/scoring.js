'use strict';

// Final Pump Score engine.
//
// The spec defines six components whose weights sum to 100:
//   25 * VAI_norm  (Volume Acceleration Index)
//   20 * PMI_norm  (Price Momentum Index, 1h)
//   20 * BPR       (Buy Pressure Ratio)
//   15 * LSS       (Liquidity Stability Score)
//   10 * SMS       (Smart Money Score)
//   10 * AS        (Age Score)
//
// For FPS to land in [0, 100], every component must be normalised to [0, 1]
// before being multiplied by its weight. BPR is naturally [0, 1]; the others
// are squashed here (see *_norm helpers below).

const AGE_BUCKETS = [
  { maxHours: 24, score: 10 },          // < 24h
  { maxHours: 24 * 3, score: 7 },       // 24h - 3d
  { maxHours: 24 * 7, score: 4 },       // 3d - 7d
  { maxHours: Infinity, score: 1 }      // > 7d
];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// -------- Component calculators --------

// VAI = V1h / (V6h / 6). Normalised: min(VAI / 4, 1).
function vai(volume1h, volume6h) {
  const baseline = volume6h / 6;
  if (baseline <= 0) return { raw: 0, norm: 0 };
  const raw = volume1h / baseline;
  return { raw, norm: clamp01(raw / 4) };
}

// PMI = ((P_now - P_1h) / P_1h) * 100. Normalised: min(PMI / 20, 1).
// DexScreener already gives us priceChange.h1 as a percentage.
function pmi(priceChange1hPct) {
  const raw = num(priceChange1hPct, 0);
  return { raw, norm: clamp01(raw / 20) };
}

// BPR = buys / (buys + sells). DexScreener doesn't expose per-side USD volumes,
// so we use buy/sell transaction counts as a proxy (same formula shape).
function bpr(buys, sells) {
  const b = Math.max(0, num(buys));
  const s = Math.max(0, num(sells));
  const total = b + s;
  if (total <= 0) return { raw: 0, norm: 0, totalTxns: 0 };
  const raw = b / total;
  return { raw, norm: raw, totalTxns: total };
}

// LSS = liquidity_now / liquidity_initial. Clamped to [0, 1.2] and then to 1.
// >= 1.2 (strong inflow) earns the full 15 points; < 1.0 is penalised linearly.
function lss(liquidityNow, liquidityInitial) {
  const now = num(liquidityNow);
  const init = num(liquidityInitial);
  if (now <= 0 || init <= 0) return { raw: 1, norm: 1 };
  const raw = now / init;
  // Map [0, 1.2] -> [0, 1]; anything above 1.2 saturates at 1.
  return { raw, norm: clamp01(raw / 1.2) };
}

// SMS: DexScreener has no direct whale/smart-money feed, so we proxy it from
// sustained buy-side dominance and rising transaction velocity. Range [0, 10].
//
//   - Heavy buy dominance (BPR >= 0.75) and rising txns in the last hour -> up to 10
//   - Modest buy dominance (BPR >= 0.6) -> up to 6
//   - Otherwise scales linearly with BPR
function sms({ bprRaw, txns5m, txns1h, txns6h }) {
  const t5 = Math.max(0, num(txns5m));
  const t1 = Math.max(0, num(txns1h));
  const t6 = Math.max(0, num(txns6h));

  // 5m-per-minute rate vs. 1h-per-minute rate — are we accelerating?
  const rate5m = t5 / 5;
  const rate1h = t1 / 60;
  const accel = rate1h > 0 ? rate5m / rate1h : 0;

  // 1h-per-hour vs. 6h-per-hour — broader acceleration
  const rate6h = t6 / 6;
  const wider = rate6h > 0 ? t1 / rate6h : 0;

  const accelBoost = clamp01(accel / 2);   // 2x acceleration -> full boost
  const widerBoost = clamp01(wider / 2);

  let score;
  if (bprRaw >= 0.75) {
    score = 7 + 3 * (0.5 * accelBoost + 0.5 * widerBoost);
  } else if (bprRaw >= 0.6) {
    score = 4 + 2 * (0.5 * accelBoost + 0.5 * widerBoost);
  } else {
    score = Math.max(0, bprRaw * 6);
  }

  const raw = Math.max(0, Math.min(10, score));
  return { raw, norm: raw / 10 };
}

// AS: age buckets from spec. pairCreatedAt is ms since epoch.
function ageScore(pairCreatedAtMs, nowMs = Date.now()) {
  if (!pairCreatedAtMs) return { raw: 1, norm: 0.1, hours: null };
  const hours = (nowMs - pairCreatedAtMs) / 3_600_000;
  if (hours < 0) return { raw: 10, norm: 1, hours: 0 };
  const bucket = AGE_BUCKETS.find((b) => hours < b.maxHours);
  return { raw: bucket.score, norm: bucket.score / 10, hours };
}

// -------- Top-level: score a DexScreener pair --------

function scorePair(pair, liquidityInitialUsd) {
  const volumeH1 = num(pair?.volume?.h1);
  const volumeH6 = num(pair?.volume?.h6);
  const volumeH24 = num(pair?.volume?.h24);
  const priceChangeH1 = num(pair?.priceChange?.h1);

  const txnsM5 = (num(pair?.txns?.m5?.buys) + num(pair?.txns?.m5?.sells));
  const txnsH1Buys = num(pair?.txns?.h1?.buys);
  const txnsH1Sells = num(pair?.txns?.h1?.sells);
  const txnsH1 = txnsH1Buys + txnsH1Sells;
  const txnsH6 = num(pair?.txns?.h6?.buys) + num(pair?.txns?.h6?.sells);

  const liquidityUsd = num(pair?.liquidity?.usd);

  const vaiPart = vai(volumeH1, volumeH6);
  const pmiPart = pmi(priceChangeH1);
  const bprPart = bpr(txnsH1Buys, txnsH1Sells);
  const lssPart = lss(liquidityUsd, liquidityInitialUsd || liquidityUsd);
  const smsPart = sms({
    bprRaw: bprPart.raw,
    txns5m: txnsM5,
    txns1h: txnsH1,
    txns6h: txnsH6
  });
  const asPart = ageScore(pair?.pairCreatedAt);

  const fps =
    25 * vaiPart.norm +
    20 * pmiPart.norm +
    20 * bprPart.norm +
    15 * lssPart.norm +
    10 * smsPart.norm +
    10 * asPart.norm;

  return {
    fps: Math.round(fps * 10) / 10,
    components: {
      vai: round3(vaiPart.raw),
      vaiNorm: round3(vaiPart.norm),
      pmi: round3(pmiPart.raw),
      pmiNorm: round3(pmiPart.norm),
      bpr: round3(bprPart.raw),
      lss: round3(lssPart.raw),
      sms: round3(smsPart.raw),
      ageScore: asPart.raw,
      ageHours: asPart.hours == null ? null : Math.round(asPart.hours * 10) / 10
    },
    signals: {
      volumeH1,
      volumeH6,
      volumeH24,
      priceChangeH1,
      liquidityUsd,
      buys1h: txnsH1Buys,
      sells1h: txnsH1Sells
    }
  };
}

function interpretFps(fps) {
  if (fps >= 80) return 'EARLY_PUMP_GEM';
  if (fps >= 60) return 'WATCHLIST';
  if (fps >= 40) return 'SIDEWAYS';
  return 'NO_TRADE';
}

function round3(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 1000) / 1000;
}

module.exports = {
  scorePair,
  interpretFps,
  // Exposed for unit tests / debugging
  _internals: { vai, pmi, bpr, lss, sms, ageScore, clamp01 }
};
