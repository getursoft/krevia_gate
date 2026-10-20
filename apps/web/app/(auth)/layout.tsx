import Link from 'next/link';
import { BRAND } from '@krevia/shared';
import { Logo } from '@/components/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <Link href="/" aria-label="Krevia home" style={{ textDecoration: 'none' }}>
          <Logo size={44} inverse />
        </Link>
        <div>
          <h2 style={{ fontSize: '2rem' }}>{BRAND.tagline}</h2>
          <p style={{ opacity: 0.85, maxWidth: 420 }}>
            A smarter, safer and more connected community — starting with verified resident membership.
          </p>
        </div>
        <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>© {new Date().getFullYear()} {BRAND.name}</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
