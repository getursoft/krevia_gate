'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ROLE_LABEL,
  availableRoles,
  type AppRole,
  type MyMembershipDto,
  type NavItem,
  type SocietyRoleDto,
  type UserDto,
} from '@krevia/shared';
import { api } from '@/lib/api';
import { ROLE_HOME, hrefFor, navFor, roleFromPath } from '@/lib/roles';
import { Icon } from './Icon';
import { Logo } from './Logo';

interface SessionContextValue {
  user: UserDto;
  setUser: (u: UserDto) => void;
  logout: () => Promise<void>;
  /** The experience currently shown (Resident / Admin / Guard). */
  role: AppRole;
  roles: AppRole[];
  switchRole: (role: AppRole) => void;
  membership: MyMembershipDto | null;
  reloadMembership: () => Promise<void>;
  /** Society the current staff role operates on (admin / guard). */
  staffSociety: SocietyRoleDto | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const ROLE_KEY = 'krevia.web.role';

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside AppShell');
  return ctx;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

export function AppShell({ initialUser, children }: { initialUser: UserDto; children: React.ReactNode }) {
  const [user, setUser] = useState(initialUser);
  const [loggingOut, setLoggingOut] = useState(false);
  const [membership, setMembership] = useState<MyMembershipDto | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const roles = useMemo(() => availableRoles(user), [user]);

  const [storedRole, setStoredRole] = useState<AppRole | null>(null);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ROLE_KEY) as AppRole | null;
      if (saved) setStoredRole(saved);
    } catch {
      // storage unavailable: fall back to the default role
    }
  }, []);
  const pathRole = roleFromPath(pathname);
  const role: AppRole = pathRole ?? (storedRole && roles.includes(storedRole) ? storedRole : roles[0]!);
  useEffect(() => {
    if (!pathRole) return;
    setStoredRole(pathRole);
    try {
      window.localStorage.setItem(ROLE_KEY, pathRole);
    } catch {
      // ignore
    }
  }, [pathRole]);
  useEffect(() => setDrawerOpen(false), [pathname]);

  const reloadMembership = useCallback(async () => {
    try {
      setMembership(await api.myMembership());
    } catch {
      setMembership(null);
    }
  }, []);
  useEffect(() => {
    void reloadMembership();
  }, [reloadMembership]);

  async function logout() {
    setLoggingOut(true);
    try {
      await api.logout();
    } catch {
      // Even if the server call fails, leave the app; the session expires server-side.
    }
    router.replace('/login');
    router.refresh();
  }

  const switchRole = (next: AppRole) => router.push(ROLE_HOME[next]);
  const staffSociety =
    role === 'RESIDENT' ? null : (user.societyRoles.find((r) => r.role === role) ?? null);
  const nav = navFor(role);
  const isCurrent = (item: NavItem) => {
    const href = hrefFor(role, item);
    if (href === ROLE_HOME[role]) return pathname === href ? 'page' : undefined;
    return pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined;
  };

  const value: SessionContextValue = {
    user,
    setUser,
    logout,
    role,
    roles,
    switchRole,
    membership,
    reloadMembership,
    staffSociety,
  };

  return (
    <SessionContext.Provider value={value}>
      <div className="app-shell" data-role={role}>
        <aside className="sidebar" data-open={drawerOpen} aria-label="Sidebar">
          <Link href={ROLE_HOME[role]} className="logo" aria-label="Krevia home">
            <Logo size={38} />
          </Link>
          <nav className="side-nav" aria-label={`${ROLE_LABEL[role]} menu`}>
            {nav.sidebar.map((item) => (
              <Link key={item.key} href={hrefFor(role, item)} className="side-link" aria-current={isCurrent(item)}>
                <Icon name={item.icon} /> <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <button type="button" className="side-link logout" onClick={logout} disabled={loggingOut}>
            <Icon name="logout" /> {loggingOut ? 'Signing out…' : 'Logout'}
          </button>
        </aside>
        {drawerOpen && <button type="button" className="drawer-scrim" aria-label="Close menu" onClick={() => setDrawerOpen(false)} />}
        <div className="app-main">
          <header className="topbar">
            <button type="button" className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
              <Icon name="menu" />
            </button>
            <SocietyChip role={role} membership={membership} staffSociety={staffSociety} />
            <ModuleSearch role={role} />
            <div className="topbar-actions">
              <Link href={hrefFor(role, { key: 'notices', label: 'Notices', icon: 'bell', description: '' })} className="icon-btn" aria-label="Notifications">
                <Icon name="bell" />
              </Link>
              <UserMenu user={user} role={role} roles={roles} onSwitch={switchRole} onLogout={logout} />
            </div>
          </header>
          {children}
        </div>
        <nav className="bottom-nav" aria-label="Mobile">
          <Link href={ROLE_HOME[role]} aria-current={pathname === ROLE_HOME[role] ? 'page' : undefined}>
            <Icon name="home" /> {role === 'ADMIN' ? 'Dashboard' : 'Home'}
          </Link>
          <Link href={hrefFor(role, nav.tabs.second)} aria-current={isCurrent(nav.tabs.second)}>
            <Icon name={nav.tabs.second.icon} /> {nav.tabs.second.label}
          </Link>
          <Link href="/profile" aria-current={pathname === '/profile' ? 'page' : undefined}>
            <Icon name="user" /> Profile
          </Link>
          <button type="button" onClick={() => setDrawerOpen(true)}>
            <Icon name="more" /> More
          </button>
        </nav>
      </div>
    </SessionContext.Provider>
  );
}

function SocietyChip({
  role,
  membership,
  staffSociety,
}: {
  role: AppRole;
  membership: MyMembershipDto | null;
  staffSociety: SocietyRoleDto | null;
}) {
  let title = 'No society yet';
  let sub = 'Join your society';
  let href = '/society/join';
  if (role === 'RESIDENT' && membership?.current) {
    title = membership.current.society.name;
    sub = `${membership.current.unitNumber} · Tower ${membership.current.tower}`;
  } else if (role !== 'RESIDENT') {
    href = ROLE_HOME[role];
    title = staffSociety?.societyName ?? 'All societies';
    sub = staffSociety
      ? role === 'GUARD'
        ? `Security · ${staffSociety.city}`
        : `${staffSociety.city}, ${staffSociety.state}`
      : 'Platform administrator';
  }
  return (
    <Link href={href} className="society-chip" data-testid="society-chip">
      <span className="society-chip-icon" aria-hidden="true">
        <Icon name="building" />
      </span>
      <span className="society-chip-text">
        <strong>{title}</strong>
        <span>{sub}</span>
      </span>
    </Link>
  );
}

/** Jump to any menu item of the current role. */
function ModuleSearch({ role }: { role: AppRole }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const items = navFor(role).sidebar.concat(navFor(role).more).filter(
    (item, i, all) => all.findIndex((x) => x.key === item.key) === i,
  );
  const matches = q.trim() ? items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <form
      className="topbar-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (matches[0]) {
          router.push(hrefFor(role, matches[0]));
          setQ('');
        }
      }}
    >
      <Icon name="search" size={18} />
      <input
        aria-label="Search features"
        placeholder={role === 'ADMIN' ? 'Search admin features…' : role === 'GUARD' ? 'Search guard features…' : 'Search services…'}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {matches.length > 0 && (
        <ul className="search-results" role="listbox">
          {matches.map((m) => (
            <li key={m.key}>
              <Link href={hrefFor(role, m)} onClick={() => setQ('')}>
                <Icon name={m.icon} size={16} /> {m.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function UserMenu({
  user,
  role,
  roles,
  onSwitch,
  onLogout,
}: {
  user: UserDto;
  role: AppRole;
  roles: AppRole[];
  onSwitch: (r: AppRole) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-menu-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
        <span className="user-menu-name">
          <strong data-testid="topbar-name">{user.fullName}</strong>
          <span>{ROLE_LABEL[role]}</span>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          {roles.length > 1 && (
            <>
              <div className="menu-label">Switch view</div>
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="menuitemradio"
                  aria-checked={r === role}
                  onClick={() => {
                    setOpen(false);
                    onSwitch(r);
                  }}
                >
                  <Icon name={r === role ? 'check' : 'swap'} size={16} /> {ROLE_LABEL[r]}
                </button>
              ))}
              <hr />
            </>
          )}
          <Link role="menuitem" href="/profile" onClick={() => setOpen(false)}>
            <Icon name="user" size={16} /> My Profile
          </Link>
          <Link role="menuitem" href="/settings" onClick={() => setOpen(false)}>
            <Icon name="settings" size={16} /> Settings
          </Link>
          <button type="button" role="menuitem" className="danger" onClick={onLogout}>
            <Icon name="logout" size={16} /> Logout
          </button>
        </div>
      )}
    </div>
  );
}
