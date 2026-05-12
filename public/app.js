'use strict';

// Token Pump Radar — frontend. Zero dependencies, vanilla DOM.
// Polls /api/tokens in sync with the backend refresh cadence.

const state = {
  filter: 'all',
  search: '',
  data: { tokens: [], updatedAt: null, totalAvailable: 0, lastError: null },
  refreshIntervalMs: 20000,
  timer: null
};

const $ = (sel) => document.querySelector(sel);
const body = $('#tokens-body');
const statusChip = $('#meta-status');
const countEl = $('#meta-count');
const updatedEl = $('#meta-updated');

// ---------- formatters ----------
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function fmtUsd(n) {
  if (!Number.isFinite(n) || n === 0) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + nf2.format(n / 1e9) + 'B';
  if (abs >= 1e6) return '$' + nf2.format(n / 1e6) + 'M';
  if (abs >= 1e3) return '$' + nf2.format(n / 1e3) + 'K';
  return '$' + nf2.format(n);
}

function fmtPrice(n) {
  if (!Number.isFinite(n) || n === 0) return '–';
  if (n >= 1) return '$' + nf2.format(n);
  // Show enough sig figs for small prices.
  const digits = Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(n))));
  return '$' + n.toFixed(digits);
}

function fmtPct(n) {
  if (!Number.isFinite(n)) return '–';
  const sign = n > 0 ? '+' : '';
  return sign + nf2.format(n) + '%';
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- rendering ----------
function render() {
  const { tokens, updatedAt, lastError, totalAvailable } = state.data;

  statusChip.className = 'chip ' + (lastError ? 'chip-err' : (tokens.length ? 'chip-ok' : 'chip-idle'));
  statusChip.textContent = lastError ? 'error' : (tokens.length ? 'live' : 'idle');
  statusChip.title = lastError || '';

  countEl.textContent = `${tokens.length} / ${totalAvailable || tokens.length} tokens`;
  updatedEl.textContent = 'updated ' + fmtAgo(updatedAt);

  if (!tokens.length) {
    const msg = lastError
      ? `No data yet. Last error: ${escapeHtml(lastError)}`
      : 'Waiting for the first data refresh…';
    body.innerHTML = `<tr class="placeholder"><td colspan="9">${msg}</td></tr>`;
    return;
  }

  const rows = tokens.map((t, i) => {
    const href = t.url || '#';
    const fpsCls = fpsClass(t.fps);
    const pct1h = t.priceChange?.h1 ?? 0;
    return `
      <tr>
        <td class="col-rank">${i + 1}</td>
        <td class="col-token">
          <div class="token-cell">
            <a class="token-symbol" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.symbol || '—')}</a>
            <span class="token-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>
            <span class="token-chain">${escapeHtml(t.chain)}/${escapeHtml(t.dex || '')}</span>
          </div>
        </td>
        <td class="col-num">${fmtPrice(t.priceUsd)}</td>
        <td class="col-num">${fmtUsd(t.volume?.h1)}</td>
        <td class="col-num">${fmtUsd(t.volume?.h24)}</td>
        <td class="col-num">${fmtUsd(t.liquidityUsd)}</td>
        <td class="col-num">${fmtUsd(t.marketCap || t.fdv)}</td>
        <td class="col-num ${pctClass(pct1h)}">${fmtPct(pct1h)}</td>
        <td class="col-num col-fps"><span class="${fpsCls}">${t.fps.toFixed(1)}</span></td>
      </tr>`;
  }).join('');

  body.innerHTML = rows;
}

// ---------- data ----------
async function load() {
  const params = new URLSearchParams();
  if (state.filter && state.filter !== 'all') params.set('filter', state.filter);
  if (state.search) params.set('search', state.search);
  try {
    const res = await fetch('/api/tokens?' + params.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    state.data = {
      tokens: Array.isArray(json.tokens) ? json.tokens : [],
      updatedAt: json.updatedAt,
      totalAvailable: json.totalAvailable || 0,
      lastError: json.lastError || null
    };
    if (Number.isFinite(json.refreshIntervalMs)) {
      state.refreshIntervalMs = json.refreshIntervalMs;
    }
  } catch (err) {
    state.data = { ...state.data, lastError: err.message };
  }
  render();
}

function restartTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(load, state.refreshIntervalMs);
}

// ---------- controls ----------
let searchDebounce = null;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.search = e.target.value.trim();
    load();
  }, 180);
});

document.querySelectorAll('.filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter || 'all';
    load();
  });
});

// Keep "updated Xs ago" fresh without hitting the API.
setInterval(() => {
  if (state.data.updatedAt) updatedEl.textContent = 'updated ' + fmtAgo(state.data.updatedAt);
}, 1000);

// Initial load + periodic refresh.
load().then(restartTimer);
