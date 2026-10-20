import Link from 'next/link';
import { TOWERS_SVG, type AppRole, type NavItem } from '@krevia/shared';
import { hrefFor } from '@/lib/roles';
import { Icon, type IconName } from './Icon';

export function WelcomeBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <div className="welcome-text">
        <h1 id="welcome-title">{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      <div className="welcome-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: TOWERS_SVG }} />
    </section>
  );
}

export function QuickActions({ role, items, title = 'Quick Access' }: { role: AppRole; items: NavItem[]; title?: string }) {
  return (
    <section aria-labelledby={`qa-${role}`}>
      <div className="section-head">
        <h2 id={`qa-${role}`}>{title}</h2>
      </div>
      <div className="qa-grid">
        {items.map((item) => (
          <Link key={`${item.key}-${item.label}`} href={hrefFor(role, item)} className="qa-tile" data-testid="quick-action">
            <span className={`qa-icon tone-${item.tone ?? 'green'}`}>
              <Icon name={item.icon} size={24} />
            </span>
            <span className="qa-label">{item.label}</span>
            {!item.screen && <span className="qa-soon">Coming soon</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function StatCard({
  icon,
  label,
  value,
  tone = 'green',
  testId,
  hint,
}: {
  icon: IconName;
  label: string;
  value: string | number;
  tone?: NonNullable<NavItem['tone']>;
  testId?: string;
  hint?: string;
}) {
  return (
    <div className="card stat-card">
      <span className={`qa-icon tone-${tone}`} aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <div>
        <p className="stat-value" data-testid={testId}>{value}</p>
        <p className="card-title" style={{ margin: 0 }}>{label}</p>
        {hint && <p className="subtle" style={{ margin: 0, fontSize: '0.75rem' }}>{hint}</p>}
      </div>
    </div>
  );
}

export function PanelEmpty({ icon, title, message }: { icon: IconName; title: string; message: string }) {
  return (
    <div className="panel-empty">
      <span className="qa-icon tone-green" aria-hidden="true"><Icon name={icon} size={22} /></span>
      <strong>{title}</strong>
      <span className="subtle">{message}</span>
    </div>
  );
}

/** Shown for every module in the showcase menus that is planned but not yet built. */
export function ComingSoon({ role, item, homeHref }: { role: AppRole; item: NavItem | undefined; homeHref: string }) {
  return (
    <div className="page">
      <section className="card coming-soon" data-testid="coming-soon" data-role={role}>
        <span className="qa-icon tone-green" aria-hidden="true">
          <Icon name={item?.icon ?? 'grid'} size={30} />
        </span>
        <span className="badge badge-soon">Coming soon</span>
        <h1>{item?.label ?? 'This feature'}</h1>
        <p className="muted">{item?.description ?? 'This module is planned for an upcoming release.'}</p>
        <p className="subtle">This module is planned for an upcoming Krevia release. Nothing here is live yet.</p>
        <Link href={homeHref} className="btn btn-primary">Back to dashboard</Link>
      </section>
    </div>
  );
}
