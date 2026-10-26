import { useState } from 'react';
import { Alert as NativeAlert, StyleSheet, Text, View } from 'react-native';
import {
  VISITOR_CATEGORY_LABEL,
  VISITOR_STATUS_LABEL,
  colors,
  type ApiClientError,
  type VisitorDto,
  type VisitorStatus,
} from '@krevia/shared';
import { SectionHeader } from '../components/RoleUI';
import { Alert, Button, Card, EmptyView, ErrorView, LoadingView, Muted, Screen } from '../components/ui';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { useQuery } from '../lib/use-query';

const BADGE: Record<VisitorStatus, { bg: string; fg: string }> = {
  PENDING: { bg: colors.warningSoft, fg: colors.warning },
  APPROVED: { bg: colors.successSoft, fg: colors.success },
  REJECTED: { bg: colors.dangerSoft, fg: colors.danger },
  TIMED_OUT: { bg: '#EEF1EF', fg: colors.warning },
  CANCELLED: { bg: '#EEF1EF', fg: colors.inkMuted },
  ENTERED: { bg: colors.infoSoft, fg: colors.info },
  EXITED: { bg: '#EEF1EF', fg: colors.inkMuted },
};

function VisitorBadge({ status }: { status: VisitorStatus }) {
  const c = BADGE[status];
  return (
    <View style={[st.badge, { backgroundColor: c.bg }]} testID="visitor-status">
      <Text style={[st.badgeText, { color: c.fg }]}>{VISITOR_STATUS_LABEL[status]}</Text>
    </View>
  );
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function VisitorRow({
  visitor,
  canDecide,
  busy,
  onApprove,
  onReject,
}: {
  visitor: VisitorDto;
  canDecide?: boolean;
  busy: string | null;
  onApprove: (v: VisitorDto) => void;
  onReject: (v: VisitorDto) => void;
}) {
  const v = visitor;
  return (
    <Card style={{ gap: 6 }} testID={`visitor-${v.id}`}>
      <View style={st.row}>
        <Text style={st.name}>{v.name}</Text>
        <VisitorBadge status={v.status} />
      </View>
      <Muted style={{ fontSize: 13 }}>
        {VISITOR_CATEGORY_LABEL[v.category]} · {v.unit.tower}-{v.unit.number} · {v.purpose}
      </Muted>
      <Muted style={{ fontSize: 12 }}>
        {v.phone ?? 'No mobile recorded'} · registered {when(v.createdAt)}
      </Muted>
      {v.decidedAt ? (
        <Muted style={{ fontSize: 12 }}>
          {v.status === 'REJECTED' ? 'Rejected' : 'Approved'} · {when(v.decidedAt)}
          {v.decisionNote ? ` · ${v.decisionNote}` : ''}
        </Muted>
      ) : null}
      {v.entryAt ? (
        <Muted style={{ fontSize: 12 }}>
          Entered {when(v.entryAt)}{v.entryMethod === 'OVERRIDE' ? ' · emergency override' : ''}
        </Muted>
      ) : null}
      {v.exitAt ? <Muted style={{ fontSize: 12 }}>Exited {when(v.exitAt)}</Muted> : null}
      {v.cancelledAt ? <Muted style={{ fontSize: 12 }}>Cancelled {when(v.cancelledAt)}</Muted> : null}
      {canDecide && v.status === 'PENDING' ? (
        <View style={st.actions}>
          <Button title="Approve" onPress={() => onApprove(v)} loading={busy === v.id} testID={`approve-${v.id}`} />
          <Button title="Reject" variant="danger" onPress={() => onReject(v)} disabled={busy === v.id} testID={`reject-${v.id}`} />
        </View>
      ) : null}
    </Card>
  );
}

/** Resident approval and status for the caller's own flat. */
export function ResidentVisitorsScreen() {
  const { user } = useSession();
  const membership = useQuery(() => api.myMembership());
  // Invited residents hold an ACTIVE membership without a join request, so fall back to it.
  const societyId =
    membership.data?.current?.society.id ??
    user?.memberships.find((m) => m.role === 'RESIDENT' && m.status === 'ACTIVE')?.societyId;
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const pending = useQuery(
    () => (societyId ? api.listVisitors(societyId, { status: 'PENDING', pageSize: 50 }) : Promise.resolve({ items: [] as VisitorDto[] })),
    [societyId, version],
  );
  const history = useQuery(
    () => (societyId ? api.listVisitors(societyId, { pageSize: 20 }) : Promise.resolve({ items: [] as VisitorDto[] })),
    [societyId, version],
  );

  async function decide(visitor: VisitorDto, approve: boolean) {
    if (!societyId) return;
    setBusy(visitor.id);
    setMessage(null);
    try {
      if (approve) {
        await api.approveVisitor(societyId, visitor.id);
      } else {
        await api.rejectVisitor(societyId, visitor.id);
      }
      setMessage({ tone: 'success', text: approve ? `${visitor.name} approved for entry.` : `${visitor.name} rejected.` });
      setVersion((n) => n + 1);
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  function confirm(visitor: VisitorDto, approve: boolean) {
    NativeAlert.alert(
      approve ? 'Approve visitor?' : 'Reject visitor?',
      `${visitor.name} (${VISITOR_CATEGORY_LABEL[visitor.category]}) is at the gate for ${visitor.unit.tower}-${visitor.unit.number}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: approve ? 'Approve' : 'Reject', style: approve ? 'default' : 'destructive', onPress: () => void decide(visitor, approve) },
      ],
    );
  }

  return (
    <Screen edges={['bottom']} testID="visitor-screen">
      <SectionHeader title="Visitors" />
      {membership.loading ? (
        <LoadingView label="Loading your flat…" />
      ) : membership.error ? (
        <ErrorView error={membership.error} onRetry={membership.reload} />
      ) : !societyId ? (
        <EmptyView title="No society yet" message="Join a society to approve visitors for your flat." />
      ) : (
        <>
          <Alert message={message?.text} tone={message?.tone} />
          <Text style={st.section}>Waiting for your decision</Text>
          {pending.loading ? (
            <LoadingView label="Loading pending visitors…" />
          ) : pending.error ? (
            <ErrorView error={pending.error} onRetry={pending.reload} />
          ) : !pending.data?.items.length ? (
            <EmptyView title="No visitors waiting" message="When a guard registers a visitor for your flat, they appear here for approval." />
          ) : (
            pending.data.items.map((v) => (
              <VisitorRow key={v.id} visitor={v} canDecide busy={busy} onApprove={(x) => confirm(x, true)} onReject={(x) => confirm(x, false)} />
            ))
          )}

          <Text style={st.section}>Recent visitors</Text>
          {history.loading ? (
            <LoadingView label="Loading visitor history…" />
          ) : history.error ? (
            <ErrorView error={history.error} onRetry={history.reload} />
          ) : !history.data?.items.length ? (
            <EmptyView title="No visitors yet" message="Visitors recorded for your flat will appear here." />
          ) : (
            history.data.items.map((v) => (
              <VisitorRow key={v.id} visitor={v} busy={busy} onApprove={(x) => confirm(x, true)} onReject={(x) => confirm(x, false)} />
            ))
          )}
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '700', color: colors.ink, flex: 1 },
  section: { fontSize: 17, fontWeight: '700', color: colors.ink, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
});
