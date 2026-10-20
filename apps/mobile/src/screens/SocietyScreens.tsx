import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert as NativeAlert, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ApiClientError,
  OCCUPANCY_LABEL,
  colors,
  createMembershipRequestSchema,
  fieldErrors,
  type MembershipRequestDto,
  type OccupancyType,
  type SocietySummaryDto,
} from '@krevia/shared';
import { Icon } from '../components/Icon';
import { Alert, Button, Card, EmptyView, ErrorView, H1, H2, LoadingView, Muted, Screen, StatusBadge, TextField } from '../components/ui';
import { api } from '../lib/api';
import { useQuery } from '../lib/use-query';

/** Membership status tab: shows the current request, or a call to action to join. */
export function MembershipStatusScreen() {
  const router = useRouter();
  const { data, error, loading, reload } = useQuery(() => api.myMembership());
  const [withdrawing, setWithdrawing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const current = data?.current ?? null;

  function withdraw(request: MembershipRequestDto) {
    NativeAlert.alert('Withdraw request?', `Your request to join ${request.society.name} will be withdrawn.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setWithdrawing(true);
          setActionError(null);
          try {
            await api.cancelMembershipRequest(request.id);
            await reload();
          } catch (err) {
            setActionError((err as ApiClientError).message);
          } finally {
            setWithdrawing(false);
          }
        },
      },
    ]);
  }

  return (
    <Screen edges={['bottom']} testID="status-screen">
      <H1>My society</H1>
      {loading && !data ? (
        <LoadingView label="Loading your membership…" />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : current ? (
        <Card style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H2>Membership request</H2>
            <StatusBadge status={current.status} />
          </View>
          <Alert message={actionError} />
          <InfoRow label="Society" value={current.society.name} sub={`${current.society.addressLine}, ${current.society.city}`} testID="status-society" />
          <InfoRow label="Apartment" value={`${current.tower} · ${current.unitNumber}`} sub={OCCUPANCY_LABEL[current.occupancy]} testID="status-unit" />
          {current.status === 'PENDING' ? (
            <>
              <Alert tone="info" message={`Your request has been sent to ${current.society.name}. A society administrator will verify your details.`} />
              <Button title="Refresh status" variant="secondary" onPress={reload} loading={loading} testID="refresh-status" />
              <Button title="Withdraw request" variant="danger" onPress={() => withdraw(current)} loading={withdrawing} />
            </>
          ) : (
            <Alert tone="success" message={`You are a verified member of ${current.society.name}.`} />
          )}
        </Card>
      ) : (
        <EmptyView
          title="You haven't joined a society yet"
          message="Find your society and submit your apartment details. Your society administrator will verify your request."
          action={<Button title="Join your society" onPress={() => router.push('/join/search')} testID="start-join" />}
        />
      )}
    </Screen>
  );
}

function InfoRow({ label, value, sub, testID }: { label: string; value: string; sub?: string; testID?: string }) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value} testID={testID}>{value}</Text>
      {sub ? <Muted style={{ fontSize: 13 }}>{sub}</Muted> : null}
    </View>
  );
}

export function SocietySearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SocietySummaryDto[] | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(false);
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
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, attempt]);

  return (
    <Screen edges={['bottom']} testID="search-screen">
      <Muted>Step 1 of 3 · Find your society</Muted>
      <TextField
        label="Search by society name, city or pincode"
        placeholder="e.g. Green Valley, Pune, 411045"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        returnKeyType="search"
        maxLength={80}
        testID="society-search"
      />
      {error ? (
        <ErrorView error={error} onRetry={() => setAttempt((a) => a + 1)} />
      ) : loading && !results ? (
        <LoadingView label="Searching societies…" />
      ) : results && results.length === 0 ? (
        <EmptyView title="No societies found" message="Check the spelling or try your city or pincode. If your society is not listed, ask your managing committee to onboard with Krevia." />
      ) : (
        <View style={{ gap: 10 }}>
          {results?.map((society) => (
            <Pressable
              key={society.id}
              accessibilityRole="button"
              accessibilityLabel={`${society.name}, ${society.city}`}
              onPress={() => router.push({ pathname: '/join/[societyId]', params: { societyId: society.id } })}
              style={({ pressed }) => [s.result, pressed && { backgroundColor: colors.mint }]}
              testID={`society-${society.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.value}>{society.name}</Text>
                <Muted style={{ fontSize: 13 }}>{society.addressLine}, {society.city}, {society.state} {society.pincode}</Muted>
              </View>
              <Icon name="arrow" color={colors.forest} />
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}

/** Society selection confirmation + apartment / unit details. */
export function SocietyDetailsScreen() {
  const router = useRouter();
  const { societyId } = useLocalSearchParams<{ societyId: string }>();
  const { data, error, loading, reload } = useQuery(() => api.getSociety(String(societyId)), [societyId]);
  const [tower, setTower] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [occupancy, setOccupancy] = useState<OccupancyType | ''>('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (loading) return <Screen edges={['bottom']}><LoadingView /></Screen>;
  if (error || !data) return <Screen edges={['bottom']}>{error && <ErrorView error={error} onRetry={reload} />}</Screen>;
  const society = data.society;

  function next() {
    const parsed = createMembershipRequestSchema.safeParse({ societyId: society.id, tower, unitNumber, occupancy });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    router.push({
      pathname: '/join/review',
      params: { societyId: society.id, societyName: society.name, tower, unitNumber: parsed.data.unitNumber, occupancy: parsed.data.occupancy },
    });
  }

  return (
    <Screen edges={['bottom']} testID="details-screen">
      <Muted>Step 2 of 3 · Apartment details</Muted>
      <Card tone="mint">
        <Text style={s.label}>Selected society</Text>
        <Text style={s.value} testID="selected-society">{society.name}</Text>
        <Muted style={{ fontSize: 13 }}>{society.addressLine}, {society.city} {society.pincode}</Muted>
      </Card>
      <View style={{ gap: 8 }}>
        <Text style={s.fieldLabel}>Tower / block</Text>
        <View style={s.chips} accessibilityRole="radiogroup">
          {society.towers.map((t) => (
            <Chip key={t} label={t} selected={tower === t} onPress={() => setTower(t)} />
          ))}
        </View>
        {errors.tower && <Text style={s.error} accessibilityRole="alert">{errors.tower}</Text>}
      </View>
      <TextField label="Flat / unit number" placeholder="e.g. 1203" autoCapitalize="characters" autoCorrect={false} value={unitNumber} onChangeText={setUnitNumber} error={errors.unitNumber} testID="unitNumber" />
      <View style={{ gap: 8 }}>
        <Text style={s.fieldLabel}>You are the</Text>
        <View style={s.chips} accessibilityRole="radiogroup">
          {(['OWNER', 'TENANT'] as const).map((o) => (
            <Chip key={o} label={OCCUPANCY_LABEL[o]} selected={occupancy === o} onPress={() => setOccupancy(o)} wide />
          ))}
        </View>
        {errors.occupancy && <Text style={s.error} accessibilityRole="alert">{errors.occupancy}</Text>}
      </View>
      <Button title="Continue" onPress={next} testID="continue" />
    </Screen>
  );
}

function Chip({ label, selected, onPress, wide }: { label: string; selected: boolean; onPress: () => void; wide?: boolean }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[s.chip, wide && { flex: 1 }, selected && s.chipSelected]}
    >
      <Text style={[s.chipText, selected && { color: colors.forest }]}>{label}</Text>
    </Pressable>
  );
}

/** Review and submit the membership request. */
export function ReviewScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ societyId: string; societyName: string; tower: string; unitNumber: string; occupancy: OccupancyType }>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api.createMembershipRequest({
        societyId: params.societyId,
        tower: params.tower,
        unitNumber: params.unitNumber,
        occupancy: params.occupancy,
      });
      router.dismissAll?.();
      router.replace('/society');
    } catch (err) {
      setError((err as ApiClientError).message);
      setSubmitting(false);
    }
  }

  return (
    <Screen edges={['bottom']} testID="review-screen">
      <Muted>Step 3 of 3 · Review & submit</Muted>
      <Card style={{ gap: 12 }}>
        <InfoRow label="Society" value={params.societyName} />
        <InfoRow label="Apartment" value={`${params.tower} · ${params.unitNumber}`} />
        <InfoRow label="Occupancy" value={OCCUPANCY_LABEL[params.occupancy] ?? ''} />
      </Card>
      <Muted>Your request will be reviewed by the administrators of {params.societyName}. Submitting does not grant access until it is approved.</Muted>
      <Alert message={error} />
      <Button title="Submit request" onPress={submit} loading={submitting} testID="submit-request" />
    </Screen>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12, color: colors.inkSubtle },
  value: { fontSize: 16, fontWeight: '700', color: colors.ink },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: colors.ink },
  error: { color: colors.danger, fontSize: 13 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { minHeight: 44, minWidth: 64, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipSelected: { borderColor: colors.forest, backgroundColor: colors.mint },
  chipText: { fontWeight: '600', color: colors.inkMuted },
});
