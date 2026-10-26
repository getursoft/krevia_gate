'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiClientError, BRAND, MEMBER_ROLE_LABEL, MEMBER_STATUS_LABEL, ROLE_LABEL } from '@krevia/shared';
import { StateBadge } from '@/components/AdminSociety';
import { useSession } from '@/components/AppShell';
import { FormAlert } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export default function SettingsPage() {
  const { user, role, roles, switchRole, logout } = useSession();
  return (
    <div className="page stack" style={{ gap: 20, maxWidth: 720 }}>
      <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Settings</h1>
      <section className="card stack" aria-labelledby="view-title">
        <h2 id="view-title">Dashboard view</h2>
        <p className="muted" style={{ margin: 0 }}>
          {roles.length > 1 ? 'Your account has more than one role. Choose which dashboard to use.' : `You are signed in as a ${ROLE_LABEL[role]}.`}
        </p>
        <div className="row">
          {roles.map((r) => (
            <button key={r} type="button" className={r === role ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => switchRole(r)} aria-pressed={r === role}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        {user.societyRoles.length > 0 && (
          <ul className="list">
            {user.societyRoles.map((r) => (
              <li key={`${r.societyId}-${r.role}`} className="list-item">
                <Icon name={r.role === 'GUARD' ? 'shield' : 'building'} />
                <span style={{ flex: 1 }}>{r.societyName}, {r.city}</span>
                <span className="badge badge-soon">{ROLE_LABEL[r.role]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Societies />
      <section className="card stack" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <div className="row">
          <Link href="/profile" className="btn btn-secondary">Edit profile</Link>
          <button type="button" className="btn btn-danger" onClick={logout}>Logout</button>
          <SignOutEverywhere />
        </div>
        <p className="subtle" style={{ margin: 0 }}>Signing out ends this session on the server. {BRAND.name} · {BRAND.tagline}</p>
      </section>
    </div>
  );
}

/** Every membership the account holds, and the session's active society (validated by the API). */
function Societies() {
  const me = useApi(() => api.me());
  const [error, setError] = useState<string | null>(null);
  if (!me.data) return null;
  const { user, activeSocietyId } = me.data;
  return (
    <section className="card stack" aria-labelledby="societies-title">
      <h2 id="societies-title">Your societies</h2>
      <FormAlert message={error} />
      {user.memberships.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>You are not a member of any society yet. <Link href="/society/join">Join your society</Link> or open an invitation link.</p>
      ) : (
        <ul className="list" data-testid="my-memberships">
          {user.memberships.map((m) => (
            <li key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
              <Icon name={m.role === 'GUARD' ? 'shield' : 'building'} />
              <span style={{ flex: 1 }}>
                {m.societyName}, {m.city} · {MEMBER_ROLE_LABEL[m.role]}
                {m.societyId === activeSocietyId && <strong> · Active</strong>}
              </span>
              <StateBadge value={m.status} label={MEMBER_STATUS_LABEL[m.status]} />
              {m.status === 'ACTIVE' && m.societyId !== activeSocietyId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={async () => {
                    setError(null);
                    try {
                      me.setData(await api.setActiveSociety(m.societyId));
                    } catch (err) {
                      setError((err as ApiClientError).message);
                    }
                  }}
                >
                  Make active
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SignOutEverywhere() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        if (!window.confirm('Sign out on every device, including this one?')) return;
        await api.logoutAll();
        router.replace('/login');
        router.refresh();
      }}
    >
      Sign out on all devices
    </button>
  );
}
