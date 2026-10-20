import { ROLE_NAVIGATION, type AppRole, type NavItem } from '@krevia/shared';

/** URL prefix of each role's area. Shared pages (profile, settings, society join) keep the current role. */
export const ROLE_HOME: Record<AppRole, string> = { RESIDENT: '/dashboard', ADMIN: '/admin', GUARD: '/guard' };
const ROLE_PREFIX: Record<AppRole, string> = { RESIDENT: '/resident', ADMIN: '/admin', GUARD: '/guard' };

export function roleFromPath(pathname: string): AppRole | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'ADMIN';
  if (pathname === '/guard' || pathname.startsWith('/guard/')) return 'GUARD';
  if (pathname === '/dashboard' || pathname.startsWith('/resident/')) return 'RESIDENT';
  return null;
}

/** Where a menu item goes on the web for a role. Unbuilt modules open that role's "Coming soon" page. */
export function hrefFor(role: AppRole, item: NavItem): string {
  switch (item.screen) {
    case 'home':
      return ROLE_HOME[role];
    case 'membership':
      return '/society/join';
    case 'profile':
      return '/profile';
    case 'settings':
      return '/settings';
    case 'requests':
      return '/admin/requests';
    default:
      return `${ROLE_PREFIX[role]}/m/${item.key}`;
  }
}

export const navFor = (role: AppRole) => ROLE_NAVIGATION[role];
