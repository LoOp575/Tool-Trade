const MIN_LIQUIDITY_USD = 10_000;
const IDEAL_MIN_LIQUIDITY_USD = 50_000;
const MCAP_SWEET_MIN = 50_000;
const MCAP_SWEET_MAX = 5_000_000;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(x, min = 0, max = 1) {
  if (!Number.isFinite(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function clamp01(x) {
  return clamp(x, 0, 1);
}

function round1(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
}

function round3(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 1000) / 1000;
}

function volumeAcceleration(volume1h, volume6h) {
  const v1 = Math.max(0, num(volume1h));
  const v6 = Math.max(0, num(volume6h));
  const baseline = v6 / 6;
  if (baseline <= 0) return { raw: 0, norm: 0 };
  const raw = v1 / baseline;
  return { raw, norm: clamp01(raw / 4) };
}

function priceMomentum(priceChange1hPct) {
  const raw = num(priceChange1hPct);
  return { raw, norm: clamp01(raw / 20) };
}

function buyPressureRatio(buys, sells) {
  const b = Math.max(0, num(buys));
  const s = Math.max(0, num(sells));
  const total = b + s;
  if (total <= 0) return { raw: 0, norm: 0, buys: b, sells: s, total };
  const raw = b / total;
  return { raw, norm: clamp01(raw), buys: b, sells: s, total };
}

function transactionAcceleration(txns5m, txns1h) {
  const t5 = Math.max(0, num(txns5m));
  const t1 = Math.max(0, num(txns1h));
  const rate5m = t5 / 5;
  const rate1h = t1 / 60;
  if (rate1h <= 0) return { raw: 0, norm: 0, rate5m, rate1h };
  const raw = rate5m / rate1h;
  return { raw, norm: clamp01(raw / 3), rate5m, rate1h };
}

function liquidityQuality(liquidityUsd, marketCapOrFdv) {
  const liq = Math.max(0, num(liquidityUsd));
  const cap = Math.max(0, num(marketCapOrFdv));
  const absolute = clamp01(liq / IDEAL_MIN_LIQUIDITY_USD);
  const ratio = cap > 0 ? liq / cap : 0;
  let ratioNorm = 0;
  if (ratio > 0) {
    if (ratio < 0.02) ratioNorm = ratio / 0.02 * 0.4;
    else if (ratio <= 0.25) ratioNorm = 0.4 + ((ratio - 0.02) / 0.23) * 0.6;
    else ratioNorm = 1;
  }
  const norm = clamp01(0.65 * absolute + 0.35 * ratioNorm);
  return { raw: ratio, norm, liquidityUsd: liq, liquidityToCap: ratio };
}

function ageScore(pairCreatedAtMs, nowMs = Date.now()) {
  if (!pairCreatedAtMs) return { raw: 0, norm: 0.25, hours: null };
  const hours = Math.max(0, (nowMs - num(pairCreatedAtMs)) / 3_600_000);
  let norm;
  if (hours < 1) norm = 0.45;
  else if (hours <= 6) norm = 0.95;
  else if (hours <= 72) norm = 1;
  else if (hours <= 168) norm = 0.65;
  else if (hours <= 720) norm = 0.35;
  else norm = 0.2;
  return { raw: norm * 10, norm, hours };
}

function marketCapSweetSpot(marketCap, fdv) {
  const cap = Math.max(0, num(marketCap) || num(fdv));
  if (cap <= 0) return { raw: 0, norm: 0, cap };
  if (cap < MCAP_SWEET_MIN) return { raw: cap, norm: clamp01(cap / MCAP_SWEET_MIN) * 0.65, cap };
  if (cap <= MCAP_SWEET_MAX) return { raw: cap, norm: 1, cap };
  const decay = 1 - Math.log10(cap / MCAP_SWEET_MAX) / 1.2;
  return { raw: cap, norm: clamp(decay, 0.15, 1), cap };
}

function multiTimeframeMomentum({ m5, h1, h6, h24 }) {
  const p5 = num(m5);
  const p1 = num(h1);
  const p6 = num(h6);
  const p24 = num(h24);
  const m5Norm = clamp01(p5 / 5);
  const h1Norm = clamp01(p1 / 20);
  const h6Norm = clamp01(p6 / 60);
  const h24Norm = clamp01(p24 / 150);
  let alignment = 0;
  if (p5 > 0) alignment += 0.2;
  if (p1 > 0) alignment += 0.35;
  if (p6 > 0) alignment += 0.25;
  if (p24 > 0) alignment += 0.2;
  const weighted = 0.25 * m5Norm + 0.4 * h1Norm + 0.2 * h6Norm + 0.15 * h24Norm;
  const raw = 10 * clamp01(0.7 * weighted + 0.3 * alignment);
  return { raw, norm: raw / 10, m5: p5, h1: p1, h6: p6, h24: p24 };
}

function riskPenalty({ liquidityUsd, marketCap, fdv, priceChangeM5, priceChangeH1, priceChangeH6, priceChangeH24, bprRaw, txnsH1 }) {
  const liq = Math.max(0, num(liquidityUsd));
  const cap = Math.max(0, num(marketCap) || num(fdv));
  const p5 = num(priceChangeM5);
  const p1 = num(priceChangeH1);
  const p6 = num(priceChangeH6);
  const p24 = num(priceChangeH24);
  const tx1 = Math.max(0, num(txnsH1));
  let rugRisk = 0;
  if (liq < MIN_LIQUIDITY_USD) rugRisk += 18;
  else if (liq < IDEAL_MIN_LIQUIDITY_USD) rugRisk += 8 * (1 - liq / IDEAL_MIN_LIQUIDITY_USD);
  if (cap > 0) {
    const liqRatio = liq / cap;
    if (liqRatio < 0.01) rugRisk += 10;
    else if (liqRatio < 0.03) rugRisk += 5;
  }
  let overPumpRisk = 0;
  if (p5 > 25) overPumpRisk += 8;
  if (p1 > 60) overPumpRisk += 10;
  if (p6 > 160) overPumpRisk += 8;
  if (p24 > 350) overPumpRisk += 8;
  let lowLiquidityRisk = 0;
  if (liq < MIN_LIQUIDITY_USD) lowLiquidityRisk = 15;
  else if (liq < IDEAL_MIN_LIQUIDITY_USD) lowLiquidityRisk = 8 * (1 - liq / IDEAL_MIN_LIQUIDITY_USD);
  let sellPressureRisk = 0;
  if (bprRaw < 0.45) sellPressureRisk += 12;
  else if (bprRaw < 0.55) sellPressureRisk += 6;
  if (tx1 < 10) sellPressureRisk += 6;
  let abnormalMoveRisk = 0;
  if (p5 < -8 && p1 > 10) abnormalMoveRisk += 4;
  if (p1 < -10) abnormalMoveRisk += 8;
  if (p24 < -35) abnormalMoveRisk += 6;
  const total = rugRisk + overPumpRisk + lowLiquidityRisk + sellPressureRisk + abnormalMoveRisk;
  const norm = clamp01(1 - total / 50);
  return { total, norm, rugRisk, overPumpRisk, lowLiquidityRisk, sellPressureRisk, abnormalMoveRisk };
}

export function scorePair(pair, liquidityInitialUsd) {
  const volumeH1 = num(pair?.volume?.h1);
  const volumeH6 = num(pair?.volume?.h6);
  const volumeH24 = num(pair?.volume?.h24);
  const priceChangeM5 = num(pair?.priceChange?.m5);
  const priceChangeH1 = num(pair?.priceChange?.h1);
  const priceChangeH6 = num(pair?.priceChange?.h6);
  const priceChangeH24 = num(pair?.priceChange?.h24);
  const txnsM5Buys = num(pair?.txns?.m5?.buys);
  const txnsM5Sells = num(pair?.txns?.m5?.sells);
  const txnsH1Buys = num(pair?.txns?.h1?.buys);
  const txnsH1Sells = num(pair?.txns?.h1?.sells);
  const txnsH6Buys = num(pair?.txns?.h6?.buys);
  const txnsH6Sells = num(pair?.txns?.h6?.sells);
  const txnsM5 = txnsM5Buys + txnsM5Sells;
  const txnsH1 = txnsH1Buys + txnsH1Sells;
  const txnsH6 = txnsH6Buys + txnsH6Sells;
  const liquidityUsd = num(pair?.liquidity?.usd);
  const marketCap = num(pair?.marketCap);
  const fdv = num(pair?.fdv);
  const cap = marketCap || fdv;
  const vaiPart = volumeAcceleration(volumeH1, volumeH6);
  const pmiPart = priceMomentum(priceChangeH1);
  const bprPart = buyPressureRatio(txnsH1Buys, txnsH1Sells);
  const txaPart = transactionAcceleration(txnsM5, txnsH1);
  const lqsPart = liquidityQuality(liquidityUsd, cap);
  const agePart = ageScore(pair?.pairCreatedAt);
  const mcapPart = marketCapSweetSpot(marketCap, fdv);
  const momPart = multiTimeframeMomentum({ m5: priceChangeM5, h1: priceChangeH1, h6: priceChangeH6, h24: priceChangeH24 });
  const riskPart = riskPenalty({ liquidityUsd, marketCap, fdv, priceChangeM5, priceChangeH1, priceChangeH6, priceChangeH24, bprRaw: bprPart.raw, txnsH1 });
  const fpsV2 = 18 * vaiPart.norm + 14 * pmiPart.norm + 14 * bprPart.norm + 12 * txaPart.norm + 10 * lqsPart.norm + 10 * agePart.norm + 8 * mcapPart.norm + 8 * momPart.norm + 6 * riskPart.norm;
  const finalScore = clamp(fpsV2 - riskPart.total, 0, 100);
  return {
    fps: round1(finalScore),
    components: {
      version: 'FPS_V2',
      vai: round3(vaiPart.raw), vaiNorm: round3(vaiPart.norm),
      pmi: round3(pmiPart.raw), pmiNorm: round3(pmiPart.norm),
      bpr: round3(bprPart.raw), bprNorm: round3(bprPart.norm),
      txa: round3(txaPart.raw), txaNorm: round3(txaPart.norm),
      lqs: round3(lqsPart.raw), lqsNorm: round3(lqsPart.norm), liquidityToCap: round3(lqsPart.liquidityToCap),
      ageScore: round3(agePart.raw), ageNorm: round3(agePart.norm), ageHours: agePart.hours == null ? null : round1(agePart.hours),
      mcapScore: round3(mcapPart.raw), mcapNorm: round3(mcapPart.norm),
      mom: round3(momPart.raw), momNorm: round3(momPart.norm),
      risk: round3(riskPart.norm), riskPenalty: round3(riskPart.total),
      rugRisk: round3(riskPart.rugRisk), overPumpRisk: round3(riskPart.overPumpRisk), lowLiquidityRisk: round3(riskPart.lowLiquidityRisk), sellPressureRisk: round3(riskPart.sellPressureRisk), abnormalMoveRisk: round3(riskPart.abnormalMoveRisk),
      rawScore: round3(fpsV2),
    },
    signals: {
      volumeH1, volumeH6, volumeH24,
      priceChangeM5, priceChangeH1, priceChangeH6, priceChangeH24,
      liquidityUsd, marketCap, fdv,
      buys5m: txnsM5Buys, sells5m: txnsM5Sells,
      buys1h: txnsH1Buys, sells1h: txnsH1Sells,
      txns5m: txnsM5, txns1h: txnsH1, txns6h: txnsH6,
      liquidityInitialUsd: num(liquidityInitialUsd || liquidityUsd),
    },
  };
}

export function interpretFps(fps) {
  if (fps >= 80) return 'EARLY_PUMP_GEM';
  if (fps >= 65) return 'STRONG_WATCH';
  if (fps >= 50) return 'WATCHLIST';
  if (fps >= 35) return 'WEAK_SIGNAL';
  return 'NO_TRADE';
}
