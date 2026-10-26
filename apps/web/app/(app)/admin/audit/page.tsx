'use client';

import { useState } from 'react';
import { AdminSocietyFrame, Pager, StateBadge } from '@/components/AdminSociety';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const ACTION_LABEL: Record<string, string> = {
  'authz.denied': 'Access denied',
  'invitation.created': 'Invitation sent',
  'invitation.accepted': 'Invitation accepted',
  'invitation.accept_failed': 'Invitation acceptance failed',
  'invitation.revoked': 'Invitation revoked',
  'invitation.expired': 'Invitation expired',
  'membership.created': 'Membership started',
  'membership.status_changed': 'Membership status changed',
  'membership.request.created': 'Join request submitted',
  'membership.request.approved': 'Join request approved',
  'membership.request.rejected': 'Join request rejected',
  'unit.created': 'Unit added',
  'unit.assigned': 'Resident assigned to unit',
  'unit.unassigned': 'Resident removed from unit',
  'society.created': 'Society created',
  'society.updated': 'Society details updated',
  'session.active_society.changed': 'Active society selected',
  'data.exported': 'Members exported',
  'platform.admin_invited': 'Admin invited by Krevia',
};

/** Read-only, append-only security log of this society. */
export default function AdminAuditPage() {
  return <AdminSocietyFrame title="Audit log">{(societyId) => <Audit societyId={societyId} />}</AdminSocietyFrame>;
}

function Audit({ societyId }: { societyId: string }) {
  const [page, setPage] = useState(1);
  const [outcome, setOutcome] = useState('');
  const list = useApi(() => api.societyAuditEvents(societyId, { page, pageSize: 25, outcome }), [societyId, page, outcome]);
  return (
    <section className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted" style={{ margin: 0 }}>Security-relevant actions in this society. Entries cannot be edited or deleted.</p>
        <label className="sr-only" htmlFor="audit-outcome">Outcome</label>
        <select id="audit-outcome" className="input" style={{ width: 'auto' }} value={outcome} onChange={(e) => { setPage(1); setOutcome(e.target.value); }}>
          <option value="">All outcomes</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
          <option value="DENIED">Denied</option>
        </select>
      </div>
      {list.loading ? (
        <Loading label="Loading audit log…" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data?.items.length ? (
        <div className="empty"><p style={{ margin: 0 }}>No events.</p></div>
      ) : (
        <ul className="list" aria-label="Audit events">
          {list.data.items.map((e) => (
            <li key={e.id} className="list-item" style={{ flexWrap: 'wrap' }} data-testid="audit-row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{ACTION_LABEL[e.action] ?? e.action}</strong>
                <div className="subtle">
                  {new Date(e.createdAt).toLocaleString('en-IN')} · {e.actor?.fullName ?? 'System / anonymous'}
                  {typeof e.metadata.permission === 'string' && ` · needed ${e.metadata.permission}`}
                  {typeof e.metadata.from === 'string' && ` · ${e.metadata.from} → ${String(e.metadata.to)}`}
                </div>
                {e.requestId && <div className="subtle" style={{ fontSize: '0.72rem' }}>Request {e.requestId}</div>}
              </div>
              <StateBadge value={e.outcome} />
            </li>
          ))}
        </ul>
      )}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
    </section>
  );
}
