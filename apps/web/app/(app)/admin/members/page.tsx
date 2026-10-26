'use client';

import { useState } from 'react';
import {
  ApiClientError,
  MEMBER_ROLE_LABEL,
  MEMBER_STATUS_LABEL,
  OCCUPANCY_LABEL,
  type MemberDto,
  type MemberStatus,
} from '@krevia/shared';
import { AdminSocietyFrame, Pager, StateBadge } from '@/components/AdminSociety';
import { useSession } from '@/components/AppShell';
import { FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Society roster with suspend / reactivate / revoke and CSV export. */
export default function AdminMembersPage() {
  return <AdminSocietyFrame title="Members">{(societyId) => <Members societyId={societyId} />}</AdminSocietyFrame>;
}

function Members({ societyId }: { societyId: string }) {
  const { user } = useSession();
  const [filters, setFilters] = useState({ role: '', status: 'ACTIVE', q: '' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useApi(() => api.listMembers(societyId, { ...filters, page, pageSize: 20 }), [societyId, filters, page]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function change(m: MemberDto, status: MemberStatus) {
    const verb = status === 'ACTIVE' ? 'reactivate' : status === 'SUSPENDED' ? 'suspend' : 'revoke';
    const warning = status === 'REVOKED' ? ' Revoking is permanent: they will need a new invitation.' : '';
    if (!window.confirm(`Do you want to ${verb} ${m.user.fullName} (${MEMBER_ROLE_LABEL[m.role]})?${warning}`)) return;
    setBusy(m.id);
    setMessage(null);
    try {
      const res = await api.updateMemberStatus(societyId, m.id, { status });
      list.setData((d) => d && { ...d, items: d.items.map((i) => (i.id === m.id ? res.member : i)) });
      setMessage({ tone: 'success', text: `${m.user.fullName} is now ${MEMBER_STATUS_LABEL[status].toLowerCase()}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  const select = (key: 'role' | 'status') => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPage(1);
    setFilters({ ...filters, [key]: e.target.value });
  };

  return (
    <section className="card stack">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({ ...filters, q });
        }}
      >
        <label className="sr-only" htmlFor="member-q">Search members</label>
        <input id="member-q" className="input" style={{ maxWidth: 260 }} placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="member-role">Role</label>
        <select id="member-role" className="input" style={{ width: 'auto' }} value={filters.role} onChange={select('role')}>
          <option value="">All roles</option>
          <option value="RESIDENT">Residents</option>
          <option value="GUARD">Guards</option>
          <option value="ADMIN">Admins</option>
        </select>
        <label className="sr-only" htmlFor="member-status">Status</label>
        <select id="member-status" className="input" style={{ width: 'auto' }} value={filters.status} onChange={select('status')}>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="REVOKED">Revoked</option>
          <option value="">All statuses</option>
        </select>
        <button type="submit" className="btn btn-secondary">Search</button>
        <a className="btn btn-ghost" href={api.membersExportUrl(societyId)} download>Export CSV</a>
      </form>
      <FormAlert message={message?.text} tone={message?.tone} />
      {list.loading ? (
        <Loading label="Loading members…" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data?.items.length ? (
        <div className="empty"><p style={{ margin: 0 }}>No members match these filters. Invite people from the Invitations tab.</p></div>
      ) : (
        <ul className="list" aria-label="Members">
          {list.data.items.map((m) => (
            <li key={m.id} className="list-item" style={{ flexWrap: 'wrap' }} data-testid="member-row">
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{m.user.fullName}</strong> <span className="subtle">{m.user.phone}</span>
                <div className="subtle">
                  {MEMBER_ROLE_LABEL[m.role]}
                  {m.units.map((u) => ` · ${u.tower}-${u.number} (${OCCUPANCY_LABEL[u.occupancy]})`).join('')}
                </div>
              </div>
              <StateBadge value={m.status} label={MEMBER_STATUS_LABEL[m.status]} />
              {m.user.id !== user.id && m.status !== 'REVOKED' && (
                <div className="row">
                  {m.status === 'ACTIVE' ? (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => change(m, 'SUSPENDED')}>Suspend</button>
                  ) : (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => change(m, 'ACTIVE')}>Reactivate</button>
                  )}
                  <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => change(m, 'REVOKED')}>Revoke</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
    </section>
  );
}
