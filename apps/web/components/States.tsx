import type { ApiClientError, MembershipStatus } from '@krevia/shared';
import { MEMBERSHIP_STATUS_LABEL } from '@krevia/shared';

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row" role="status" aria-live="polite" style={{ padding: 20 }}>
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiClientError; onRetry?: () => void }) {
  return (
    <div className="alert alert-error row" role="alert" style={{ justifyContent: 'space-between' }}>
      <span>{error.message}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-danger" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: MembershipStatus }) {
  return (
    <span className={`badge badge-${status}`} data-testid="membership-status">
      {MEMBERSHIP_STATUS_LABEL[status]}
    </span>
  );
}
