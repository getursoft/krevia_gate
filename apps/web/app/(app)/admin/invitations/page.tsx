'use client';

import { useState, type FormEvent } from 'react';
import {
  ApiClientError,
  MEMBER_ROLE_LABEL,
  createInvitationSchema,
  fieldErrors,
  type CreatedInvitationDto,
  type InvitationDto,
  type MemberRole,
} from '@krevia/shared';
import { AdminSocietyFrame, Pager, StateBadge } from '@/components/AdminSociety';
import { Field, FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Invite residents (with their flat), guards and co-administrators; revoke pending invitations. */
export default function AdminInvitationsPage() {
  return <AdminSocietyFrame title="Invitations">{(societyId) => <Invitations societyId={societyId} />}</AdminSocietyFrame>;
}

function Invitations({ societyId }: { societyId: string }) {
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const list = useApi(() => api.listInvitations(societyId, { page, pageSize: 20 }), [societyId, page, version]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function revoke(inv: InvitationDto) {
    if (!window.confirm(`Revoke the invitation for ${inv.phone}? The link will stop working.`)) return;
    try {
      const res = await api.revokeInvitation(societyId, inv.id);
      list.setData((d) => d && { ...d, items: d.items.map((i) => (i.id === inv.id ? res.invitation : i)) });
      setMessage({ tone: 'success', text: 'Invitation revoked.' });
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <InviteForm societyId={societyId} onCreated={() => { setPage(1); setVersion((v) => v + 1); }} />
      <section className="card stack" aria-labelledby="inv-list">
        <h2 id="inv-list">Sent invitations</h2>
        <FormAlert message={message?.text} tone={message?.tone} />
        {list.loading ? (
          <Loading label="Loading invitations…" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data?.items.length ? (
          <div className="empty"><p style={{ margin: 0 }}>No invitations yet.</p></div>
        ) : (
          <ul className="list" aria-label="Invitations">
            {list.data.items.map((i) => (
              <li key={i.id} className="list-item" style={{ flexWrap: 'wrap' }} data-testid="invitation-row">
                <div style={{ flex: 1, minWidth: 200 }}>
                  <strong>{i.phone}</strong> · {MEMBER_ROLE_LABEL[i.role]}
                  {i.unit && <> · {i.unit.tower}-{i.unit.number}</>}
                  <div className="subtle">
                    Sent {new Date(i.createdAt).toLocaleDateString('en-IN')} · {i.status === 'PENDING' ? `expires ${new Date(i.expiresAt).toLocaleDateString('en-IN')}` : i.status.toLowerCase()}
                  </div>
                </div>
                <StateBadge value={i.status} />
                {i.status === 'PENDING' && <button type="button" className="btn btn-danger btn-sm" onClick={() => revoke(i)}>Revoke</button>}
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </section>
    </div>
  );
}

function InviteForm({ societyId, onCreated }: { societyId: string; onCreated: () => void }) {
  const units = useApi(() => api.listUnits(societyId, { pageSize: 100 }), [societyId]);
  const [values, setValues] = useState<{ phone: string; role: MemberRole; unitId: string; occupancy: string }>({ phone: '', role: 'RESIDENT', unitId: '', occupancy: 'OWNER' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitationDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setCreated(null);
    const body = values.role === 'RESIDENT'
      ? { phone: values.phone, role: values.role, unitId: values.unitId || undefined, occupancy: values.occupancy as 'OWNER' | 'TENANT' | 'HOUSEHOLD' }
      : { phone: values.phone, role: values.role };
    const parsed = createInvitationSchema.safeParse(body);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setSubmitting(true);
    try {
      setCreated(await api.createInvitation(societyId, body));
      setCopied(false);
      setValues({ ...values, phone: '' });
      onCreated();
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="invite-title">
      <h2 id="invite-title">Invite someone</h2>
      <p className="muted" style={{ margin: 0 }}>
        The invitation is tied to the mobile number: only an account registered to that number can accept it. It expires after 7 days.
      </p>
      <form onSubmit={onSubmit} noValidate className="grid grid-2" aria-label="Invite">
        <Field label="Mobile number" name="phone" type="tel" inputMode="numeric" prefix="+91" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} error={errors.phone} />
        <div className="field">
          <label htmlFor="invite-role">Role</label>
          <select id="invite-role" className="input" value={values.role} onChange={(e) => setValues({ ...values, role: e.target.value as MemberRole })}>
            <option value="RESIDENT">Resident</option>
            <option value="GUARD">Security Guard</option>
            <option value="ADMIN">Society Admin</option>
          </select>
        </div>
        {values.role === 'RESIDENT' && (
          <>
            <div className="field">
              <label htmlFor="invite-unit">Flat</label>
              <select id="invite-unit" className="input" value={values.unitId} onChange={(e) => setValues({ ...values, unitId: e.target.value })} aria-invalid={errors.unitId ? true : undefined}>
                <option value="">{units.loading ? 'Loading flats…' : units.data?.items.length ? 'Choose a flat' : 'Add flats in the Units tab first'}</option>
                {units.data?.items.map((u) => <option key={u.id} value={u.id}>{u.tower}-{u.number}</option>)}
              </select>
              {errors.unitId && <span className="field-error" role="alert">{errors.unitId}</span>}
            </div>
            <div className="field">
              <label htmlFor="invite-occupancy">Occupancy</label>
              <select id="invite-occupancy" className="input" value={values.occupancy} onChange={(e) => setValues({ ...values, occupancy: e.target.value })}>
                <option value="OWNER">Owner</option>
                <option value="TENANT">Tenant</option>
                <option value="HOUSEHOLD">Household member</option>
              </select>
            </div>
          </>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating…' : 'Create invitation'}</button>
        </div>
      </form>
      <FormAlert message={formError} />
      {created && (
        <div className="alert alert-success stack" style={{ gap: 8 }} data-testid="invite-created">
          <strong>Invitation created for {created.invitation.phone}.</strong>
          <span>
            {created.channel === 'dev-outbox'
              ? 'Development mode: the message went to the developer outbox, not a real SMS. Share this link yourself.'
              : created.delivered
                ? 'A message with this link was sent to the number.'
                : 'No SMS provider is configured: share this link with the person yourself.'}{' '}
            It is shown only once.
          </span>
          <code style={{ wordBreak: 'break-all' }} data-testid="invite-url">{created.inviteUrl}</code>
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={async () => { await navigator.clipboard.writeText(created.inviteUrl); setCopied(true); }}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
