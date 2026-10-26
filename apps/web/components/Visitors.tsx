'use client';

import { useState, type FormEvent } from 'react';
import {
  ApiClientError,
  VISITOR_CATEGORIES,
  VISITOR_CATEGORY_LABEL,
  VISITOR_STATUSES,
  VISITOR_STATUS_LABEL,
  createVisitorSchema,
  fieldErrors,
  type CreatedVisitorDto,
  type VisitorCategory,
  type VisitorDto,
  type VisitorStatus,
} from '@krevia/shared';
import { Field, FormAlert } from './Field';
import { ErrorState, Loading } from './States';
import { Pager } from './AdminSociety';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

const ACTIVE_STATUSES: VisitorStatus[] = ['PENDING', 'APPROVED', 'ENTERED'];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function VisitorStatusBadge({ status }: { status: VisitorStatus }) {
  return (
    <span className={`badge badge-${status}`} data-testid="visitor-status">
      {VISITOR_STATUS_LABEL[status]}
    </span>
  );
}

/** Notification delivery is reported as it happened; an unconfigured provider is never hidden. */
function NotificationLine({ visitor }: { visitor: VisitorDto }) {
  const request = visitor.notifications.find((n) => n.kind === 'APPROVAL_REQUEST');
  if (!request) return null;
  if (request.delivered) {
    return <span className="subtle">Resident notified · {request.channel}</span>;
  }
  return <span className="subtle">In-app request sent · SMS delivery unavailable ({request.channel})</span>;
}

/** One visitor with its full lifecycle. Action buttons depend on the caller's capabilities. */
export function VisitorCard({
  visitor,
  canDecide = false,
  canEntry = false,
  canManage = false,
  canOverride = false,
  busy = null,
  onApprove,
  onReject,
  onEntry,
  onExit,
  onCancel,
  onOverride,
}: {
  visitor: VisitorDto;
  canDecide?: boolean;
  canEntry?: boolean;
  canManage?: boolean;
  canOverride?: boolean;
  busy?: string | null;
  onApprove?: (v: VisitorDto) => void;
  onReject?: (v: VisitorDto) => void;
  onEntry?: (v: VisitorDto) => void;
  onExit?: (v: VisitorDto) => void;
  onCancel?: (v: VisitorDto) => void;
  onOverride?: (v: VisitorDto) => void;
}) {
  const v = visitor;
  const isBusy = busy === v.id;
  const open = v.status === 'PENDING' || v.status === 'APPROVED';
  return (
    <li className="list-item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }} data-testid="visitor-row">
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong>{v.name}</strong>
          <VisitorStatusBadge status={v.status} />
          <span className="subtle">
            {VISITOR_CATEGORY_LABEL[v.category]} · {v.unit.tower}-{v.unit.number}
          </span>
        </div>
        <div className="subtle" style={{ marginTop: 4 }}>{v.purpose}</div>
        <div className="subtle" style={{ marginTop: 4 }}>
          {v.phone ?? 'No mobile recorded'} · registered {when(v.createdAt)}
          {v.createdBy ? ` by ${v.createdBy.fullName}` : ''}
        </div>
        {v.decidedAt && (
          <div className="subtle">
            {v.status === 'REJECTED' ? 'Rejected' : 'Approved'} by {v.decidedBy?.fullName ?? 'a resident'} · {when(v.decidedAt)}
            {v.decisionNote ? ` · “${v.decisionNote}”` : ''}
          </div>
        )}
        {v.cancelledAt && (
          <div className="subtle">
            Cancelled by {v.cancelledBy?.fullName ?? 'staff'} · {when(v.cancelledAt)}
            {v.cancelReason ? ` · “${v.cancelReason}”` : ''}
          </div>
        )}
        {v.entryAt && (
          <div className="subtle">
            Entered {when(v.entryAt)} by {v.entryBy?.fullName ?? 'gate staff'}
            {v.entryMethod === 'OVERRIDE' ? ' · emergency override' : ' · manual entry'}
          </div>
        )}
        {v.overrideReason && (
          <div className="subtle">
            Override by {v.overriddenBy?.fullName ?? 'an administrator'} · {when(v.overriddenAt)} · “{v.overrideReason}”
          </div>
        )}
        {v.exitAt && (
          <div className="subtle">
            Exited {when(v.exitAt)} by {v.exitBy?.fullName ?? 'gate staff'}
          </div>
        )}
        <NotificationLine visitor={v} />
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {canDecide && v.status === 'PENDING' && (
          <>
            <button type="button" className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => onApprove?.(v)}>
              Approve
            </button>
            <button type="button" className="btn btn-danger btn-sm" disabled={isBusy} onClick={() => onReject?.(v)}>
              Reject
            </button>
          </>
        )}
        {canEntry && v.status === 'APPROVED' && (
          <button type="button" className="btn btn-primary btn-sm" disabled={isBusy} onClick={() => onEntry?.(v)}>
            Record entry
          </button>
        )}
        {canEntry && v.status === 'ENTERED' && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={isBusy} onClick={() => onExit?.(v)}>
            Record exit
          </button>
        )}
        {canManage && open && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={isBusy} onClick={() => onCancel?.(v)}>
            Cancel
          </button>
        )}
        {canOverride && (v.status === 'PENDING' || v.status === 'APPROVED' || v.status === 'TIMED_OUT') && (
          <button type="button" className="btn btn-danger btn-sm" disabled={isBusy} onClick={() => onOverride?.(v)}>
            Emergency override
          </button>
        )}
      </div>
    </li>
  );
}

type ActionMessage = { tone: 'success' | 'error' | 'info'; text: string } | null;

/** Searchable register with date, unit, category and status filters. */
export function VisitorRegister({
  societyId,
  canDecide = false,
  canEntry = false,
  canManage = false,
  canOverride = false,
  showUnitFilter = true,
  title = 'Visitor register',
  refreshToken = 0,
  onChanged,
}: {
  societyId: string;
  canDecide?: boolean;
  canEntry?: boolean;
  canManage?: boolean;
  canOverride?: boolean;
  showUnitFilter?: boolean;
  title?: string;
  /** Bump from the parent to force a reload after an action elsewhere on the page. */
  refreshToken?: number;
  onChanged?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState({ status: '', category: '', unitId: '', dateFrom: '', dateTo: '', q: '' });
  const [draft, setDraft] = useState({ q: '', dateFrom: '', dateTo: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessage>(null);
  const list = useApi(
    () => api.listVisitors(societyId, { ...filters, page, pageSize: 20 }),
    [societyId, filters, page, version, refreshToken],
  );
  const destinations = useApi(
    () => (showUnitFilter ? api.visitorDestinations(societyId) : Promise.resolve({ items: [] })),
    [societyId, showUnitFilter],
  );

  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged?.();
  };

  async function act(visitor: VisitorDto, action: () => Promise<unknown>, success: string) {
    setBusy(visitor.id);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
      refresh();
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  async function cancel(visitor: VisitorDto) {
    const reason = window.prompt(`Reason for cancelling ${visitor.name}'s request?`);
    if (reason === null) return;
    await act(visitor, () => api.cancelVisitor(societyId, visitor.id, { reason }), `${visitor.name}'s request cancelled.`);
  }

  async function override(visitor: VisitorDto) {
    const reason = window.prompt(`Emergency override for ${visitor.name}. A reason is mandatory and will be audited.`);
    if (reason === null) return;
    await act(visitor, () => api.overrideVisitor(societyId, visitor.id, { reason }), `${visitor.name} admitted by emergency override.`);
  }

  return (
    <section className="card stack" aria-labelledby="visitor-register-title">
      <div className="section-head">
        <h2 id="visitor-register-title" style={{ margin: 0 }}>{title}</h2>
      </div>
      <form
        className="row"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({ ...filters, q: draft.q, dateFrom: draft.dateFrom, dateTo: draft.dateTo });
        }}
      >
        <label className="sr-only" htmlFor="visitor-q">Search visitors</label>
        <input
          id="visitor-q"
          className="input"
          style={{ maxWidth: 200 }}
          placeholder="Name, phone or purpose"
          value={draft.q}
          onChange={(e) => setDraft({ ...draft, q: e.target.value })}
        />
        <div className="field">
          <label htmlFor="visitor-date-from">From</label>
          <input id="visitor-date-from" type="date" className="input" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="visitor-date-to">To</label>
          <input id="visitor-date-to" type="date" className="input" value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} />
        </div>
        {showUnitFilter && (
          <>
            <label className="sr-only" htmlFor="visitor-unit">Unit</label>
            <select
              id="visitor-unit"
              className="input"
              style={{ width: 'auto' }}
              value={filters.unitId}
              onChange={(e) => {
                setPage(1);
                setFilters({ ...filters, unitId: e.target.value });
              }}
            >
              <option value="">All units</option>
              {(destinations.data?.items ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.buildingName} · {u.tower}-{u.number}</option>
              ))}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="visitor-category">Category</label>
        <select
          id="visitor-category"
          className="input"
          style={{ width: 'auto' }}
          value={filters.category}
          onChange={(e) => {
            setPage(1);
            setFilters({ ...filters, category: e.target.value });
          }}
        >
          <option value="">All categories</option>
          {VISITOR_CATEGORIES.map((c) => <option key={c} value={c}>{VISITOR_CATEGORY_LABEL[c]}</option>)}
        </select>
        <label className="sr-only" htmlFor="visitor-status">Status</label>
        <select
          id="visitor-status"
          className="input"
          style={{ width: 'auto' }}
          value={filters.status}
          onChange={(e) => {
            setPage(1);
            setFilters({ ...filters, status: e.target.value });
          }}
        >
          <option value="">All statuses</option>
          {VISITOR_STATUSES.map((s) => <option key={s} value={s}>{VISITOR_STATUS_LABEL[s]}</option>)}
        </select>
        <button type="submit" className="btn btn-secondary">Search</button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setDraft({ q: '', dateFrom: '', dateTo: '' });
            setFilters({ status: '', category: '', unitId: '', dateFrom: '', dateTo: '', q: '' });
            setPage(1);
          }}
        >
          Clear
        </button>
      </form>
      <FormAlert message={message?.text} tone={message?.tone === 'info' ? 'info' : message?.tone} />
      {list.loading ? (
        <Loading label="Loading visitors…" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !list.data?.items.length ? (
        <div className="empty"><p style={{ margin: 0 }}>No visitor requests match these filters.</p></div>
      ) : (
        <ul className="list" aria-label="Visitor register">
          {list.data.items.map((v) => (
            <VisitorCard
              key={v.id}
              visitor={v}
              canDecide={canDecide}
              canEntry={canEntry}
              canManage={canManage}
              canOverride={canOverride}
              busy={busy}
              onApprove={(x) => void act(x, () => api.approveVisitor(societyId, x.id), `${x.name} approved.`)}
              onReject={(x) => {
                const note = window.prompt(`Reason for rejecting ${x.name}? (optional)`);
                if (note === null) return;
                void act(x, () => api.rejectVisitor(societyId, x.id, note ? { note } : {}), `${x.name} rejected.`);
              }}
              onEntry={(x) => void act(x, () => api.enterVisitor(societyId, x.id), `${x.name}'s entry recorded.`)}
              onExit={(x) => void act(x, () => api.exitVisitor(societyId, x.id), `${x.name}'s exit recorded.`)}
              onCancel={(x) => void cancel(x)}
              onOverride={(x) => void override(x)}
            />
          ))}
        </ul>
      )}
      {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
    </section>
  );
}

/** Gate registration form. Retries reuse one idempotency key until the request succeeds. */
export function RegisterVisitorForm({ societyId, onCreated }: { societyId: string; onCreated?: (created: CreatedVisitorDto) => void }) {
  const destinations = useApi(() => api.visitorDestinations(societyId), [societyId]);
  const [values, setValues] = useState<{ name: string; phone: string; category: VisitorCategory; unitId: string; purpose: string }>({
    name: '',
    phone: '',
    category: 'VISITOR',
    unitId: '',
    purpose: '',
  });
  const [key, setKey] = useState(() => (globalThis.crypto?.randomUUID?.() ?? `visit-${Date.now()}`));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<ActionMessage>(null);
  const [busy, setBusy] = useState(false);
  const units = destinations.data?.items ?? [];
  const unitId = values.unitId || units[0]?.id || '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = createVisitorSchema.safeParse({
      name: values.name,
      phone: values.phone || undefined,
      category: values.category,
      unitId,
      purpose: values.purpose,
      idempotencyKey: key,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createVisitor(societyId, parsed.data);
      setMessage({
        tone: created.notification.delivered ? 'success' : 'info',
        text: created.notification.delivered
          ? `${created.visitor.name} registered. The resident was notified.`
          : `${created.visitor.name} registered. The request is in the resident's app; SMS is not configured.`,
      });
      setValues({ ...values, name: '', phone: '', purpose: '' });
      setKey(globalThis.crypto?.randomUUID?.() ?? `visit-${Date.now()}`);
      onCreated?.(created);
    } catch (err) {
      const error = err as ApiClientError;
      if (error.details) setErrors(error.details);
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="visitor-new-title">
      <h2 id="visitor-new-title" style={{ margin: 0 }}>Register a visitor</h2>
      {destinations.loading ? (
        <Loading label="Loading flats…" />
      ) : destinations.error ? (
        <ErrorState error={destinations.error} onRetry={destinations.reload} />
      ) : units.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No active flats exist yet. Ask an administrator to add units.</p>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field
              label="Visitor name"
              name="name"
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
              error={errors.name}
            />
            <Field
              label="Mobile number (optional)"
              name="phone"
              inputMode="tel"
              placeholder="98765 43210"
              value={values.phone}
              onChange={(e) => setValues({ ...values, phone: e.target.value })}
              error={errors.phone}
            />
            <div className="field">
              <label htmlFor="visitor-new-category">Category</label>
              <select
                id="visitor-new-category"
                className="input"
                value={values.category}
                onChange={(e) => setValues({ ...values, category: e.target.value as VisitorCategory })}
              >
                {VISITOR_CATEGORIES.map((c) => <option key={c} value={c}>{VISITOR_CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="visitor-new-unit">Destination flat</label>
              <select id="visitor-new-unit" className="input" value={unitId} onChange={(e) => setValues({ ...values, unitId: e.target.value })}>
                {units.map((u) => <option key={u.id} value={u.id}>{u.buildingName} · {u.tower}-{u.number}</option>)}
              </select>
              {errors.unitId && <span className="field-error" role="alert">{errors.unitId}</span>}
            </div>
          </div>
          <Field
            label="Purpose"
            name="purpose"
            placeholder="Meeting, parcel delivery, cab…"
            value={values.purpose}
            onChange={(e) => setValues({ ...values, purpose: e.target.value })}
            error={errors.purpose}
          />
          <FormAlert message={message?.text} tone={message?.tone === 'info' ? 'info' : message?.tone} />
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={busy}>Register visitor</button>
            <span className="subtle">The resident of the flat approves or rejects the request.</span>
          </div>
        </form>
      )}
    </section>
  );
}

/** Live gate queue: pending, approved and currently inside. */
export function VisitorLiveQueue({
  societyId,
  version,
  onChanged,
}: {
  societyId: string;
  version: number;
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<ActionMessage>(null);
  const list = useApi(() => api.listVisitors(societyId, { pageSize: 50 }), [societyId, version]);
  const queue = (list.data?.items ?? []).filter((v) => ACTIVE_STATUSES.includes(v.status));

  async function act(visitor: VisitorDto, action: () => Promise<unknown>, success: string) {
    setBusy(visitor.id);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
      onChanged?.();
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card stack" aria-labelledby="visitor-live-title" data-testid="live-queue">
      <div className="section-head">
        <h2 id="visitor-live-title" style={{ margin: 0 }}>Live gate queue</h2>
        <span className="badge badge-PENDING">{queue.length} open</span>
      </div>
      <FormAlert message={message?.text} tone={message?.tone === 'info' ? 'info' : message?.tone} />
      {list.loading ? (
        <Loading label="Loading the gate queue…" />
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : queue.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>No visitors are waiting or inside.</p></div>
      ) : (
        <ul className="list" aria-label="Live gate queue">
          {queue.map((v) => (
            <VisitorCard
              key={v.id}
              visitor={v}
              canEntry
              canManage
              busy={busy}
              onEntry={(x) => void act(x, () => api.enterVisitor(societyId, x.id), `${x.name}'s entry recorded.`)}
              onExit={(x) => void act(x, () => api.exitVisitor(societyId, x.id), `${x.name}'s exit recorded.`)}
              onCancel={(x) => {
                const reason = window.prompt(`Reason for cancelling ${x.name}'s request?`);
                if (reason === null) return;
                void act(x, () => api.cancelVisitor(societyId, x.id, { reason }), `${x.name}'s request cancelled.`);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
