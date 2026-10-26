'use client';

import { useState, type FormEvent } from 'react';
import {
  ApiClientError,
  OCCUPANCY_LABEL,
  createUnitSchema,
  fieldErrors,
  type BuildingDto,
  type MemberDto,
  type UnitDto,
} from '@krevia/shared';
import { AdminSocietyFrame, Pager, StateBadge } from '@/components/AdminSociety';
import { Field, FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Flats of the society, their floor, residents and archival state. */
export default function AdminUnitsPage() {
  return <AdminSocietyFrame title="Units">{(societyId) => <Units societyId={societyId} />}</AdminSocietyFrame>;
}

function Units({ societyId }: { societyId: string }) {
  const buildings = useApi(() => api.listBuildings(societyId), [societyId]);
  const residents = useApi(() => api.listMembers(societyId, { role: 'RESIDENT', status: 'ACTIVE', pageSize: 100 }), [societyId]);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [filters, setFilters] = useState({ buildingId: '', status: '', occupancy: '', q: '' });
  const [q, setQ] = useState('');
  const list = useApi(() => api.listUnits(societyId, { ...filters, q, page, pageSize: 25 }), [societyId, filters, q, page, version]);
  const [values, setValues] = useState({ buildingId: '', floorId: '', number: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const buildingItems = buildings.data?.items ?? [];
  const buildingId = values.buildingId || buildingItems[0]?.id || '';
  const selected = buildingItems.find((b) => b.id === buildingId);

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
    const parsed = createUnitSchema.safeParse({
      buildingId,
      floorId: values.floorId || undefined,
      number: values.number,
    });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      await api.createUnit(societyId, {
        buildingId,
        floorId: values.floorId || undefined,
        number: values.number,
      });
      setValues({ ...values, number: '' });
    }, `Unit ${values.number.toUpperCase()} added.`);
  }

  async function archive(unit: UnitDto) {
    if (!window.confirm(`Archive ${unit.tower}-${unit.number}? End resident links first.`)) return;
    setBusy(unit.id);
    setMessage(null);
    try {
      await api.archiveUnit(societyId, unit.id);
      setMessage({ tone: 'success', text: `${unit.tower}-${unit.number} archived.` });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  async function restore(unit: UnitDto) {
    setBusy(unit.id);
    setMessage(null);
    try {
      await api.restoreUnit(societyId, unit.id);
      setMessage({ tone: 'success', text: `${unit.tower}-${unit.number} restored.` });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card stack" aria-labelledby="unit-add">
        <h2 id="unit-add">Add a unit</h2>
        {buildingItems.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Add a tower / block on the Buildings tab first.</p>
        ) : (
          <form className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={onCreate} noValidate>
            <div className="field">
              <label htmlFor="unit-building">Tower / block</label>
              <select
                id="unit-building"
                className="input"
                value={buildingId}
                onChange={(e) => setValues({ ...values, buildingId: e.target.value, floorId: '' })}
              >
                {buildingItems.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="unit-floor">Floor (optional)</label>
              <select id="unit-floor" className="input" value={values.floorId} onChange={(e) => setValues({ ...values, floorId: e.target.value })}>
                <option value="">No floor</option>
                {selected?.floors.map((f) => <option key={f.id} value={f.id}>Floor {f.level}{f.name ? ` · ${f.name}` : ''}</option>)}
              </select>
            </div>
            <Field label="Flat / unit number" name="number" value={values.number} onChange={(e) => setValues({ ...values, number: e.target.value })} error={errors.number} />
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>Add unit</button>
          </form>
        )}
      </section>
      <FormAlert message={message?.text} tone={message?.tone} />
      <section className="card stack" aria-labelledby="unit-list">
        <h2 id="unit-list">Units</h2>
        <form
          className="row"
          style={{ flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setFilters({ ...filters, q });
          }}
        >
          <label className="sr-only" htmlFor="unit-q">Search units</label>
          <input id="unit-q" className="input" style={{ maxWidth: 180 }} placeholder="Unit number" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="sr-only" htmlFor="unit-filter-building">Building</label>
          <select id="unit-filter-building" className="input" style={{ width: 'auto' }} value={filters.buildingId} onChange={(e) => { setPage(1); setFilters({ ...filters, buildingId: e.target.value }); }}>
            <option value="">All buildings</option>
            {buildingItems.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="unit-filter-status">Status</label>
          <select id="unit-filter-status" className="input" style={{ width: 'auto' }} value={filters.status} onChange={(e) => { setPage(1); setFilters({ ...filters, status: e.target.value }); }}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <label className="sr-only" htmlFor="unit-filter-occupancy">Occupancy</label>
          <select id="unit-filter-occupancy" className="input" style={{ width: 'auto' }} value={filters.occupancy} onChange={(e) => { setPage(1); setFilters({ ...filters, occupancy: e.target.value }); }}>
            <option value="">All units</option>
            <option value="OCCUPIED">Occupied</option>
            <option value="VACANT">Vacant</option>
          </select>
          <button type="submit" className="btn btn-secondary">Search</button>
        </form>
        {list.loading ? (
          <Loading label="Loading units…" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data?.items.length ? (
          <div className="empty"><p style={{ margin: 0 }}>No units match these filters.</p></div>
        ) : (
          <ul className="list" aria-label="Units">
            {list.data.items.map((u) => (
              <UnitRow
                key={u.id}
                societyId={societyId}
                unit={u}
                buildings={buildingItems}
                residents={residents.data?.items ?? []}
                busy={busy}
                onArchive={archive}
                onRestore={restore}
                onChanged={() => setVersion((v) => v + 1)}
                onError={(text) => setMessage({ tone: 'error', text })}
                onSuccess={(text) => setMessage({ tone: 'success', text })}
              />
            ))}
          </ul>
        )}
        {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
      </section>
    </div>
  );
}

function UnitRow({
  societyId,
  unit,
  buildings,
  residents,
  busy,
  onArchive,
  onRestore,
  onChanged,
  onError,
  onSuccess,
}: {
  societyId: string;
  unit: UnitDto;
  buildings: BuildingDto[];
  residents: MemberDto[];
  busy: string | null;
  onArchive: (u: UnitDto) => void;
  onRestore: (u: UnitDto) => void;
  onChanged: () => void;
  onError: (text: string) => void;
  onSuccess: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [number, setNumber] = useState(unit.number);
  const [buildingId, setBuildingId] = useState(unit.buildingId);
  const [floorId, setFloorId] = useState(unit.floorId ?? '');
  const [assign, setAssign] = useState<{ membershipId: string; occupancy: 'OWNER' | 'TENANT' | 'HOUSEHOLD' }>({ membershipId: '', occupancy: 'OWNER' });
  const [saving, setSaving] = useState(false);
  const building = buildings.find((b) => b.id === buildingId);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateUnit(societyId, unit.id, {
        number,
        buildingId,
        floorId: floorId || null,
      });
      setEditing(false);
      onSuccess(`${unit.tower}-${unit.number} updated.`);
      onChanged();
    } catch (err) {
      onError((err as ApiClientError).message);
    } finally {
      setSaving(false);
    }
  }

  async function assignResident() {
    if (!assign.membershipId) return onError('Choose a resident to assign.');
    setSaving(true);
    try {
      await api.assignUnit(societyId, unit.id, assign);
      setAssign({ membershipId: '', occupancy: 'OWNER' });
      onSuccess(`Resident assigned to ${unit.tower}-${unit.number}.`);
      onChanged();
    } catch (err) {
      onError((err as ApiClientError).message);
    } finally {
      setSaving(false);
    }
  }

  async function end(assignmentId: string, name: string) {
    if (!window.confirm(`Remove ${name} from ${unit.tower}-${unit.number}?`)) return;
    setSaving(true);
    try {
      await api.endAssignment(societyId, unit.id, assignmentId);
      onSuccess(`${name} removed from ${unit.tower}-${unit.number}.`);
      onChanged();
    } catch (err) {
      onError((err as ApiClientError).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="list-item" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }} data-testid="unit-row">
      <div style={{ flex: 1, minWidth: 220 }}>
        {editing ? (
          <form className="row" onSubmit={save} style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label="Unit number" name={`number-${unit.id}`} value={number} onChange={(e) => setNumber(e.target.value)} />
            <div className="field">
              <label htmlFor={`building-${unit.id}`}>Building</label>
              <select id={`building-${unit.id}`} className="input" value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setFloorId(''); }}>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`floor-${unit.id}`}>Floor</label>
              <select id={`floor-${unit.id}`} className="input" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
                <option value="">No floor</option>
                {building?.floors.map((f) => <option key={f.id} value={f.id}>Floor {f.level}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
          </form>
        ) : (
          <>
            <strong>{unit.tower}-{unit.number}</strong>{' '}
            <StateBadge value={unit.status} />
            <span className="subtle" style={{ marginLeft: 8 }}>
              {unit.floorLevel === null ? 'No floor' : `Floor ${unit.floorLevel}`} · {unit.occupancyStatus === 'OCCUPIED' ? 'Occupied' : 'Vacant'}
            </span>
            {unit.residents.length === 0 ? (
              <div className="subtle">No residents linked.</div>
            ) : (
              unit.residents.map((r) => (
                <div key={`${r.residentId}-${r.assignmentId ?? 'directory'}`} className="row" style={{ gap: 8 }}>
                  <span>{r.fullName} · {OCCUPANCY_LABEL[r.occupancy]}</span>
                  {r.assignmentId ? (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => end(r.assignmentId!, r.fullName)}>Remove</button>
                  ) : (
                    <span className="subtle">directory only</span>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>
      {!editing && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {unit.status === 'ACTIVE' ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => onArchive(unit)}>Archive</button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => onRestore(unit)}>Restore</button>
          )}
        </div>
      )}
      {unit.status === 'ACTIVE' && !editing && (
        <div className="row" style={{ width: '100%', flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor={`assign-${unit.id}`}>Resident for {unit.tower}-{unit.number}</label>
          <select
            id={`assign-${unit.id}`}
            className="input"
            style={{ width: 'auto' }}
            value={assign.membershipId}
            onChange={(e) => setAssign({ ...assign, membershipId: e.target.value })}
          >
            <option value="">Assign resident…</option>
            {residents.map((m) => <option key={m.id} value={m.id}>{m.user.fullName}</option>)}
          </select>
          <label className="sr-only" htmlFor={`occ-${unit.id}`}>Occupancy</label>
          <select
            id={`occ-${unit.id}`}
            className="input"
            style={{ width: 'auto' }}
            value={assign.occupancy}
            onChange={(e) => setAssign({ ...assign, occupancy: e.target.value as 'OWNER' | 'TENANT' | 'HOUSEHOLD' })}
          >
            <option value="OWNER">Owner</option>
            <option value="TENANT">Tenant</option>
            <option value="HOUSEHOLD">Household member</option>
          </select>
          <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={assignResident}>Assign</button>
        </div>
      )}
    </li>
  );
}
