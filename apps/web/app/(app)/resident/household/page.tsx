'use client';

import { OCCUPANCY_LABEL } from '@krevia/shared';
import { ErrorState, Loading } from '@/components/States';
import { api } from '@/lib/api';
import { useApi } from '@/lib/use-api';

/** A resident's own flat and the people recorded with them. */
export default function HouseholdPage() {
  const membership = useApi(() => api.myMembership(), []);
  const societyId = membership.data?.current?.society.id;
  const household = useApi(() => (societyId ? api.myHousehold(societyId) : Promise.resolve(null)), [societyId]);

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.6rem', margin: 0 }}>My household</h1>
        <p className="muted" style={{ margin: '6px 0 0' }}>The people your society has recorded in your flat. Contact your administrator to correct a detail.</p>
      </div>
      {membership.loading || household.loading ? (
        <Loading label="Loading your household…" />
      ) : membership.error ? (
        <ErrorState error={membership.error} onRetry={membership.reload} />
      ) : household.error ? (
        <ErrorState error={household.error} onRetry={household.reload} />
      ) : !societyId ? (
        <div className="card empty"><p style={{ margin: 0 }}>Join a society to see your household.</p></div>
      ) : !household.data?.resident ? (
        <div className="card empty">
          <h3>No directory record yet</h3>
          <p style={{ margin: 0 }}>Your society has not added you to its resident directory. Ask your administrator to add you.</p>
        </div>
      ) : (
        <>
          <section className="card stack" aria-labelledby="my-details">
            <h2 id="my-details">My details</h2>
            <div className="grid grid-2">
              <div><span className="subtle">Name</span><div><strong>{household.data.resident.fullName}</strong></div></div>
              <div><span className="subtle">Mobile</span><div>{household.data.resident.phone ?? '—'}</div></div>
              <div><span className="subtle">Email</span><div>{household.data.resident.email ?? '—'}</div></div>
              <div><span className="subtle">Status</span><div>{household.data.resident.status === 'ACTIVE' ? 'Active' : 'Inactive'}</div></div>
            </div>
          </section>
          {household.data.units.length === 0 ? (
            <div className="card empty"><p style={{ margin: 0 }}>No active unit is linked to your record.</p></div>
          ) : (
            household.data.units.map((entry) => (
              <section key={entry.unit.id} className="card stack" aria-labelledby={`unit-${entry.unit.id}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 id={`unit-${entry.unit.id}`} style={{ margin: 0 }}>{entry.unit.tower}-{entry.unit.number}</h2>
                  <span className="badge badge-active">{OCCUPANCY_LABEL[entry.relationship]}{entry.isPrimary ? ' · Primary' : ''}</span>
                </div>
                <div className="subtle">{entry.unit.floorLevel === null ? 'Floor not recorded' : `Floor ${entry.unit.floorLevel}`}</div>
                <h3 style={{ marginBottom: 0 }}>People in this flat</h3>
                {entry.household.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>No other household members are recorded.</p>
                ) : (
                  <ul className="list">
                    {entry.household.map((person) => (
                      <li key={person.id} className="list-item">
                        <span><strong>{person.fullName}</strong> · {OCCUPANCY_LABEL[person.relationship]}</span>
                        <span className="subtle">{person.maskedPhone ?? 'No mobile recorded'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="subtle" style={{ margin: 0 }}>Mobile numbers are masked. Ask your administrator if you need the full contact.</p>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
