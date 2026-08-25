import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tally Browser Connectivity POC',
  description: 'Minimal direct browser-to-local-TallyPrime connectivity test',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
