'use client';

import Link from 'next/link';
import { OCCUPANCY_LABEL, ROLE_NAVIGATION, type MembershipRequestDto } from '@krevia/shared';
import { useSession } from '@/components/AppShell';
import { PanelEmpty, QuickActions, WelcomeBanner } from '@/components/Dashboard';
import { Icon } from '@/components/Icon';
import { Loading, StatusBadge } from '@/components/States';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function activityText(r: MembershipRequestDto): string {
  switch (r.status) {
    case 'PENDING':
      return `Request to join ${r.society.name} submitted — awaiting verification by the society.`;
    case 'APPROVED':
      return `Your membership request was approved. You are a verified member of ${r.society.name}.`;
    case 'REJECTED':
      return `Your request for ${r.society.name} was not approved.${r.reviewNote ? ` Note: ${r.reviewNote}` : ''}`;
    case 'CANCELLED':
      return `You withdrew your request for ${r.society.name}.`;
    case 'REVOKED':
      return `Your membership of ${r.society.name} was revoked by the society.`;
  }
}

/** Resident web dashboard ("All services for residents, on a bigger screen"). */
export default function ResidentDashboardPage() {
  const { user, membership } = useSession();
  const current = membership?.current ?? null;

  return (
    <div className="page">
      <div className="dash-grid">
        <div className="stack" style={{ gap: 24 }}>
          <WelcomeBanner title={`Welcome back, ${user.fullName}!`} subtitle="A safer, smarter and more connected community." />
          {current?.status === 'PENDING' && (
            <div className="alert alert-warning" role="status">
              Your request is waiting for verification by {current.society.name}. Society features unlock once you are approved.
            </div>
          )}
          <QuickActions role="RESIDENT" items={ROLE_NAVIGATION.RESIDENT.quickActions} />
          <section className="card" aria-labelledby="activity-title">
            <div className="section-head">
              <h2 id="activity-title">Recent Updates</h2>
            </div>
            {!membership ? (
              <Loading label="Loading updates…" />
            ) : membership.history.length > 0 ? (
              <ul className="list">
                {membership.history.map((r) => (
                  <li key={r.id} className="list-item">
                    <span className={`qa-icon tone-${r.status === 'APPROVED' ? 'green' : r.status === 'PENDING' ? 'orange' : 'red'} sm`}>
                      <Icon name={r.status === 'APPROVED' ? 'check' : r.status === 'PENDING' ? 'clock' : 'x'} size={16} />
                    </span>
                    <div style={{ flex: 1 }}>
                      <div>{activityText(r)}</div>
                    </div>
                    <span className="subtle">{formatDate(r.reviewedAt ?? r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty icon="bell" title="No updates yet" message="Membership updates and society notices will appear here." />
            )}
          </section>
        </div>

        <aside className="stack" style={{ gap: 20 }}>
          <section className="card" aria-labelledby="my-society-title">
            <h2 id="my-society-title">My Society</h2>
            {current ? (
              <div className="stack" style={{ gap: 14 }}>
                <div className="info-card">
                  <span className="icon-badge"><Icon name="building" /></span>
                  <div>
                    <p className="card-value" data-testid="dashboard-society">{current.society.name}</p>
                    <p className="subtle" style={{ margin: 0 }}>{current.society.city}, {current.society.state}</p>
                  </div>
                </div>
                <div className="info-card">
                  <span className="icon-badge"><Icon name="home" /></span>
                  <div>
                    <p className="card-title">Apartment No.</p>
                    <p className="card-value" data-testid="dashboard-unit">{current.tower} · {current.unitNumber}</p>
                    <p className="subtle" style={{ margin: 0 }}>{OCCUPANCY_LABEL[current.occupancy]}</p>
                  </div>
                </div>
                <div className="info-card">
                  <span className="icon-badge"><Icon name="shield" /></span>
                  <div>
                    <p className="card-title">Membership Status</p>
                    <StatusBadge status={current.status} />
                  </div>
                </div>
              </div>
            ) : membership ? (
              <div className="stack" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0 }} data-testid="no-society">
                  You haven&apos;t joined a society yet. Find your society and add your flat details for verification.
                </p>
                <Link href="/society/join" className="btn btn-primary">Join your society</Link>
              </div>
            ) : (
              <Loading />
            )}
          </section>
          <section className="card" aria-labelledby="events-title">
            <div className="section-head">
              <h2 id="events-title">Upcoming Events</h2>
            </div>
            <PanelEmpty icon="calendar" title="No upcoming events" message="Society events will appear here once your committee starts publishing them." />
          </section>
        </aside>
      </div>
    </div>
  );
}
