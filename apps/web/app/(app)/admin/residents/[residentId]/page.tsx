'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiClientError, OCCUPANCY_LABEL, type ResidentDto, type UnitDto } from '@krevia/shared';
import { AdminSocietyFrame, StateBadge } from '@/components/AdminSociety';
import { Field, FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

export default function AdminResidentDetailPage() {
  return <AdminSocietyFrame title="Resident">{(societyId) => <ResidentDetail societyId={societyId} />}</AdminSocietyFrame>;
}

function ResidentDetail({ societyId }: { societyId: string }) {
  const params = useParams<{ residentId: string }>();
  const residentId = params.residentId;
  const resident = useApi(() => api.getResident(societyId, residentId), [societyId, residentId]);
  const units = useApi(() => api.listUnits(societyId, { status: 'ACTIVE', pageSize: 100 }), [societyId]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, success: string) {
    setMessage(null);
    setBusy(true);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
      resident.reload();
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(false);
    }
  }

  if (resident.loading) return <Loading label="Loading resident…" />;
  if (resident.error) return <ErrorState error={resident.error} onRetry={resident.reload} />;
  if (!resident.data) return null;
  const r = resident.data.resident;
  const active = r.units.filter((u) => u.endedAt === null);
  const ended = r.units.filter((u) => u.endedAt !== null);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0 }}>{r.fullName}</h2>
          <div className="subtle">{r.phone ?? 'No mobile number'} · {r.email ?? 'No email'} <StateBadge value={r.status} /></div>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/admin/residents">Back to directory</Link>
      </div>
      <FormAlert message={message?.text} tone={message?.tone} />
      <EditResident societyId={societyId} resident={r} busy={busy} onSave={(body, success) => run(() => api.updateResident(societyId, r.id, body).then(() => undefined), success)} />
      <section className="card stack" aria-labelledby="resident-units">
        <h2 id="resident-units">Units</h2>
        {active.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No active unit links.</p>
        ) : (
          <ul className="list">
            {active.map((u) => (
              <UnitLink
                key={u.id}
                societyId={societyId}
                residentId={r.id}
                link={u}
                busy={busy}
                onChanged={() => resident.reload()}
                onMessage={setMessage}
              />
            ))}
          </ul>
        )}
        <AddUnit
          societyId={societyId}
          residentId={r.id}
          units={units.data?.items ?? []}
          busy={busy}
          onDone={(text) => {
            setMessage({ tone: 'success', text });
            resident.reload();
          }}
          onError={(text) => setMessage({ tone: 'error', text })}
        />
        {ended.length > 0 && (
          <details>
            <summary className="subtle">{ended.length} past unit link(s)</summary>
            <ul className="list">
              {ended.map((u) => (
                <li key={u.id} className="list-item">
                  <span>{u.tower}-{u.number} · {OCCUPANCY_LABEL[u.relationship]}</span>
                  <span className="subtle">ended {new Date(u.endedAt!).toLocaleDateString('en-IN')}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {r.status === 'ACTIVE' && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Archive</h2>
          <p className="muted" style={{ margin: 0 }}>Archiving ends every active unit link and assignment. The history is kept.</p>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Archive ${r.fullName}?`)) return;
              void run(() => api.archiveResident(societyId, r.id).then(() => undefined), `${r.fullName} archived.`);
            }}
          >
            Archive resident
          </button>
        </section>
      )}
    </div>
  );
}

function EditResident({
  societyId,
  resident,
  busy,
  onSave,
}: {
  societyId: string;
  resident: ResidentDto;
  busy: boolean;
  onSave: (body: Parameters<typeof api.updateResident>[2], success: string) => void;
}) {
  const [values, setValues] = useState({
    fullName: resident.fullName,
    phone: resident.phone ?? '',
    email: resident.email ?? '',
    emergencyContactName: resident.emergencyContactName ?? '',
    emergencyContactPhone: resident.emergencyContactPhone ?? '',
    vehicles: resident.vehicles.map((v) => v.number).join('; '),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(
      {
        fullName: values.fullName,
        phone: values.phone || null,
        email: values.email || null,
        emergencyContactName: values.emergencyContactName || '',
        emergencyContactPhone: values.emergencyContactPhone || null,
        vehicles: values.vehicles
          .split(';')
          .map((v) => v.trim())
          .filter(Boolean)
          .map((number) => ({ number })),
      },
      'Resident details saved.',
    );
  }

  return (
    <section className="card stack" aria-labelledby="resident-edit">
      <h2 id="resident-edit">Contact details</h2>
      <form className="grid grid-2" onSubmit={submit} noValidate>
        <Field label="Full name" name="fullName" value={values.fullName} onChange={(e) => setValues({ ...values, fullName: e.target.value })} />
        <Field label="Mobile number" name="phone" type="tel" inputMode="numeric" prefix="+91" value={values.phone} onChange={(e) => setValues({ ...values, phone: e.target.value })} />
        <Field label="Email" name="email" type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} />
        <Field label="Emergency contact name" name="emergencyContactName" value={values.emergencyContactName} onChange={(e) => setValues({ ...values, emergencyContactName: e.target.value })} />
        <Field label="Emergency contact phone" name="emergencyContactPhone" type="tel" inputMode="numeric" prefix="+91" value={values.emergencyContactPhone} onChange={(e) => setValues({ ...values, emergencyContactPhone: e.target.value })} />
        <Field label="Vehicles (separate with ;)" name="vehicles" value={values.vehicles} onChange={(e) => setValues({ ...values, vehicles: e.target.value })} />
        <div style={{ gridColumn: '1 / -1' }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>Save details</button>
        </div>
      </form>
      <p className="subtle" style={{ margin: 0 }}>Society {societyId.slice(0, 8)}… · emergency contacts are visible to society administrators only.</p>
    </section>
  );
}

function UnitLink({
  societyId,
  residentId,
  link,
  busy,
  onChanged,
  onMessage,
}: {
  societyId: string;
  residentId: string;
  link: ResidentDto['units'][number];
  busy: boolean;
  onChanged: () => void;
  onMessage: (m: { tone: 'success' | 'error'; text: string }) => void;
}) {
  const [relationship, setRelationship] = useState(link.relationship);
  const [primary, setPrimary] = useState(link.isPrimary);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.updateResidentUnit(societyId, residentId, link.id, { relationship, isPrimary: primary });
      onMessage({ tone: 'success', text: 'Unit link updated.' });
      onChanged();
    } catch (err) {
      onMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setSaving(false);
    }
  }

  async function end() {
    if (!window.confirm(`End the link to ${link.tower}-${link.number}?`)) return;
    setSaving(true);
    try {
      await api.endResidentUnit(societyId, residentId, link.id);
      onMessage({ tone: 'success', text: 'Unit link ended.' });
      onChanged();
    } catch (err) {
      onMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="list-item" style={{ flexWrap: 'wrap' }}>
      <strong style={{ minWidth: 120 }}>{link.tower}-{link.number}</strong>
      <select className="input" style={{ width: 'auto' }} value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)} aria-label="Relationship">
        <option value="OWNER">Owner</option>
        <option value="TENANT">Tenant</option>
        <option value="HOUSEHOLD">Household member</option>
      </select>
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
        Primary
      </label>
      <button type="button" className="btn btn-secondary btn-sm" disabled={saving || busy} onClick={save}>Save</button>
      <button type="button" className="btn btn-danger btn-sm" disabled={saving || busy} onClick={end}>End link</button>
    </li>
  );
}

function AddUnit({
  societyId,
  residentId,
  units,
  busy,
  onDone,
  onError,
}: {
  societyId: string;
  residentId: string;
  units: UnitDto[];
  busy: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [unitId, setUnitId] = useState('');
  const [relationship, setRelationship] = useState<'OWNER' | 'TENANT' | 'HOUSEHOLD'>('HOUSEHOLD');
  const [primary, setPrimary] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!unitId) return onError('Choose a unit.');
    setSaving(true);
    try {
      await api.addResidentUnit(societyId, residentId, { unitId, relationship, isPrimary: primary });
      setUnitId('');
      onDone('Unit linked.');
    } catch (err) {
      onError((err as ApiClientError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="row" onSubmit={submit} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <div className="field">
        <label htmlFor="add-unit">Link another unit</label>
        <select id="add-unit" className="input" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">Choose a unit</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.tower}-{u.number}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="add-relationship">Relationship</label>
        <select id="add-relationship" className="input" value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)}>
          <option value="OWNER">Owner</option>
          <option value="TENANT">Tenant</option>
          <option value="HOUSEHOLD">Household member</option>
        </select>
      </div>
      <label className="row" style={{ gap: 6, paddingBottom: 8 }}>
        <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />
        Primary
      </label>
      <button type="submit" className="btn btn-secondary" disabled={saving || busy}>Link unit</button>
    </form>
  );
}
