'use client';

import Link from 'next/link';
import { MODULES, ROLE_NAVIGATION } from '@krevia/shared';
import { useSession } from '@/components/AppShell';
import { PanelEmpty, QuickActions } from '@/components/Dashboard';
import { Icon } from '@/components/Icon';
import { RoleGate } from '@/components/RoleGate';
import { hrefFor } from '@/lib/roles';

/** Security Guard web dashboard ("Fast and reliable gate and visitor management"). */
export default function GuardDashboardPage() {
  return (
    <RoleGate role="GUARD">
      <GuardDashboard />
    </RoleGate>
  );
}

function GuardDashboard() {
  const { staffSociety } = useSession();
  const summary = [
    { label: 'Total Entries', tone: 'green' },
    { label: 'Visitors', tone: 'blue' },
    { label: 'Deliveries', tone: 'orange' },
    { label: 'Staff', tone: 'red' },
  ] as const;

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Live Gate Entry</h1>
        <p className="muted" style={{ margin: 0 }}>
          {staffSociety ? `${staffSociety.societyName} · Security desk` : 'Security desk'}
        </p>
      </div>
      <div className="dash-grid">
        <div className="stack" style={{ gap: 24 }}>
          <section className="card gate-console" aria-labelledby="gate-title" data-testid="gate-console">
            <div className="section-head">
              <h2 id="gate-title">Scan QR Code to verify visitor</h2>
              <span className="badge badge-soon">Coming soon</span>
            </div>
            <div className="qr-frame" aria-hidden="true">
              <Icon name="qr" size={72} />
              <span>Point camera at QR code</span>
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <Link href={hrefFor('GUARD', MODULES['manual-entry']!)} className="btn btn-secondary">Manual Entry</Link>
              <Link href={hrefFor('GUARD', MODULES['pre-approved']!)} className="btn btn-primary">Pre-Approved Visitor</Link>
            </div>
            <p className="subtle" style={{ textAlign: 'center', margin: 0 }}>
              Visitor passes and gate logging are planned for an upcoming release.
            </p>
          </section>
          <section className="card" aria-labelledby="summary-title">
            <h2 id="summary-title">Today&apos;s Summary</h2>
            <div className="stat-grid">
              {summary.map((s) => (
                <div key={s.label} className="summary-tile">
                  <p className={`stat-value tone-text-${s.tone}`}>—</p>
                  <p className="card-title" style={{ margin: 0 }}>{s.label}</p>
                </div>
              ))}
            </div>
            <p className="subtle" style={{ margin: '8px 0 0' }}>Counts appear once gate entries are recorded in Krevia.</p>
          </section>
        </div>
        <aside className="stack" style={{ gap: 20 }}>
          <section className="card" aria-labelledby="entries-title">
            <div className="section-head">
              <h2 id="entries-title">Today&apos;s Entries</h2>
            </div>
            <PanelEmpty icon="list" title="No entries recorded" message="Visitor, delivery and staff entries will be listed here." />
          </section>
          <QuickActions role="GUARD" items={ROLE_NAVIGATION.GUARD.quickActions} title="Quick Actions" />
        </aside>
      </div>
    </div>
  );
}
