import Link from 'next/link';
import { BRAND } from '@krevia/shared';
import { Icon, type IconName } from '@/components/Icon';
import { KreviaMark, Logo } from '@/components/Logo';
import { SiteHeader } from '@/components/SiteHeader';

const PLATFORM: { icon: IconName; title: string; body: string; status: string }[] = [
  { icon: 'shield', title: 'Verified resident onboarding', body: 'Residents request to join their society with their tower and flat details. Society administrators verify every request before access is granted.', status: 'Available now' },
  { icon: 'user', title: 'Secure resident accounts', body: 'Sign in with your Indian mobile number. Sessions are managed on the server and can be ended from any device.', status: 'Available now' },
  { icon: 'megaphone', title: 'Society notices', body: 'Announcements from the managing committee delivered to verified residents.', status: 'Planned' },
  { icon: 'file', title: 'Complaints & requests', body: 'Raise and track maintenance issues with clear ownership and status.', status: 'Planned' },
  { icon: 'card', title: 'Dues & payments', body: 'View society dues and payment history in one place.', status: 'Planned' },
  { icon: 'users', title: 'Committee tools', body: 'Member registers, approvals and records for society management.', status: 'Planned' },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <span className="tagline" data-testid="tagline">{BRAND.tagline}</span>
              <h1>Residential society management, built on verified trust.</h1>
              <p className="lead">
                {BRAND.name} connects residents and managing committees of housing societies across India —
                starting with simple, verified resident onboarding.
              </p>
              <div className="row" style={{ marginTop: 24 }}>
                <Link href="/register" className="btn btn-primary">
                  I&apos;m a resident <Icon name="arrow" size={18} />
                </Link>
                <Link href="/login?next=/admin" className="btn btn-secondary">
                  I manage a society
                </Link>
              </div>
            </div>
            <div className="card" style={{ padding: 28 }} aria-hidden="true">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
                <Logo size={34} />
              </div>
              <div className="stack" style={{ gap: 12 }}>
                <div className="card card-mint info-card">
                  <span className="icon-badge" style={{ background: '#fff' }}><Icon name="building" /></span>
                  <div><p className="card-title">Your society</p><p className="card-value">Search &amp; select</p></div>
                </div>
                <div className="card card-mint info-card">
                  <span className="icon-badge" style={{ background: '#fff' }}><Icon name="home" /></span>
                  <div><p className="card-title">Apartment</p><p className="card-value">Tower and flat number</p></div>
                </div>
                <div className="card card-mint info-card">
                  <span className="icon-badge" style={{ background: '#fff' }}><Icon name="shield" /></span>
                  <div><p className="card-title">Membership status</p><p className="card-value">Verified by your society</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="platform">
          <div className="container">
            <div className="section-title">
              <h2>One platform for your community</h2>
              <p className="muted">We are building {BRAND.name} step by step. Here is what works today and what comes next.</p>
            </div>
            <div className="grid grid-3">
              {PLATFORM.map((f) => (
                <article key={f.title} className="card">
                  <div className="feature-icon" style={{ background: 'var(--mint)', color: 'var(--forest)' }}>
                    <Icon name={f.icon} size={24} />
                  </div>
                  <h3>{f.title}</h3>
                  <p className="muted">{f.body}</p>
                  <span className={`badge ${f.status === 'Available now' ? 'badge-APPROVED' : 'badge-soon'}`}>{f.status}</span>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section" id="residents" style={{ background: 'var(--surface)' }}>
          <div className="container grid grid-2" style={{ alignItems: 'center' }}>
            <div>
              <h2>For residents</h2>
              <p className="muted">Join your society in three steps:</p>
              <ol className="stack" style={{ paddingLeft: 20, gap: 8 }}>
                <li>Create your account with your mobile number.</li>
                <li>Find your society and enter your tower and flat number.</li>
                <li>Track your request until your society verifies it.</li>
              </ol>
              <Link href="/register" className="btn btn-primary" style={{ marginTop: 12 }}>Create resident account</Link>
            </div>
            <div className="card card-mint" id="societies">
              <h2>For society management</h2>
              <p className="muted">
                Committee members review membership requests for their own society only, and approve or reject
                each one. Residents never see other residents&apos; requests.
              </p>
              <p className="subtle">
                To onboard your society, contact the {BRAND.name} team (contact details below).
              </p>
              <Link href="/login?next=/admin" className="btn btn-secondary">Society admin sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="row">
            <KreviaMark size={30} />
            <div>
              <strong style={{ color: 'var(--forest)' }}>{BRAND.name}</strong>
              <div className="subtle">{BRAND.tagline}</div>
            </div>
          </div>
          <nav className="footer-links" aria-label="Legal">
            <a href="#" aria-disabled="true" title="Placeholder — legal text pending">Privacy Policy (placeholder)</a>
            <a href="#" aria-disabled="true" title="Placeholder — legal text pending">Terms of Service (placeholder)</a>
            <a href="#" aria-disabled="true" title="Placeholder — contact details pending">Contact (placeholder)</a>
          </nav>
          <div className="placeholder-note">
            © {new Date().getFullYear()} {BRAND.name}. Legal entity, address and support contact to be added before launch.
          </div>
        </div>
      </footer>
    </>
  );
}
