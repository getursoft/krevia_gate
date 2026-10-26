'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  ApiClientError,
  OCCUPANCY_LABEL,
  createResidentSchema,
  fieldErrors,
  type ResidentDto,
} from '@krevia/shared';
import { AdminSocietyFrame, Pager, StateBadge } from '@/components/AdminSociety';
import { Field, FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** The society's resident directory: people, their units and CSV import. */
export default function AdminResidentsPage() {
  return <AdminSocietyFrame title="Residents">{(societyId) => <Residents societyId={societyId} />}</AdminSocietyFrame>;
}

function Residents({ societyId }: { societyId: string }) {
  const buildings = useApi(() => api.listBuildings(societyId), [societyId]);
  const units = useApi(() => api.listUnits(societyId, { status: 'ACTIVE', pageSize: 100 }), [societyId]);
  const [filters, setFilters] = useState({ buildingId: '', status: '', q: '' });
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const list = useApi(() => api.listResidents(societyId, { ...filters, q, page, pageSize: 25 }), [societyId, filters, q, page, version]);
  const [values, setValues] = useState({ fullName: '', phone: '', email: '', unitId: '', relationship: 'OWNER', isPrimary: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const unitItems = units.data?.items ?? [];
  const unitId = values.unitId || unitItems[0]?.id || '';

  async function run(action: () => Promise<void>, success: string) {
    setMessage(null);
    setBusy('form');
    try {
      await action();
      setMessage({ tone: 'success', text: success });
      setVersion((v) => v + 1);
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setBusy(null);
    }
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    const parsed = createResidentSchema.safeParse({
      fullName: values.fullName,
      phone: values.phone || undefined,
      email: values.email || undefined,
      unitId,
      relationship: values.relationship,
      isPrimary: values.isPrimary,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      await api.createResident(societyId, {
        fullName: values.fullName,
        phone: values.phone || undefined,
        email: values.email || undefined,
        unitId,
        relationship: values.relationship as 'OWNER' | 'TENANT' | 'HOUSEHOLD',
        isPrimary: values.isPrimary,
      });
      setValues({ ...values, fullName: '', phone: '', email: '', isPrimary: false });
    }, `${values.fullName} added to the directory.`);
  }

  async function archive(resident: ResidentDto) {
    if (!window.confirm(`Archive ${resident.fullName}? Their active unit links and assignments will end.`)) return;
    setBusy(resident.id);
    setMessage(null);
    try {
      await api.archiveResident(societyId, resident.id);
      setMessage({ tone: 'success', text: `${resident.fullName} archived.` });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card stack" aria-labelledby="resident-add">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="resident-add" style={{ margin: 0 }}>Add a resident</h2>
          <Link className="btn btn-secondary btn-sm" href="/admin/residents/import">Import CSV</Link>
        </div>
        {unitItems.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Add a unit on the Units tab before recording residents.</p>
        ) : (
          <form className="grid grid-2" onSubmit={onCreate} noValidate>
            <Field label="Full name" name="fullName" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} error={errors.fullName} />
            <Field label="Mobile number" name="phone" type="tel" inputMode="numeric" prefix="+91" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} error={errors.phone} />
            <Field label="Email (optional)" name="email" type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} error={errors.email} />
            <div className="field">
              <label htmlFor="resident-unit">Unit</label>
              <select id="resident-unit" className="input" value={unitId} onChange={(e) => setValues({ ...values, unitId: e.target.value })} aria-invalid={errors.unitId ? true : undefined}>
                {unitItems.map((u) => <option key={u.id} value={u.id}>{u.tower}-{u.number}{u.floorLevel === null ? '' : ` · Floor ${u.floorLevel}`}</option>)}
              </select>
              {errors.unitId && <span className="field-error" role="alert">{errors.unitId}</span>}
            </div>
            <div className="field">
              <label htmlFor="resident-relationship">Relationship</label>
              <select id="resident-relationship" className="input" value={values.relationship} onChange={(e) => setValues({ ...values, relationship: e.target.value })}>
                <option value="OWNER">Owner</option>
                <option value="TENANT">Tenant</option>
                <option value="HOUSEHOLD">Household member</option>
              </select>
            </div>
            <label className="row" style={{ gap: 8, alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={values.isPrimary} onChange={(e) => setValues({ ...values, isPrimary: e.target.checked })} />
              Primary resident for this unit
            </label>
            <div style={{ gridColumn: '1 / -1' }}>
              <button type="submit" className="btn btn-primary" disabled={busy !== null}>Add resident</button>
            </div>
          </form>
        )}
      </section>
      <FormAlert message={message?.text} tone={message?.tone} />
      <section className="card stack" aria-labelledby="resident-list">
        <h2 id="resident-list">Directory</h2>
        <form
          className="row"
          style={{ flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilters({ ...filters, q });
          }}
        >
          <label className="sr-only" htmlFor="resident-q">Search residents</label>
          <input id="resident-q" className="input" style={{ maxWidth: 220 }} placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sr-only" htmlFor="resident-filter-building">Building</label>
          <select id="resident-filter-building" className="input" style={{ width: 'auto' }} value={filters.buildingId} onChange={(e) => { setPage(1); setFilters({ ...filters, buildingId: e.target.value }); }}>
            <option value="">All buildings</option>
            {buildings.data?.items.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="resident-filter-status">Status</label>
          <select id="resident-filter-status" className="input" style={{ width: 'auto' }} value={filters.status} onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <button type="submit" className="btn btn-secondary">Search</button>
        </form>
        {list.loading ? (
          <Loading label="Loading residents…" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data?.items.length ? (
          <div className="empty"><p style={{ margin: 0 }}>No residents match these filters.</p></div>
        ) : (
          <ul className="list" aria-label="Residents">
            {list.data.items.map((r) => (
              <li key={r.id} className="list-item" style={{ flexWrap: 'wrap' }} data-testid="resident-row">
                <div style={{ flex: 1, minWidth: 220 }}>
                  <strong><Link href={`/admin/residents/${r.id}`}>{r.fullName}</Link></strong>{' '}
                  {r.phone && <span className="subtle">{r.phone}</span>}
                  <div className="subtle">
                    {r.units.filter((u) => u.endedAt === null).map((u) => `${u.tower}-${u.number} (${OCCUPANCY_LABEL[u.relationship]}${u.isPrimary ? ', primary' : ''})`).join(' · ') || 'No active unit'}
                  </div>
                </div>
                <StateBadge value={r.status} />
                <div className="row">
                  <Link className="btn btn-secondary btn-sm" href={`/admin/residents/${r.id}`}>Open</Link>
                  {r.status === 'ACTIVE' && (
                    <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => archive(r)}>Archive</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
