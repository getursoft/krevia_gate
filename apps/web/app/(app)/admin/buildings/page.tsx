'use client';

import { useState, type FormEvent } from 'react';
import { ApiClientError, createBuildingSchema, createFloorSchema, fieldErrors, type BuildingDto } from '@krevia/shared';
import { AdminSocietyFrame } from '@/components/AdminSociety';
import { Field, FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Towers / blocks and the floors inside them. Units are added from the Units tab. */
export default function AdminBuildingsPage() {
  return <AdminSocietyFrame title="Buildings">{(societyId) => <Buildings societyId={societyId} />}</AdminSocietyFrame>;
}

function Buildings({ societyId }: { societyId: string }) {
  const [version, setVersion] = useState(0);
  const [includeArchived, setIncludeArchived] = useState(false);
  const list = useApi(() => api.listBuildings(societyId, { includeArchived: includeArchived ? 'true' : undefined }), [societyId, includeArchived, version]);
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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
    const parsed = createBuildingSchema.safeParse({ name });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      await api.createBuilding(societyId, { name });
      setName('');
    }, `${name.trim()} added.`);
  }

  async function archive(building: BuildingDto) {
    if (!window.confirm(`Archive ${building.name}? Floors are kept and units must be archived first.`)) return;
    setBusy(building.id);
    setMessage(null);
    try {
      await api.archiveBuilding(societyId, building.id);
      setMessage({ tone: 'success', text: `${building.name} archived.` });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card stack" aria-labelledby="building-add">
        <h2 id="building-add">Add a tower / block</h2>
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={onCreate} noValidate>
          <Field label="Name" name="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="e.g. T1 or Wing A" />
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>Add building</button>
        </form>
      </section>
      <FormAlert message={message?.text} tone={message?.tone} />
      <section className="card stack" aria-labelledby="building-list">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="building-list" style={{ margin: 0 }}>Buildings and floors</h2>
          <label className="row" style={{ gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        {list.loading ? (
          <Loading label="Loading buildings…" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : !list.data?.items.length ? (
          <div className="empty"><p style={{ margin: 0 }}>No buildings yet. Add a tower / block to start creating units.</p></div>
        ) : (
          <ul className="list" aria-label="Buildings">
            {list.data.items.map((b) => (
              <BuildingRow key={b.id} societyId={societyId} building={b} busy={busy} onArchive={archive} onChanged={() => setVersion((v) => v + 1)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BuildingRow({
  societyId,
  building,
  busy,
  onArchive,
  onChanged,
}: {
  societyId: string;
  building: BuildingDto;
  busy: string | null;
  onArchive: (b: BuildingDto) => void;
  onChanged: () => void;
}) {
  const [level, setLevel] = useState('');
  const [floorName, setFloorName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function addFloor(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createFloorSchema.safeParse({ level, name: floorName || undefined });
    if (!parsed.success) return setError(Object.values(fieldErrors(parsed.error))[0] ?? 'Check the floor details.');
    try {
      await api.createFloor(societyId, building.id, { level: Number(level), name: floorName || undefined });
      setLevel('');
      setFloorName('');
      onChanged();
    } catch (err) {
      setError((err as ApiClientError).message);
    }
  }

  async function removeFloor(floorId: string) {
    if (!window.confirm('Delete this floor? It must have no units.')) return;
    try {
      await api.deleteFloor(societyId, building.id, floorId);
      onChanged();
    } catch (err) {
      setError((err as ApiClientError).message);
    }
  }

  return (
    <li className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }} data-testid="building-row">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <strong>{building.name}</strong>{' '}
          {building.archivedAt && <span className="badge badge-archived">Archived</span>}
          <div className="subtle">{building.floors.length} floor(s) · {building.unitCount} unit(s)</div>
        </div>
        {!building.archivedAt && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => onArchive(building)}>Archive</button>
        )}
      </div>
      <ul className="list" aria-label={`Floors in ${building.name}`}>
        {building.floors.map((f) => (
          <li key={f.id} className="list-item">
            <span>Floor {f.level}{f.name ? ` · ${f.name}` : ''} <span className="subtle">({f.unitCount} units)</span></span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeFloor(f.id)}>Delete</button>
          </li>
        ))}
        {building.floors.length === 0 && <li className="subtle">No floors yet. Units can still be added without a floor.</li>}
      </ul>
      {!building.archivedAt && (
        <form className="row" onSubmit={addFloor} noValidate style={{ alignItems: 'flex-end' }}>
          <Field label="Floor level" name={`level-${building.id}`} type="number" inputMode="numeric" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="0 = ground" />
          <Field label="Floor label (optional)" name={`floor-name-${building.id}`} value={floorName} onChange={(e) => setFloorName(e.target.value)} placeholder="Ground" />
          <button type="submit" className="btn btn-secondary btn-sm">Add floor</button>
        </form>
      )}
      {error && <FormAlert message={error} tone="error" />}
    </li>
  );
}
