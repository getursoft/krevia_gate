'use client';

import Link from 'next/link';
import { BRAND, ROLE_LABEL } from '@krevia/shared';
import { useSession } from '@/components/AppShell';
import { Icon } from '@/components/Icon';

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
      <section className="card stack" aria-labelledby="account-title">
        <h2 id="account-title">Account</h2>
        <div className="row">
          <Link href="/profile" className="btn btn-secondary">Edit profile</Link>
          <button type="button" className="btn btn-danger" onClick={logout}>Logout</button>
        </div>
        <p className="subtle" style={{ margin: 0 }}>Signing out ends this session on the server. {BRAND.name} · {BRAND.tagline}</p>
      </section>
    </div>
  );
}
