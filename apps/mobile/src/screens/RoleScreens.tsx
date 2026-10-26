import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert as NativeAlert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  MODULES,
  OCCUPANCY_LABEL,
  ROLE_NAVIGATION,
  colors,
  type AdminMembershipRequestDto,
  type ApiClientError,
  type MembershipRequestDto,
  type NavItem,
} from '@krevia/shared';
import { Icon } from '../components/Icon';
import {
  ActivityRow,
  AppHeader,
  QuickActionGrid,
  SectionHeader,
  SocietyCard,
  StatTile,
  ToneIcon,
  TowersBanner,
} from '../components/RoleUI';
import { Alert, Badge, Button, Card, EmptyView, ErrorView, LoadingView, Muted, Screen, StatusBadge } from '../components/ui';
import { api } from '../lib/api';
import { hrefFor } from '../lib/nav';
import { useSession } from '../lib/session';
import { useQuery } from '../lib/use-query';

const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

/** Home tab: renders the dashboard of the active role. */
export function HomeScreen() {
  const { role } = useSession();
  if (role === 'ADMIN') return <AdminHome />;
  if (role === 'GUARD') return <GuardHome />;
  return <ResidentHome />;
}

function membershipText(r: MembershipRequestDto) {
  switch (r.status) {
    case 'PENDING':
      return { title: 'Membership request submitted', sub: `Awaiting verification by ${r.society.name}`, icon: 'clock' as const, tone: 'orange' as const };
    case 'APPROVED':
      return { title: 'Your membership request has been approved', sub: `You are now a verified member of ${r.society.name}.`, icon: 'check' as const, tone: 'green' as const };
    case 'REJECTED':
      return { title: 'Membership request not approved', sub: r.reviewNote ?? r.society.name, icon: 'x' as const, tone: 'red' as const };
    default:
      return { title: 'Membership request withdrawn', sub: r.society.name, icon: 'x' as const, tone: 'red' as const };
  }
}

export function ResidentHome() {
  const router = useRouter();
  const { user } = useSession();
  const { data, error, loading, reload } = useQuery(() => api.myMembership());
  const current = data?.current ?? null;

  return (
    <Screen edges={['top']} testID="resident-home">
      <AppHeader role="RESIDENT" />
      <SocietyCard
        title={current?.society.name ?? 'No society yet'}
        subtitle={current ? `${current.unitNumber} · Tower ${current.tower}` : 'Tap to join your society'}
        onPress={() => router.push('/society')}
      />
      <TowersBanner title={`Welcome back,\n${user?.fullName ?? ''}!`} subtitle="A smarter, safer and more connected community" />
      {loading && !data ? (
        <LoadingView label="Loading your membership…" />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : current ? (
        <Pressable onPress={() => router.push('/society')} style={st.statusCard} testID="membership-card" accessibilityRole="button">
          <Icon name="shield" color={colors.forest} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={st.statusTitle} testID="dashboard-society">{current.society.name}</Text>
            <Text style={st.statusSub} testID="dashboard-unit">{current.tower} · {current.unitNumber} ({OCCUPANCY_LABEL[current.occupancy]})</Text>
          </View>
          <StatusBadge status={current.status} />
        </Pressable>
      ) : (
        <Pressable onPress={() => router.push('/join/search')} style={st.hint} accessibilityRole="button" testID="dashboard-join">
          <ToneIcon icon="userPlus" tone="orange" size={36} />
          <View style={{ flex: 1 }}>
            <Text style={st.hintTitle}>You haven&apos;t joined a society yet</Text>
            <Text style={st.hintSub}>Add your flat so your society can verify you.</Text>
          </View>
          <Icon name="chevronRight" color={colors.inkSubtle} size={18} />
        </Pressable>
      )}
      <SectionHeader title="Quick Actions" />
      <QuickActionGrid items={ROLE_NAVIGATION.RESIDENT.quickActions} />
      <SectionHeader title="What's New" />
      <Card style={{ paddingVertical: 4 }}>
        {data && data.history.length > 0 ? (
          data.history.slice(0, 4).map((r) => {
            const t = membershipText(r);
            return <ActivityRow key={r.id} icon={t.icon} tone={t.tone} title={t.title} subtitle={t.sub} meta={timeAgo(r.reviewedAt ?? r.createdAt)} />;
          })
        ) : (
          <Muted style={{ paddingVertical: 12, textAlign: 'center' }}>Society notices and updates will appear here.</Muted>
        )}
      </Card>
    </Screen>
  );
}

export function AdminHome() {
  const router = useRouter();
  const { user } = useSession();
  const society = user?.societyRoles.find((r) => r.role === 'ADMIN');
  const overview = useQuery(() => (society ? api.societyOverview(society.societyId) : Promise.resolve(null)), [society?.societyId]);
  const activity = useQuery(
    () => (society ? api.societyMembershipRequests(society.societyId) : Promise.resolve({ items: [] as AdminMembershipRequestDto[] })),
    [society?.societyId],
  );
  const o = overview.data;

  return (
    <Screen edges={['top']} testID="admin-home">
      <AppHeader role="ADMIN" />
      <SocietyCard title={society?.societyName ?? 'All societies'} subtitle={society ? `${society.city}, ${society.state}` : 'Platform administrator'} />
      <Muted style={{ fontSize: 13 }}>{new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</Muted>
      <SectionHeader title="Society Overview" />
      {overview.error ? (
        <ErrorView error={overview.error} onRetry={overview.reload} />
      ) : (
        <View style={st.statGrid}>
          <StatTile icon="building" tone="green" value={o?.totalUnits ?? '…'} label="Total Units" testID="stat-units" />
          <StatTile icon="users" tone="blue" value={o?.approvedMembers ?? '…'} label="Residents" testID="stat-residents" />
          <StatTile icon="clock" tone="orange" value={o?.pendingRequests ?? '…'} label="Pending Requests" testID="stat-pending" />
          <StatTile icon="file" tone="red" value="—" label="Complaints (soon)" />
        </View>
      )}
      <SectionHeader title="Quick Actions" />
      <QuickActionGrid items={ROLE_NAVIGATION.ADMIN.quickActions} />
      <SectionHeader title="Recent Activity" action="View All" onAction={() => router.push('/requests')} />
      <Card style={{ paddingVertical: 4 }}>
        {activity.loading && !activity.data ? (
          <LoadingView />
        ) : activity.data && activity.data.items.length > 0 ? (
          activity.data.items.slice(0, 4).map((r) => (
            <ActivityRow
              key={r.id}
              icon="userPlus"
              tone={r.status === 'APPROVED' ? 'green' : r.status === 'PENDING' ? 'orange' : 'red'}
              title={r.status === 'PENDING' ? 'New resident request' : `Request ${r.status.toLowerCase()}`}
              subtitle={`${r.tower}-${r.unitNumber} · ${OCCUPANCY_LABEL[r.occupancy]} · ${r.applicant.fullName}`}
              meta={timeAgo(r.reviewedAt ?? r.createdAt)}
            />
          ))
        ) : (
          <Muted style={{ paddingVertical: 12, textAlign: 'center' }}>No resident requests yet.</Muted>
        )}
      </Card>
    </Screen>
  );
}

export function GuardHome() {
  const router = useRouter();
  const { user } = useSession();
  const society = user?.societyRoles.find((r) => r.role === 'GUARD');
  const [tab, setTab] = useState<'Visitors' | 'Delivery' | 'Staff'>('Visitors');
  const open = (key: string) => router.push({ pathname: '/module/[key]', params: { key } });

  return (
    <Screen edges={['top']} testID="guard-home">
      <AppHeader role="GUARD" />
      <SocietyCard title={society?.societyName ?? 'Not assigned to a society'} subtitle={society ? `Security · ${society.city}` : 'Contact your society admin'} live={!!society} />
      <Pressable accessibilityRole="button" accessibilityLabel="Scan QR Code, coming soon" onPress={() => open('scan-qr')} style={st.scanBtn} testID="scan-qr">
        <Icon name="qr" color="#FFFFFF" size={40} />
        <Text style={st.scanText}>Scan QR Code</Text>
        <Text style={st.scanSoon}>Coming soon</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Manual Entry" variant="secondary" onPress={() => open('manual-entry')} style={{ flex: 1 }} />
        <Button title="Pre-Approved" variant="secondary" onPress={() => open('pre-approved')} style={{ flex: 1 }} />
      </View>
      <View style={st.segment} accessibilityRole="tablist">
        {(['Visitors', 'Delivery', 'Staff'] as const).map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} onPress={() => setTab(t)} style={[st.segmentItem, tab === t && st.segmentActive]}>
            <Text style={[st.segmentText, tab === t && { color: '#fff' }]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <EmptyView title={`No ${tab.toLowerCase()} entries`} message="Gate entry logging is planned for an upcoming release. Entries will be listed here as they happen." />
    </Screen>
  );
}

/** Role "More" menu: search + full module list, exactly as in the showcase. */
export function MoreScreen() {
  const router = useRouter();
  const { role, logout } = useSession();
  const [q, setQ] = useState('');
  const items = ROLE_NAVIGATION[role].more.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const placeholder = role === 'ADMIN' ? 'Search admin features…' : role === 'GUARD' ? 'Search guard features…' : 'Search services…';

  return (
    <Screen edges={['top']} testID="more-screen">
      <AppHeader role={role} />
      <View style={st.search}>
        <Icon name="search" color={colors.inkSubtle} size={18} />
        <TextInput placeholder={placeholder} placeholderTextColor={colors.inkSubtle} value={q} onChangeText={setQ} style={st.searchInput} accessibilityLabel="Search features" testID="more-search" />
      </View>
      <Card style={{ paddingVertical: 4, paddingHorizontal: 8 }}>
        {items.map((item) => (
          <MenuRow key={`${item.key}-${item.label}`} item={item} onPress={() => router.push(hrefFor(item))} />
        ))}
        {role === 'GUARD' && (
          <Pressable accessibilityRole="button" onPress={async () => { await logout(); router.replace('/welcome'); }} style={st.menuRow}>
            <Icon name="logout" color={colors.danger} />
            <Text style={[st.menuText, { color: colors.danger }]}>Logout</Text>
          </Pressable>
        )}
        {items.length === 0 && <Muted style={{ padding: 12 }}>No matching features.</Muted>}
      </Card>
    </Screen>
  );
}

function MenuRow({ item, onPress }: { item: NavItem; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={item.label} onPress={onPress} style={({ pressed }) => [st.menuRow, pressed && { backgroundColor: colors.mint }]} testID={`menu-${item.key}`}>
      <Icon name={item.icon} color={colors.forest} />
      <Text style={st.menuText}>{item.label}</Text>
      {!item.screen && <Badge label="Soon" />}
      <Icon name="chevronRight" color={colors.inkSubtle} size={18} />
    </Pressable>
  );
}

/** Resident household: own directory record and the people in the same flat. */
export function HouseholdScreen() {
  const membership = useQuery(() => api.myMembership());
  const societyId = membership.data?.current?.society.id;
  const household = useQuery(
    () => (societyId ? api.myHousehold(societyId) : Promise.resolve(null)),
    [societyId],
  );
  const data = household.data;

  return (
    <Screen edges={['bottom']} testID="household-screen">
      <SectionHeader title="My Household" />
      {membership.loading || household.loading ? (
        <LoadingView label="Loading your household…" />
      ) : membership.error ? (
        <ErrorView error={membership.error} onRetry={membership.reload} />
      ) : household.error ? (
        <ErrorView error={household.error} onRetry={household.reload} />
      ) : !societyId ? (
        <EmptyView title="No society yet" message="Join a society to see the people recorded in your flat." />
      ) : !data?.resident ? (
        <EmptyView title="No directory record" message="Your society has not added you to its resident directory yet. Ask your administrator." />
      ) : (
        <>
          <Card style={{ gap: 8 }}>
            <Text style={st.statusTitle}>{data.resident.fullName}</Text>
            <Muted style={{ fontSize: 13 }}>{data.resident.phone ?? 'No mobile number'} · {data.resident.email ?? 'No email'}</Muted>
            <Muted style={{ fontSize: 13 }}>{data.resident.status === 'ACTIVE' ? 'Active resident' : 'Inactive resident'}</Muted>
          </Card>
          {data.units.length === 0 ? (
            <EmptyView title="No unit linked" message="Your record is not linked to an active unit yet." />
          ) : (
            data.units.map((entry) => (
              <Card key={entry.unit.id} style={{ gap: 8 }} testID={`household-unit-${entry.unit.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={st.statusTitle}>{entry.unit.tower}-{entry.unit.number}</Text>
                  <Badge label={`${OCCUPANCY_LABEL[entry.relationship]}${entry.isPrimary ? ' · Primary' : ''}`} />
                </View>
                <Muted style={{ fontSize: 13 }}>{entry.unit.floorLevel === null ? 'Floor not recorded' : `Floor ${entry.unit.floorLevel}`}</Muted>
                <Text style={st.householdHead}>People in this flat</Text>
                {entry.household.length === 0 ? (
                  <Muted style={{ fontSize: 13 }}>No other household members are recorded.</Muted>
                ) : (
                  entry.household.map((person) => (
                    <View key={person.id} style={st.householdRow}>
                      <Text style={st.householdName}>{person.fullName}</Text>
                      <Muted style={{ fontSize: 12 }}>{OCCUPANCY_LABEL[person.relationship]} · {person.maskedPhone ?? 'No mobile'}</Muted>
                    </View>
                  ))
                )}
                <Muted style={{ fontSize: 12 }}>Mobile numbers are masked. Contact your administrator for the full number.</Muted>
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

export function ComingSoonView({ item }: { item: NavItem | undefined }) {
  const router = useRouter();
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingTop: 24 }} testID="coming-soon">
      <ToneIcon icon={item?.icon ?? 'grid'} tone={item?.tone ?? 'green'} size={72} />
      <Badge label="Coming soon" />
      <Text style={st.soonTitle}>{item?.label ?? 'This feature'}</Text>
      <Muted style={{ textAlign: 'center' }}>{item?.description ?? 'This module is planned for an upcoming release.'}</Muted>
      <Muted style={{ textAlign: 'center', fontSize: 13 }}>Planned for an upcoming Krevia release. Nothing here is live yet.</Muted>
      <Button title="Back to home" variant="secondary" onPress={() => router.replace('/(app)/(tabs)')} />
    </View>
  );
}

/** /module/[key] stack screen. */
export function ModuleScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  return (
    <Screen edges={['bottom']}>
      <ComingSoonView item={MODULES[String(key)]} />
    </Screen>
  );
}

/** Second / fourth bottom-tab slot: content depends on the active role. */
export function TabSlotScreen({ slot }: { slot: 'second' | 'fourth' }) {
  const { role } = useSession();
  const item = ROLE_NAVIGATION[role].tabs[slot];
  if (item.screen === 'requests') return <AdminRequestsScreen />;
  return (
    <Screen edges={['top']}>
      <AppHeader role={role} />
      <ComingSoonView item={item} />
    </Screen>
  );
}

/** Admin approvals: real data — approve or reject pending resident requests. */
export function AdminRequestsScreen({ inStack = false }: { inStack?: boolean }) {
  const { user } = useSession();
  const society = user?.societyRoles.find((r) => r.role === 'ADMIN');
  const { data, error, loading, reload, setData } = useQuery(
    () => (society ? api.societyMembershipRequests(society.societyId, 'PENDING') : Promise.resolve({ items: [] as AdminMembershipRequestDto[] })),
    [society?.societyId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function review(r: AdminMembershipRequestDto, action: 'approve' | 'reject') {
    setBusy(r.id);
    setMessage(null);
    try {
      if (action === 'approve') await api.approveMembershipRequest(r.id);
      else await api.rejectMembershipRequest(r.id);
      setData((d) => d && { items: d.items.filter((i) => i.id !== r.id) });
      setMessage({ tone: 'success', text: `${r.applicant.fullName}'s request was ${action === 'approve' ? 'approved' : 'rejected'}.` });
    } catch (err) {
      setMessage({ tone: 'error', text: (err as ApiClientError).message });
    } finally {
      setBusy(null);
    }
  }

  const confirm = (r: AdminMembershipRequestDto, action: 'approve' | 'reject') =>
    NativeAlert.alert(action === 'approve' ? 'Approve resident?' : 'Reject request?', `${r.applicant.fullName} · ${r.tower}-${r.unitNumber}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action === 'approve' ? 'Approve' : 'Reject', style: action === 'approve' ? 'default' : 'destructive', onPress: () => void review(r, action) },
    ]);

  return (
    <Screen edges={inStack ? ['bottom'] : ['top']} testID="admin-requests">
      {!inStack && <AppHeader role="ADMIN" />}
      <SectionHeader title="Pending Approvals" />
      {society && <Muted style={{ fontSize: 13 }}>{society.societyName}</Muted>}
      <Alert message={message?.text} tone={message?.tone} />
      {loading && !data ? (
        <LoadingView />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : data && data.items.length > 0 ? (
        data.items.map((r) => (
          <Card key={r.id} style={{ gap: 10 }} testID="admin-request">
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={st.statusTitle}>{r.applicant.fullName}</Text>
              <StatusBadge status={r.status} />
            </View>
            <Muted style={{ fontSize: 13 }}>{r.tower}-{r.unitNumber} · {OCCUPANCY_LABEL[r.occupancy]} · {r.applicant.phone}</Muted>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button title="Approve" onPress={() => confirm(r, 'approve')} loading={busy === r.id} disabled={busy !== null} style={{ flex: 1 }} testID={`approve-${r.id}`} />
              <Button title="Reject" variant="danger" onPress={() => confirm(r, 'reject')} disabled={busy !== null} style={{ flex: 1 }} />
            </View>
          </Card>
        ))
      ) : (
        <EmptyView title="All caught up" message="There are no pending resident requests." />
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statusTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  statusSub: { fontSize: 13, color: colors.inkMuted },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  hintTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  hintSub: { fontSize: 12, color: colors.inkSubtle },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scanBtn: { backgroundColor: colors.forest, borderRadius: 18, paddingVertical: 26, alignItems: 'center', gap: 8 },
  scanText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scanSoon: { color: '#CDE5D6', fontSize: 12 },
  segment: { flexDirection: 'row', gap: 8 },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  segmentActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  segmentText: { fontWeight: '600', color: colors.inkMuted },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 46, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: 8, borderRadius: 10 },
  menuText: { flex: 1, fontSize: 15, color: colors.ink },
  householdHead: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 4 },
  householdRow: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  householdName: { fontSize: 14, fontWeight: '600', color: colors.ink },
  soonTitle: { fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'center' },
});
