'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ApiClientError,
  MEMBER_ROLE_LABEL,
  type InvitationPreviewDto,
  type UserDto,
} from '@krevia/shared';
import { FormAlert } from '@/components/Field';
import { KreviaMark } from '@/components/Logo';
import { Loading } from '@/components/States';
import { api } from '@/lib/api';
import { ROLE_HOME } from '@/lib/roles';

/**
 * Invitation landing page. Shows what the invitation grants, then lets the
 * signed-in owner of the invited number accept it. The role and unit always
 * come from the invitation on the server; this page only sends the token.
 */
export function InviteAccept() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [preview, setPreview] = useState<InvitationPreviewDto | null>(null);
  const [user, setUser] = useState<UserDto | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, me] = await Promise.all([
          api.previewInvitation(token),
          api.me().catch((err: ApiClientError) => (err.status === 401 ? null : Promise.reject(err))),
        ]);
        if (cancelled) return;
        setPreview(p.invitation);
        setUser(me?.user ?? null);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError((err as ApiClientError).message);
        setState('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    if (!preview) return;
    setAccepting(true);
    setError(null);
    try {
      await api.acceptInvitation(token);
      const home = preview.role === 'ADMIN' ? ROLE_HOME.ADMIN : preview.role === 'GUARD' ? ROLE_HOME.GUARD : ROLE_HOME.RESIDENT;
      router.replace(home);
      router.refresh();
    } catch (err) {
      setError((err as ApiClientError).message);
      setAccepting(false);
    }
  }

  const here = `/invite?token=${encodeURIComponent(token)}`;

  return (
    <div className="stack" data-testid="invite-page">
      <KreviaMark size={52} />
      <h1 style={{ fontSize: '1.8rem', margin: 0 }}>Society invitation</h1>
      {state === 'loading' && <Loading label="Checking your invitation…" />}
      {state === 'invalid' && (
        <>
          <FormAlert message={error ?? 'This invitation link is invalid or has expired.'} />
          <p className="muted">Ask your society administrator to send a new invitation.</p>
          <Link href="/login" className="btn btn-secondary">Go to sign in</Link>
        </>
      )}
      {state === 'ready' && preview && (
        <>
          <section className="card stack" style={{ gap: 8 }} aria-label="Invitation details">
            <p className="card-title" style={{ margin: 0 }}>You are invited to join</p>
            <p className="card-value" data-testid="invite-society">{preview.society.name}, {preview.society.city}</p>
            <p style={{ margin: 0 }}>
              as <strong data-testid="invite-role">{MEMBER_ROLE_LABEL[preview.role]}</strong>
              {preview.unit && <> · Flat {preview.unit.tower}-{preview.unit.number}</>}
            </p>
            <p className="subtle" style={{ margin: 0 }}>
              Sent to {preview.phone} · valid until {new Date(preview.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </section>
          <FormAlert message={error} />
          {user ? (
            <>
              <p className="muted" style={{ margin: 0 }}>Signed in as {user.fullName} ({user.phone}).</p>
              <button type="button" className="btn btn-primary btn-block" onClick={accept} disabled={accepting}>
                {accepting ? 'Accepting…' : 'Accept invitation'}
              </button>
              <p className="subtle" style={{ margin: 0 }}>Only the account registered to the invited number can accept.</p>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>Sign in with the invited mobile number, or create an account with it, to accept.</p>
              <Link href={`/login?next=${encodeURIComponent(here)}`} className="btn btn-primary btn-block">Sign in to accept</Link>
              <Link href={`/register?next=${encodeURIComponent(here)}`} className="btn btn-secondary btn-block">Create an account</Link>
            </>
          )}
        </>
      )}
    </div>
  );
}
