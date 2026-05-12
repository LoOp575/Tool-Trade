import './globals.css';

export const metadata = {
  title: 'Token Pump Radar',
  description: 'Lightweight crypto analytics ranked by Final Pump Score (FPS).',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
