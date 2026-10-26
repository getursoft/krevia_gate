'use client';

import Link from 'next/link';
import { useState, type ChangeEvent } from 'react';
import { ApiClientError, OCCUPANCY_LABEL, type ResidentImportJobDto } from '@krevia/shared';
import { AdminSocietyFrame, Pager, StateBadge } from '@/components/AdminSociety';
import { FormAlert } from '@/components/Field';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** Upload → validate → confirm. Nothing is written until the administrator confirms. */
export default function AdminResidentImportPage() {
  return <AdminSocietyFrame title="Import residents">{(societyId) => <ResidentImport societyId={societyId} />}</AdminSocietyFrame>;
}

function ResidentImport({ societyId }: { societyId: string }) {
  const [job, setJob] = useState<ResidentImportJobDto | null>(null);
  const [fileName, setFileName] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null);
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const history = useApi(() => api.listResidentImports(societyId, { page, pageSize: 10 }), [societyId, page, version]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setMessage({ tone: 'error', text: 'Choose a .csv file.' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ tone: 'error', text: 'The file is larger than 2 MB.' });
      return;
    }
    setBusy('preview');
    setMessage(null);
    setJob(null);
    try {
      const text = await file.text();
      const res = await api.previewResidentImport(societyId, file.name, text);
      setJob(res.job);
      setFileName(file.name);
      setMessage({
        tone: res.job.invalidRows > 0 ? 'error' : 'success',
        text: res.job.alreadyProcessed
          ? 'This exact file was already uploaded; showing the original preview.'
          : `${res.job.validRows} row(s) ready, ${res.job.invalidRows} rejected, ${res.job.duplicateRows} duplicate(s). Nothing has been imported yet.`,
      });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!job) return;
    setBusy('confirm');
    setMessage(null);
    try {
      const res = await api.confirmResidentImport(societyId, job.id);
      setJob(res.job);
      setMessage({
        tone: res.job.rejectedRows > 0 ? 'error' : 'success',
        text: `Import complete: ${res.job.createdRows} created, ${res.job.updatedRows} updated, ${res.job.skippedRows} skipped, ${res.job.rejectedRows} rejected.`,
      });
      setVersion((v) => v + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  const completed = job?.status === 'COMPLETED';

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card stack" aria-labelledby="import-upload">
        <h2 id="import-upload">Upload a resident CSV</h2>
        <p className="muted" style={{ margin: 0 }}>
          One row per person per unit. Towers / blocks and units must already exist. The preview checks every row; confirming imports only the valid rows in one transaction.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <a className="btn btn-secondary" href={api.residentsImportTemplateUrl(societyId)} download>Download template</a>
          <label className="btn btn-primary" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy === 'preview' ? 'Validating…' : 'Choose CSV file'}
            <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy !== null} style={{ display: 'none' }} data-testid="import-file" />
          </label>
          {fileName && <span className="subtle">{fileName}</span>}
        </div>
        <FormAlert message={message?.text} tone={message?.tone} />
      </section>

      {job && (
        <section className="card stack" aria-labelledby="import-preview">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h2 id="import-preview" style={{ margin: 0 }}>Preview · {job.fileName}</h2>
            <StateBadge value={job.status} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="badge badge-active">{job.totalRows} rows</span>
            <span className="badge badge-approved">{job.validRows} ready</span>
            <span className="badge badge-rejected">{job.invalidRows} rejected</span>
            <span className="badge badge-suspended">{job.duplicateRows} duplicate</span>
            {completed && <span className="badge badge-active">{job.createdRows} created · {job.updatedRows} updated · {job.skippedRows} skipped</span>}
          </div>
          {job.failureReason && <FormAlert message={job.failureReason} tone="error" />}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {!completed && job.status === 'PREVIEWED' && (
              <button type="button" className="btn btn-primary" disabled={busy !== null || job.validRows === 0} onClick={confirm}>
                {busy === 'confirm' ? 'Importing…' : `Import ${job.validRows} valid row(s)`}
              </button>
            )}
            {(job.invalidRows > 0 || job.rejectedRows > 0) && (
              <a className="btn btn-secondary" href={api.residentImportErrorsUrl(societyId, job.id)} download>Download rejected rows (CSV)</a>
            )}
            <Link className="btn btn-ghost" href="/admin/residents">Back to directory</Link>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table" aria-label="Import preview rows">
              <thead>
                <tr>
                  <th>Row</th><th>Action</th><th>Unit</th><th>Resident</th><th>Relationship</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                {job.rows.map((row) => (
                  <tr key={row.rowNumber} data-testid="import-row">
                    <td>{row.rowNumber}</td>
                    <td><StateBadge value={row.action === 'REJECT' ? 'REJECTED' : row.action === 'SKIP' ? 'SKIPPED' : row.action === 'UPDATE' ? 'UPDATED' : 'CREATED'} label={row.action} /></td>
                    <td>{row.building}{row.floor === null ? '' : ` · Floor ${row.floor}`} · {row.unitNumber}</td>
                    <td>{row.residentName ?? '—'}</td>
                    <td>{row.relationship ? OCCUPANCY_LABEL[row.relationship] : '—'}</td>
                    <td className="subtle">{row.message ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {job.errors.length > 0 && (
            <details>
              <summary className="subtle">{job.errors.length} validation message(s)</summary>
              <ul className="list">
                {job.errors.map((err, i) => (
                  <li key={`${err.rowNumber}-${err.field}-${i}`} className="list-item">
                    <span>Row {err.rowNumber} · {err.field}</span>
                    <span className="subtle">{err.message}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <section className="card stack" aria-labelledby="import-history">
        <h2 id="import-history">Recent imports</h2>
        {history.loading ? (
          <Loading label="Loading import history…" />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : !history.data?.items.length ? (
          <p className="muted" style={{ margin: 0 }}>No imports yet.</p>
        ) : (
          <ul className="list">
            {history.data.items.map((h) => (
              <li key={h.id} className="list-item" style={{ flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <strong>{h.fileName}</strong> <StateBadge value={h.status} />
                  <div className="subtle">
                    {new Date(h.createdAt).toLocaleString('en-IN')} · {h.totalRows} rows · {h.createdRows} created · {h.updatedRows} updated · {h.rejectedRows} rejected
                  </div>
                </div>
                {(h.invalidRows > 0 || h.rejectedRows > 0) && (
                  <a className="btn btn-ghost btn-sm" href={api.residentImportErrorsUrl(societyId, h.id)} download>Error report</a>
                )}
              </li>
            ))}
          </ul>
        )}
        {history.data && <Pager page={history.data.page} pageSize={history.data.pageSize} total={history.data.total} onPage={setPage} />}
      </section>
    </div>
  );
}
