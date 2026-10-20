import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BRAND, ROLE_LABEL, colors, fieldErrors, updateProfileSchema, type ApiClientError } from '@krevia/shared';
import { Alert, Button, Card, H1, Muted, Screen, TextField } from '../components/ui';
import { api } from '../lib/api';
import { API_URL } from '../lib/config';
import { useSession } from '../lib/session';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export function ProfileScreen() {
  const { user, setUser } = useSession();
  const [values, setValues] = useState({ fullName: user?.fullName ?? '', email: user?.email ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  if (!user) return null;
  const dirty = values.fullName !== user.fullName || values.email !== (user.email ?? '');

  async function save() {
    setMessage(null);
    const parsed = updateProfileSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    setSaving(true);
    try {
      const res = await api.updateProfile(values);
      setUser(res.user);
      setValues({ fullName: res.user.fullName, email: res.user.email ?? '' });
      setMessage({ tone: 'success', text: 'Profile updated.' });
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setMessage({ tone: 'error', text: e.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen edges={['bottom']} testID="profile-screen">
      <Card style={{ alignItems: 'center', gap: 6 }}>
        <View style={h.avatar}><Text style={h.avatarText}>{initials(user.fullName)}</Text></View>
        <Text style={h.value}>{user.fullName}</Text>
        <Muted>{user.phone}</Muted>
      </Card>
      <Alert message={message?.text} tone={message?.tone} />
      <TextField label="Full name" value={values.fullName} onChangeText={(fullName) => setValues({ ...values, fullName })} error={errors.fullName} testID="profile-name" />
      <TextField label="Email (optional)" keyboardType="email-address" autoCapitalize="none" value={values.email} onChangeText={(email) => setValues({ ...values, email })} error={errors.email} testID="profile-email" />
      <TextField label="Mobile number" value={user.phone} editable={false} hint="Your mobile number is your sign-in ID and cannot be changed yet." />
      <Button title="Save changes" onPress={save} loading={saving} disabled={!dirty} testID="save-profile" />
    </Screen>
  );
}

export function SettingsScreen() {
  const { logout, role, roles, setRole } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Screen edges={['bottom']} testID="settings-screen">
      <H1>Settings</H1>
      {roles.length > 1 && (
        <Card style={{ gap: 10 }} testID="role-switcher">
          <Text style={h.label}>Dashboard view</Text>
          <Muted style={{ fontSize: 13 }}>Your account has more than one role. Choose which experience to use.</Muted>
          {roles.map((r) => (
            <Button
              key={r}
              title={ROLE_LABEL[r]}
              variant={r === role ? 'primary' : 'secondary'}
              onPress={() => {
                setRole(r);
                router.replace('/(app)/(tabs)');
              }}
              testID={`role-${r}`}
            />
          ))}
        </Card>
      )}
      <Card style={{ gap: 8 }}>
        <Text style={h.label}>App</Text>
        <Text style={h.value}>{BRAND.name} {Constants.expoConfig?.version ?? ''}</Text>
        <Muted style={{ fontSize: 13 }}>{BRAND.tagline}</Muted>
        <Text style={[h.label, { marginTop: 8 }]}>Server</Text>
        <Muted style={{ fontSize: 13 }}>{API_URL}</Muted>
      </Card>
      <Card style={{ gap: 12 }}>
        <Muted>Signing out ends this session on the server and removes it from this device.</Muted>
        <Button
          title="Logout"
          variant="danger"
          loading={busy}
          testID="logout"
          onPress={async () => {
            setBusy(true);
            await logout();
            router.replace('/welcome');
          }}
        />
      </Card>
    </Screen>
  );
}

const h = StyleSheet.create({
  welcome: { backgroundColor: colors.mint, borderRadius: 20, padding: 20, gap: 6 },
  welcomeTitle: { fontSize: 24, fontWeight: '800', color: colors.ink },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  label: { fontSize: 12, color: colors.inkSubtle },
  value: { fontSize: 16, fontWeight: '700', color: colors.ink },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  module: { width: '47%', gap: 8, padding: 14 },
  moduleTitle: { fontWeight: '600', color: colors.ink },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 24, fontWeight: '700' },
});
