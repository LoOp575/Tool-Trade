// Route handler for GET /api/tokens.
// Runs on the Node.js runtime (not Edge) so we have AbortController etc.
//
// We mark the route as `force-dynamic` so Next.js doesn't try to evaluate it
// at build time (no network during `next build`). The upstream DexScreener
// fetches in `lib/dexscreener.js` still set `next: { revalidate: 15 }`, which
// means concurrent request traffic is collapsed onto one upstream call every
// 15 seconds via Next's Data Cache.

import { NextResponse } from 'next/server';
import { buildSnapshot } from '../../../lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function matchFilter(token, filter) {
  switch (filter) {
    case 'new':
      return token.ageBucket === 'new';
    case 'trending':
      return token.fps >= 60;
    case 'highscore':
      return token.fps >= 80;
    case 'all':
    default:
      return true;
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const filter = (searchParams.get('filter') || 'all').toLowerCase();
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const rawLimit = parseInt(searchParams.get('limit'), 10);
    const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 100));

    const snapshot = await buildSnapshot();

    let tokens = snapshot.tokens;
    if (filter !== 'all') tokens = tokens.filter((t) => matchFilter(t, filter));
    if (search) {
      tokens = tokens.filter((t) => {
        const hay = `${t.symbol} ${t.name} ${t.chain} ${t.dex}`.toLowerCase();
        return hay.includes(search);
      });
    }
    tokens = tokens.slice(0, limit);

    return NextResponse.json(
      {
        ok: true,
        updatedAt: snapshot.updatedAt,
        refreshIntervalMs: 15_000,
        tokenCount: tokens.length,
        totalAvailable: snapshot.totalAvailable,
        warning: snapshot.warning,
        elapsedMs: snapshot.elapsedMs,
        tokens,
      },
      {
        headers: {
          // Browser: always re-fetch. CDN: serve cached for 15s, allow stale
          // for another 30s while revalidating in background.
          'cache-control': 'public, s-maxage=15, stale-while-revalidate=30',
        },
      }
    );
  } catch (err) {
    // Never let the route crash — return a well-formed JSON error so the
    // frontend can render a helpful message instead of blanking out.
    console.error('[api/tokens] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || 'Unknown error',
        tokens: [],
        tokenCount: 0,
        totalAvailable: 0,
        updatedAt: Date.now(),
      },
      { status: 200 } // keep 200 so fetch().ok stays true; surface via `ok: false`
    );
  }
}
