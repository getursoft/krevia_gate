'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OCCUPANCY_LABEL, ROLE_NAVIGATION } from '@krevia/shared';
import { useSession } from '@/components/AppShell';
import { PanelEmpty, QuickActions, StatCard } from '@/components/Dashboard';
import { Icon } from '@/components/Icon';
import { RoleGate } from '@/components/RoleGate';
import { ErrorState, Loading, StatusBadge } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'} ago` : `${Math.round(hours / 24)} days ago`;
};

/** Admin / AOA web dashboard ("Complete control and transparency for society management"). */
export default function AdminDashboardPage() {
  return (
    <RoleGate role="ADMIN">
      <AdminDashboard />
    </RoleGate>
  );
}

function AdminDashboard() {
  const { staffSociety } = useSession();
  const societies = useApi(() => api.adminSocieties());
  const [societyId, setSocietyId] = useState('');
  useEffect(() => {
    if (!societyId && societies.data?.items[0]) setSocietyId(staffSociety?.societyId ?? societies.data.items[0].id);
  }, [societies.data, societyId, staffSociety]);

  if (societies.loading) return <div className="page"><Loading /></div>;
  if (societies.error) return <div className="page"><ErrorState error={societies.error} onRetry={societies.reload} /></div>;
  if (!societies.data?.items.length) {
    return (
      <div className="page">
        <div className="card empty"><h3>No societies to manage</h3><p style={{ margin: 0 }}>Your account does not administer any society yet.</p></div>
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Society Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>Overview of your society operations</p>
        </div>
        <div className="row">
          {societies.data.items.length > 1 && (
            <select aria-label="Society" className="input" style={{ width: 'auto' }} value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
              {societies.data.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <span className="date-chip"><Icon name="calendar" size={16} /> {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      </div>
      {societyId && <SocietyPanels key={societyId} societyId={societyId} />}
    </div>
  );
}

function SocietyPanels({ societyId }: { societyId: string }) {
  const overview = useApi(() => api.societyOverview(societyId), [societyId]);
  const activity = useApi(() => api.societyMembershipRequests(societyId), [societyId]);
  const o = overview.data;

  return (
    <>
      {overview.error ? (
        <ErrorState error={overview.error} onRetry={overview.reload} />
      ) : (
        <div className="stat-grid">
          <StatCard icon="building" label="Total Units" value={o?.totalUnits ?? '…'} testId="stat-units" hint="Registered through membership requests" />
          <StatCard icon="users" tone="blue" label="Residents" value={o?.approvedMembers ?? '…'} testId="stat-residents" hint="Approved members" />
          <StatCard icon="clock" tone="orange" label="Pending Requests" value={o?.pendingRequests ?? '…'} testId="stat-pending" />
          <StatCard icon="file" tone="red" label="Open Complaints" value="—" hint="Complaints module coming soon" />
        </div>
      )}

      <div className="dash-grid">
        <div className="stack" style={{ gap: 24 }}>
          <QuickActions role="ADMIN" items={ROLE_NAVIGATION.ADMIN.quickActions} title="Quick Actions" />
          <section className="card" aria-labelledby="admin-activity">
            <div className="section-head">
              <h2 id="admin-activity">Recent Activity</h2>
              <Link href="/admin/requests" className="link-arrow">View All <Icon name="arrow" size={16} /></Link>
            </div>
            {activity.loading ? (
              <Loading />
            ) : activity.error ? (
              <ErrorState error={activity.error} onRetry={activity.reload} />
            ) : activity.data && activity.data.items.length > 0 ? (
              <ul className="list" data-testid="admin-activity">
                {activity.data.items.slice(0, 5).map((r) => (
                  <li key={r.id} className="list-item">
                    <span className="qa-icon tone-green sm"><Icon name="userPlus" size={16} /></span>
                    <div style={{ flex: 1 }}>
                      <strong>{r.status === 'PENDING' ? 'New resident request' : `Resident request ${r.status.toLowerCase()}`}</strong>
                      <div className="subtle">{r.tower}-{r.unitNumber} · {OCCUPANCY_LABEL[r.occupancy]} · {r.applicant.fullName}</div>
                    </div>
                    <StatusBadge status={r.status} />
                    <span className="subtle" style={{ minWidth: 80, textAlign: 'right' }}>{timeAgo(r.reviewedAt ?? r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty icon="list" title="No activity yet" message="Resident requests for this society will appear here." />
            )}
          </section>
        </div>
        <aside className="stack" style={{ gap: 20 }}>
          <section className="card">
            <h2>Society Health</h2>
            <PanelEmpty icon="chart" title="Coming soon" message="Payments, amenities, complaints and engagement scores need those modules to go live." />
          </section>
          <section className="card">
            <h2>Complaints Overview</h2>
            <PanelEmpty icon="file" title="Coming soon" message="Open, in-progress and resolved complaints will be tracked here." />
          </section>
        </aside>
      </div>
    </>
  );
}
