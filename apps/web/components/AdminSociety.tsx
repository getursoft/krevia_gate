'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from './AppShell';
import { RoleGate } from './RoleGate';
import { ErrorState, Loading } from './States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const TABS = [
  { href: '/admin/requests', label: 'Join requests' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/invitations', label: 'Invitations' },
  { href: '/admin/buildings', label: 'Buildings' },
  { href: '/admin/units', label: 'Units' },
  { href: '/admin/residents', label: 'Residents' },
  { href: '/admin/audit', label: 'Audit log' },
];

/** Sub-navigation for resident management. */
export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Resident management" className="row admin-tabs">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="admin-tab" aria-current={pathname === t.href ? 'page' : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Admin page frame: role gate, tabs, and a picker for the societies the user
 * administers. The list comes from the API (ACTIVE admin memberships only), and
 * every request made by `children` is authorised again by the API.
 */
export function AdminSocietyFrame({ title, children }: { title: string; children: (societyId: string) => React.ReactNode }) {
  return (
    <RoleGate role="ADMIN">
      <Frame title={title}>{children}</Frame>
    </RoleGate>
  );
}

function Frame({ title, children }: { title: string; children: (societyId: string) => React.ReactNode }) {
  const { staffSociety } = useSession();
  const societies = useApi(() => api.adminSocieties());
  const [societyId, setSocietyId] = useState('');
  useEffect(() => {
    const items = societies.data?.items ?? [];
    if (!societyId && items[0]) setSocietyId(items.find((s) => s.id === staffSociety?.societyId)?.id ?? items[0].id);
  }, [societies.data, societyId, staffSociety]);

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>{title}</h1>
        {societies.data && societies.data.items.length > 1 && (
          <>
            <label className="sr-only" htmlFor="admin-society">Society</label>
            <select id="admin-society" className="input" style={{ width: 'auto' }} value={societyId} onChange={(e) => setSocietyId(e.target.value)}>
              {societies.data.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </>
        )}
      </div>
      <AdminTabs />
      {societies.loading ? (
        <Loading />
      ) : societies.error ? (
        <ErrorState error={societies.error} onRetry={societies.reload} />
      ) : !societies.data?.items.length ? (
        <div className="card empty">
          <h3>No society administration access</h3>
          <p style={{ margin: 0 }}>Your account is not an active administrator of any society.</p>
        </div>
      ) : (
        societyId && <div key={societyId}>{children(societyId)}</div>
      )}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <span className="subtle">Page {page} of {pages} · {total} total</span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

/** Badge for membership, invitation and audit statuses. */
export function StateBadge({ value, label }: { value: string; label?: string }) {
  return <span className={`badge badge-${value}`}>{label ?? value.charAt(0) + value.slice(1).toLowerCase()}</span>;
}
