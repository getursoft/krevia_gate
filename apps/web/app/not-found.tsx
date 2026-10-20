import Link from 'next/link';
import { Logo } from '@/components/Logo';

export default function NotFound() {
  return (
    <main className="auth-main" style={{ minHeight: '100vh', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
      <Logo size={44} />
      <h1 style={{ fontSize: '1.6rem' }}>Page not found</h1>
      <p className="muted">The page you are looking for does not exist.</p>
      <Link href="/" className="btn btn-primary">Back to home</Link>
    </main>
  );
}
