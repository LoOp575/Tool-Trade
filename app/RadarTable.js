'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const REFRESH_MS = 15_000;

// ---------- formatting helpers ----------
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
function pctClass(n) {
  if (!Number.isFinite(n) || n === 0) return 'pct-zero';
  return n > 0 ? 'pct-pos' : 'pct-neg';
}
function fpsClass(fps) {
  if (fps >= 80) return 'fps fps-gem';
  if (fps >= 60) return 'fps fps-watch';
  if (fps >= 40) return 'fps fps-side';
  return 'fps fps-no';
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'trending', label: 'Trending (FPS ≥ 60)' },
  { id: 'new', label: 'New (<24h)' },
  { id: 'highscore', label: 'High Score (FPS ≥ 80)' },
];

export default function RadarTable() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [data, setData] = useState({
    tokens: [],
    updatedAt: null,
    totalAvailable: 0,
    warning: null,
  });
  const [status, setStatus] = useState('loading'); // 'loading' | 'live' | 'error'
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0); // forces "updated Xs ago" redraw
  const abortRef = useRef(null);

  // Debounce search input (180ms).
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    // Cancel any in-flight request.
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

      // API always returns 200 with `ok: true|false`; handle both shapes safely.
      const tokens = Array.isArray(json?.tokens) ? json.tokens : [];
      setData({
        tokens,
        updatedAt: json?.updatedAt ?? Date.now(),
        totalAvailable: Number(json?.totalAvailable) || tokens.length,
        warning: json?.warning || null,
      });

      if (json?.ok === false) {
        setStatus('error');
        setError(json?.error || 'API reported an error');
      } else if (tokens.length === 0 && json?.warning) {
        setStatus('live');
        setError(null);
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

  // Initial + polling fetch. Also refetches on filter/search change.
  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [load]);

  // Keep "updated Xs ago" fresh without hitting the API.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { tokens, updatedAt, totalAvailable, warning } = data;

  const statusChipClass =
    status === 'error'
      ? 'chip chip-err'
      : status === 'loading'
      ? 'chip chip-loading'
      : tokens.length
      ? 'chip chip-ok'
      : 'chip chip-idle';

  const statusLabel =
    status === 'error'
      ? 'error'
      : status === 'loading'
      ? 'loading'
      : tokens.length
      ? 'live'
      : 'idle';

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span className="brand-name">Token Pump Radar</span>
          <span className="brand-sub">FPS-based ranking</span>
        </div>
        <div className="meta">
          <span className={statusChipClass} title={error || warning || ''}>
            {statusLabel}
          </span>
          <span className="muted">
            {tokens.length} / {totalAvailable || tokens.length} tokens
          </span>
          <span className="muted" key={tick}>
            updated {fmtAgo(updatedAt)}
          </span>
        </div>
      </header>

      <section className="controls">
        <input
          className="search-input"
          type="search"
          placeholder="Search token / symbol / chain"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="filters" role="tablist" aria-label="filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={'filter' + (filter === f.id ? ' active' : '')}
              onClick={() => setFilter(f.id)}
              type="button"
            >
              {f.label}
            </button>
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
              <th className="col-num">Vol 24h</th>
              <th className="col-num">Liquidity</th>
              <th className="col-num">MC/FDV</th>
              <th className="col-num">%1h</th>
              <th className="col-num col-fps">FPS ▼</th>
            </tr>
          </thead>
          <tbody>
            {status === 'loading' && tokens.length === 0 && (
              <tr className="placeholder">
                <td colSpan={9}>Loading…</td>
              </tr>
            )}

            {status !== 'loading' && tokens.length === 0 && (
              <tr className="placeholder">
                <td colSpan={9}>
                  {error
                    ? `Error: ${error}`
                    : warning
                    ? `No tokens yet (${warning}). Retrying in 15s…`
                    : 'No tokens match this filter.'}
                </td>
              </tr>
            )}

            {tokens.map((t, i) => {
              const pct1h = t.priceChange?.h1 ?? 0;
              return (
                <tr key={t.id || `${t.chain}:${t.pairAddress}:${i}`}>
                  <td className="col-rank">{i + 1}</td>
                  <td className="col-token">
                    <div className="token-cell">
                      <a
                        className="token-symbol"
                        href={t.url || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.symbol || '—'}
                      </a>
                      <span className="token-name" title={t.name}>
                        {t.name}
                      </span>
                      <span className="token-chain">
                        {t.chain}/{t.dex || ''}
                      </span>
                    </div>
                  </td>
                  <td className="col-num">{fmtPrice(t.priceUsd)}</td>
                  <td className="col-num">{fmtUsd(t.volume?.h1)}</td>
                  <td className="col-num">{fmtUsd(t.volume?.h24)}</td>
                  <td className="col-num">{fmtUsd(t.liquidityUsd)}</td>
                  <td className="col-num">{fmtUsd(t.marketCap || t.fdv)}</td>
                  <td className={'col-num ' + pctClass(pct1h)}>{fmtPct(pct1h)}</td>
                  <td className="col-num col-fps">
                    <span className={fpsClass(t.fps)}>{Number(t.fps).toFixed(1)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>

      <footer className="footnote">
        <span>FPS = 25·VAI + 20·PMI + 20·BPR + 15·LSS + 10·SMS + 10·AS</span>
        <span className="legend">
          <span className="tag tag-gem">80+ Gem</span>
          <span className="tag tag-watch">60+ Watch</span>
          <span className="tag tag-side">40+ Side</span>
          <span className="tag tag-no">&lt;40 Skip</span>
        </span>
      </footer>
    </>
  );
}
