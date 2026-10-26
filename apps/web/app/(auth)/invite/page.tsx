import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InviteAccept } from './InviteAccept';

export const metadata: Metadata = { title: 'Accept invitation', referrer: 'no-referrer' };

export default function InvitePage() {
  return (
    <Suspense>
      <InviteAccept />
    </Suspense>
  );
}
