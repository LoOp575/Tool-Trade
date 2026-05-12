// Server component shell — renders the client component below.
// Kept dynamic so Vercel does not try to pre-render with no data.
import RadarTable from './RadarTable';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <RadarTable />;
}
