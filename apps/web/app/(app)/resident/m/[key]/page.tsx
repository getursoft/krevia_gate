import { MODULES } from '@krevia/shared';
import { ComingSoon } from '@/components/Dashboard';
import { ROLE_HOME } from '@/lib/roles';

export default async function ResidentModulePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ComingSoon role="RESIDENT" item={MODULES[key]} homeHref={ROLE_HOME.RESIDENT} />;
}
