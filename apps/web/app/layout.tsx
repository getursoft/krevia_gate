import type { Metadata, Viewport } from 'next';
import { BRAND } from '@krevia/shared';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${BRAND.name} — ${BRAND.tagline}`, template: `%s · ${BRAND.name}` },
  description: `${BRAND.name} helps residential societies in India manage resident onboarding and verification. ${BRAND.tagline}`,
  applicationName: BRAND.name,
};

export const viewport: Viewport = { themeColor: '#074331', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
