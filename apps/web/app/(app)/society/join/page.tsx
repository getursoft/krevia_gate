'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ApiClientError,
  OCCUPANCY_LABEL,
  createMembershipRequestSchema,
  fieldErrors,
  type MembershipRequestDto,
  type OccupancyType,
  type SocietyDetailDto,
  type SocietySummaryDto,
} from '@krevia/shared';
import { useSession } from '@/components/AppShell';
import { FormAlert } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { ErrorState, Loading, StatusBadge } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

type Step = 'search' | 'details' | 'review';

export default function JoinSocietyPage() {
  const { reloadMembership } = useSession();
  const membership = useApi(() => api.myMembership());
  const refresh = () => {
    void membership.reload();
    void reloadMembership();
  };

  if (membership.loading) return <div className="page"><Loading /></div>;
  if (membership.error) return <div className="page"><ErrorState error={membership.error} onRetry={membership.reload} /></div>;

  const current = membership.data?.current;
  return (
    <div className="page stack" style={{ gap: 20, maxWidth: 760 }}>
      {current ? (
        <MembershipStatusCard request={current} onChange={refresh} />
      ) : (
        <JoinFlow onSubmitted={refresh} />
      )}
    </div>
  );
}

function MembershipStatusCard({ request, onChange }: { request: MembershipRequestDto; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    if (!window.confirm('Withdraw this membership request?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.cancelMembershipRequest(request.id);
      onChange();
    } catch (err) {
      setError((err as ApiClientError).message);
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="status-title">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 id="status-title" style={{ fontSize: '1.5rem', margin: 0 }}>Membership request</h1>
        <StatusBadge status={request.status} />
      </div>
      <FormAlert message={error} />
      <dl className="grid grid-2" style={{ margin: 0 }}>
        <div><dt className="card-title">Society</dt><dd className="card-value" style={{ margin: 0 }}>{request.society.name}</dd><dd className="subtle" style={{ margin: 0 }}>{request.society.addressLine}, {request.society.city}</dd></div>
        <div><dt className="card-title">Apartment</dt><dd className="card-value" style={{ margin: 0 }}>{request.tower} · {request.unitNumber}</dd><dd className="subtle" style={{ margin: 0 }}>{OCCUPANCY_LABEL[request.occupancy]}</dd></div>
      </dl>
      {request.status === 'PENDING' ? (
        <div className="alert alert-info" role="status">
          Your request has been sent to {request.society.name}. A society administrator will verify your details. You will
          get resident access once approved.
        </div>
      ) : (
        <div className="alert alert-success" role="status">You are a verified member of {request.society.name}.</div>
      )}
      <div className="row">
        <Link href="/dashboard" className="btn btn-primary">Go to dashboard</Link>
        {request.status === 'PENDING' && (
          <button type="button" className="btn btn-danger" onClick={withdraw} disabled={busy}>
            {busy ? 'Withdrawing…' : 'Withdraw request'}
          </button>
        )}
      </div>
    </section>
  );
}

function JoinFlow({ onSubmitted }: { onSubmitted: () => void }) {
  const [step, setStep] = useState<Step>('search');
  const [society, setSociety] = useState<SocietyDetailDto | null>(null);
  const [details, setDetails] = useState<{ tower: string; unitNumber: string; occupancy: OccupancyType | '' }>({
    tower: '',
    unitNumber: '',
    occupancy: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const steps: { key: Step; label: string }[] = [
    { key: 'search', label: '1. Find society' },
    { key: 'details', label: '2. Apartment details' },
    { key: 'review', label: '3. Review & submit' },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  function toReview(e: FormEvent) {
    e.preventDefault();
    const parsed = createMembershipRequestSchema.safeParse({ societyId: society?.id, ...details });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setStep('review');
  }

  async function submit() {
    if (!society) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await api.createMembershipRequest({ societyId: society.id, ...details, occupancy: details.occupancy as OccupancyType });
      onSubmitted();
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) {
        setErrors(e.details);
        setStep('details');
      }
      setFormError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="join-title">
      <h1 id="join-title" style={{ fontSize: '1.5rem' }}>Join your society</h1>
      <ol className="steps" aria-label="Progress">
        {steps.map((s, i) => (
          <li key={s.key} aria-current={i === stepIndex ? 'step' : undefined} className={i < stepIndex ? 'done' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
      <FormAlert message={formError} />

      {step === 'search' && (
        <SocietySearch
          selectedId={society?.id}
          onSelect={(s) => {
            setSociety(s);
            setDetails((d) => ({ ...d, tower: '' }));
            setStep('details');
          }}
        />
      )}

      {step === 'details' && society && (
        <form className="stack" onSubmit={toReview} noValidate>
          <div className="card card-mint row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong data-testid="selected-society">{society.name}</strong>
              <div className="subtle">{society.addressLine}, {society.city} {society.pincode}</div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep('search')}>Change</button>
          </div>
          <div className="field">
            <label htmlFor="tower">Tower / block</label>
            <select
              id="tower"
              name="tower"
              className="input"
              value={details.tower}
              aria-invalid={errors.tower ? true : undefined}
              onChange={(e) => setDetails({ ...details, tower: e.target.value })}
            >
              <option value="">Select tower / block</option>
              {society.towers.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {errors.tower && <span className="field-error" role="alert">{errors.tower}</span>}
          </div>
          <div className="field">
            <label htmlFor="unitNumber">Flat / unit number</label>
            <input
              id="unitNumber"
              name="unitNumber"
              className="input"
              placeholder="e.g. 1203"
              autoComplete="off"
              value={details.unitNumber}
              aria-invalid={errors.unitNumber ? true : undefined}
              onChange={(e) => setDetails({ ...details, unitNumber: e.target.value })}
            />
            {errors.unitNumber && <span className="field-error" role="alert">{errors.unitNumber}</span>}
          </div>
          <fieldset className="field">
            <legend>You are the</legend>
            <div className="choice-group" style={{ marginTop: 6 }}>
              {(['OWNER', 'TENANT'] as const).map((o) => (
                <label key={o} className="choice">
                  <input
                    type="radio"
                    name="occupancy"
                    value={o}
                    checked={details.occupancy === o}
                    onChange={() => setDetails({ ...details, occupancy: o })}
                  />
                  {OCCUPANCY_LABEL[o]}
                </label>
              ))}
            </div>
            {errors.occupancy && <span className="field-error" role="alert">{errors.occupancy}</span>}
          </fieldset>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setStep('search')}>Back</button>
            <button type="submit" className="btn btn-primary">Continue</button>
          </div>
        </form>
      )}

      {step === 'review' && society && (
        <div className="stack">
          <dl className="grid grid-2" style={{ margin: 0 }}>
            <div><dt className="card-title">Society</dt><dd className="card-value" style={{ margin: 0 }}>{society.name}</dd></div>
            <div><dt className="card-title">Apartment</dt><dd className="card-value" style={{ margin: 0 }}>{details.tower} · {details.unitNumber.toUpperCase()}</dd></div>
            <div><dt className="card-title">Occupancy</dt><dd className="card-value" style={{ margin: 0 }}>{details.occupancy && OCCUPANCY_LABEL[details.occupancy]}</dd></div>
          </dl>
          <p className="subtle" style={{ margin: 0 }}>
            Your request will be reviewed by the administrators of {society.name}. Submitting does not grant access until it is approved.
          </p>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => setStep('details')} disabled={submitting}>Back</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SocietySearch({ selectedId, onSelect }: { selectedId?: string; onSelect: (s: SocietyDetailDto) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SocietySummaryDto[] | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const res = await api.searchSocieties(query.trim());
        if (!cancelled) setResults(res.items);
      } catch (err) {
        if (!cancelled) setError(err as ApiClientError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, attempt]);

  async function choose(id: string) {
    setOpening(id);
    try {
      const { society } = await api.getSociety(id);
      onSelect(society);
    } catch (err) {
      setError(err as ApiClientError);
      setOpening(null);
    }
  }

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="society-search">Search by society name, city or pincode</label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 14, top: 13, color: 'var(--ink-subtle)' }}><Icon name="search" /></span>
          <input
            id="society-search"
            type="search"
            className="input"
            style={{ paddingLeft: 44 }}
            placeholder="e.g. Green Valley, Pune, 411045"
            value={query}
            maxLength={80}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {error && <ErrorState error={error} onRetry={() => setAttempt((a) => a + 1)} />}
      {loading && !results && <Loading label="Searching societies…" />}
      {results && results.length === 0 && !loading && (
        <div className="empty">
          <h3>No societies found</h3>
          <p style={{ margin: 0 }}>Check the spelling or try your city or pincode. If your society is not listed, ask your managing committee to onboard with Krevia.</p>
        </div>
      )}
      {results && results.length > 0 && (
        <ul className="list stack" style={{ gap: 10 }} aria-label="Search results" aria-busy={loading}>
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="result-item"
                aria-pressed={s.id === selectedId}
                onClick={() => choose(s.id)}
                disabled={opening !== null}
              >
                <span>
                  <strong>{s.name}</strong>
                  <span className="subtle" style={{ display: 'block' }}>{s.addressLine}, {s.city}, {s.state} {s.pincode}</span>
                </span>
                {opening === s.id ? <span className="spinner" aria-label="Opening" /> : <Icon name="arrow" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
