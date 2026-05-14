'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_MS = 15_000;

function fmtUsd(n) {
  if (!Number.isFinite(n) || n === 0) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
}
function fmtPrice(n) {
  if (!Number.isFinite(n) || n === 0) return '–';
  if (n >= 1) return '$' + n.toFixed(2);
  const digits = Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(n))));
  return '$' + n.toFixed(digits);
}
function fmtPct(n) {
  if (!Number.isFinite(n)) return '–';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(2) + '%';
}
function fmtAgo(ts) {
  if (!ts) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const h = Math.floor(min / 60);
  return h + 'h ago';
}
function fmtAge(hours) {
  if (!Number.isFinite(hours)) return '–';
  if (hours < 1) return Math.round(hours * 60) + 'm';
  if (hours < 24) return Math.round(hours) + 'h';
  return Math.round(hours / 24) + 'd';
}
function pctClass(n) {
  if (!Number.isFinite(n) || n === 0) return 'pct-zero';
  return n > 0 ? 'pct-pos' : 'pct-neg';
}
function fpsClass(fps) {
  if (fps >= 80) return 'fps fps-gem';
  if (fps >= 65) return 'fps fps-watch';
  if (fps >= 50) return 'fps fps-ok';
  if (fps >= 35) return 'fps fps-side';
  return 'fps fps-no';
}
function riskClass(penalty) {
  if (!Number.isFinite(penalty)) return 'risk risk-mid';
  if (penalty <= 8) return 'risk risk-low';
  if (penalty <= 20) return 'risk risk-mid';
  return 'risk risk-high';
}
function compactStatus(status) {
  if (!status) return '–';
  return String(status).replace('EARLY_PUMP_GEM', 'GEM').replace('STRONG_WATCH', 'STRONG').replace('WATCHLIST', 'WATCH').replace('WEAK_SIGNAL', 'WEAK').replace('NO_TRADE', 'SKIP');
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'trending', label: 'Strong (FPS ≥ 65)' },
  { id: 'new', label: 'New (<24h)' },
  { id: 'highscore', label: 'Gem (FPS ≥ 80)' },
];

export default function RadarTable() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [data, setData] = useState({ tokens: [], updatedAt: null, totalAvailable: 0, warning: null });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const abortRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const params = new URLSearchParams();
    if (filter && filter !== 'all') params.set('filter', filter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    const url = '/api/tokens' + (params.toString() ? '?' + params.toString() : '');
    try {
      const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const tokens = Array.isArray(json?.tokens) ? json.tokens : [];
      setData({ tokens, updatedAt: json?.updatedAt ?? Date.now(), totalAvailable: Number(json?.totalAvailable) || tokens.length, warning: json?.warning || null });
      if (json?.ok === false) {
        setStatus('error');
        setError(json?.error || 'API reported an error');
      } else {
        setStatus('live');
        setError(null);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setStatus('error');
      setError(err.message || String(err));
    }
  }, [filter, debouncedSearch]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { tokens, updatedAt, totalAvailable, warning } = data;
  const statusChipClass = status === 'error' ? 'chip chip-err' : status === 'loading' ? 'chip chip-loading' : tokens.length ? 'chip chip-ok' : 'chip chip-idle';
  const statusLabel = status === 'error' ? 'error' : status === 'loading' ? 'loading' : tokens.length ? 'live' : 'idle';
  const engineVersion = tokens.find((t) => t?.components?.version)?.components?.version || 'FPS_V2';

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-name">Token Pump Radar</span>
          <span className="brand-sub">{engineVersion} scoring</span>
        </div>
        <div className="meta">
          <span className={statusChipClass} title={error || warning || ''}>{statusLabel}</span>
          <span className="muted">{tokens.length} / {totalAvailable || tokens.length} tokens</span>
          <span className="muted" key={tick}>updated {fmtAgo(updatedAt)}</span>
        </div>
      </header>

      <section className="controls">
        <input className="search-input" type="search" placeholder="Search token / symbol / chain" value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" spellCheck={false} />
        <div className="filters" role="tablist" aria-label="filters">
          {FILTERS.map((f) => (
            <button key={f.id} className={'filter' + (filter === f.id ? ' active' : '')} onClick={() => setFilter(f.id)} type="button">{f.label}</button>
          ))}
        </div>
      </section>

      <main>
        <table className="tokens">
          <thead>
            <tr>
              <th className="col-rank">#</th>
              <th className="col-token">Token</th>
              <th className="col-num">Price</th>
              <th className="col-num">Vol 1h</th>
              <th className="col-num">Liquidity</th>
              <th className="col-num">%1h</th>
              <th className="col-num">Age</th>
              <th className="col-num">Risk</th>
              <th className="col-num">Signal</th>
              <th className="col-num col-fps">FPS V2 ▼</th>
            </tr>
          </thead>
          <tbody>
            {status === 'loading' && tokens.length === 0 && <tr className="placeholder"><td colSpan={10}>Loading…</td></tr>}
            {status !== 'loading' && tokens.length === 0 && (
              <tr className="placeholder"><td colSpan={10}>{error ? `Error: ${error}` : warning ? `No tokens yet (${warning}). Retrying in 15s…` : 'No tokens match this filter.'}</td></tr>
            )}
            {tokens.map((t, i) => {
              const pct1h = t.priceChange?.h1 ?? 0;
              const penalty = Number(t.components?.riskPenalty);
              const ageHours = Number(t.components?.ageHours);
              return (
                <tr key={t.id || `${t.chain}:${t.pairAddress}:${i}`}>
                  <td className="col-rank">{i + 1}</td>
                  <td className="col-token">
                    <div className="token-cell">
                      <a className="token-symbol" href={t.url || '#'} target="_blank" rel="noopener noreferrer">{t.symbol || '—'}</a>
                      <span className="token-name" title={t.name}>{t.name}</span>
                      <span className="token-chain">{t.chain}/{t.dex || ''}</span>
                    </div>
                  </td>
                  <td className="col-num">{fmtPrice(t.priceUsd)}</td>
                  <td className="col-num">{fmtUsd(t.volume?.h1)}</td>
                  <td className="col-num">{fmtUsd(t.liquidityUsd)}</td>
                  <td className={'col-num ' + pctClass(pct1h)}>{fmtPct(pct1h)}</td>
                  <td className="col-num muted">{fmtAge(ageHours)}</td>
                  <td className="col-num"><span className={riskClass(penalty)} title={`Penalty: ${Number.isFinite(penalty) ? penalty.toFixed(1) : '–'}`}>{Number.isFinite(penalty) ? penalty.toFixed(1) : '–'}</span></td>
                  <td className="col-num"><span className={fpsClass(t.fps)}>{compactStatus(t.status)}</span></td>
                  <td className="col-num col-fps"><span className={fpsClass(t.fps)}>{Number(t.fps).toFixed(1)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>

      <footer className="footnote">
        <span>FPS_V2 = VAI + PMI + BPR + TXA + LQS + AGE + MCAP + MOM + RISK − penalty</span>
        <span className="legend">
          <span className="tag tag-gem">80+ Gem</span>
          <span className="tag tag-watch">65+ Strong</span>
          <span className="tag tag-ok">50+ Watch</span>
          <span className="tag tag-side">35+ Weak</span>
          <span className="tag tag-no">&lt;35 Skip</span>
        </span>
      </footer>
    </>
  );
}
