'use client';

import { useEffect, useState } from 'react';
import {
  ApiClientError,
  OCCUPANCY_LABEL,
  type AdminMembershipRequestDto,
  type MembershipStatus,
} from '@krevia/shared';
import { AdminTabs } from '@/components/AdminSociety';
import { FormAlert } from '@/components/Field';
import { ErrorState, Loading, StatusBadge } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Resident management: review membership requests for societies the user administers. */
export default function AdminRequestsPage() {
  const societies = useApi(() => api.adminSocieties());
  const [societyId, setSocietyId] = useState<string>('');
  const [filter, setFilter] = useState<MembershipStatus | ''>('PENDING');

  useEffect(() => {
    if (!societyId && societies.data?.items[0]) setSocietyId(societies.data.items[0].id);
  }, [societies.data, societyId]);

  if (societies.loading) return <div className="page"><Loading /></div>;
  if (societies.error) return <div className="page"><ErrorState error={societies.error} onRetry={societies.reload} /></div>;
  if (!societies.data || societies.data.items.length === 0) {
    return (
      <div className="page">
        <div className="card empty">
          <h3>No society administration access</h3>
          <p style={{ margin: 0 }}>Your account is not an administrator of any society. Contact the Krevia team to onboard your society.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Membership requests</h1>
        <div className="row">
          <label className="sr-only" htmlFor="admin-society">Society</label>
          <select id="admin-society" className="input" style={{ width: 'auto' }} value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
            {societies.data.items.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="admin-filter">Status</label>
          <select id="admin-filter" className="input" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value as MembershipStatus | '')}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="REVOKED">Revoked</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <AdminTabs />
      {societyId && <RequestList key={`${societyId}-${filter}`} societyId={societyId} status={filter} />}
    </div>
  );
}

function RequestList({ societyId, status }: { societyId: string; status: MembershipStatus | '' }) {
  const { data, error, loading, reload, setData } = useApi(
    () => api.societyMembershipRequests(societyId, status || undefined),
    [societyId, status],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function review(r: AdminMembershipRequestDto, action: 'approve' | 'reject') {
    const note = action === 'reject' ? window.prompt('Reason for rejection (optional)') ?? undefined : undefined;
    setBusy(r.id);
    setMessage(null);
    try {
      const res =
        action === 'approve'
          ? await api.approveMembershipRequest(r.id)
          : await api.rejectMembershipRequest(r.id, note ? { note } : {});
      setData((d) => d && { items: d.items.map((i) => (i.id === r.id ? res.request : i)) });
      setMessage({ tone: 'success', text: `${r.applicant.fullName}'s request was ${action === 'approve' ? 'approved' : 'rejected'}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Loading label="Loading requests…" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <section className="card">
      <FormAlert message={message?.text} tone={message?.tone} />
      {data && data.items.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>No {status ? status.toLowerCase() : ''} requests.</p></div>
      ) : (
        <ul className="list" aria-label="Requests">
          {data?.items.map((r) => (
            <li key={r.id} className="list-item" style={{ alignItems: 'center', flexWrap: 'wrap' }} data-testid="admin-request">
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{r.applicant.fullName}</strong> <span className="subtle">{r.applicant.phone}</span>
                <div className="subtle">
                  {r.tower} · {r.unitNumber} · {OCCUPANCY_LABEL[r.occupancy]} · submitted {new Date(r.createdAt).toLocaleDateString('en-IN')}
                </div>
              </div>
              <StatusBadge status={r.status} />
              {r.status === 'PENDING' && (
                <div className="row">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => review(r, 'approve')}>Approve</button>
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => review(r, 'reject')}>Reject</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
