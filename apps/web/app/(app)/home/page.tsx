import { redirect } from 'next/navigation';
import { availableRoles } from '@krevia/shared';
import { ROLE_HOME } from '@/lib/roles';
import { requireUser } from '@/lib/session';

/** Post-login landing: each user starts on the dashboard of their primary role. */
export default async function HomeRedirect() {
  const user = await requireUser('/home');
  redirect(ROLE_HOME[availableRoles(user)[0]!]);
}
