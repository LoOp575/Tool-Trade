// Server component shell — renders the client component below.
// Kept dynamic so Vercel does not try to pre-render with no data.

export const dynamic = 'force-dynamic';

import RadarTable from './RadarTable';

export default function HomePage() {
  return <RadarTable />;
}
