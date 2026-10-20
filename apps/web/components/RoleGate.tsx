'use client';

import Link from 'next/link';
import { ROLE_LABEL, type AppRole } from '@krevia/shared';
import { ROLE_HOME } from '@/lib/roles';
import { useSession } from './AppShell';

/**
 * Hides a staff dashboard from users without that role. This is a UX guard only —
 * the API independently rejects every staff action (403).
 */
export function RoleGate({ role, children }: { role: AppRole; children: React.ReactNode }) {
  const { roles } = useSession();
  if (roles.includes(role)) return <>{children}</>;
  return (
    <div className="page">
      <div className="card empty" data-testid="role-denied">
        <h3>No {ROLE_LABEL[role].toLowerCase()} access</h3>
        <p>Your account does not have the {ROLE_LABEL[role]} role in any society. Contact the Krevia team to set this up.</p>
        <Link href={ROLE_HOME.RESIDENT} className="btn btn-primary">Go to my dashboard</Link>
      </div>
    </div>
  );
}
