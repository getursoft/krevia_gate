import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type TextInput } from 'react-native';
import { BRAND, colors, fieldErrors, loginSchema, registerSchema, type ApiClientError } from '@krevia/shared';
import { KreviaMark, Logo } from '../components/Logo';
import { Alert, Button, H1, Muted, Screen, TextField } from '../components/ui';
import { useSession } from '../lib/session';

export function WelcomeScreen() {
  const router = useRouter();
  return (
    <Screen testID="welcome-screen">
      <View style={{ flex: 1, justifyContent: 'center', gap: 28 }}>
        <Logo size={56} />
        <View style={{ gap: 10 }}>
          <Text style={welcome.tagline} testID="tagline">{BRAND.tagline}</Text>
          <H1>Your society, verified and connected.</H1>
          <Muted>
            Join your residential society on {BRAND.name}: find your society, add your flat details and get verified by your
            managing committee.
          </Muted>
        </View>
        <View style={{ gap: 12 }}>
          {['Find your society by name, city or pincode', 'Add your tower and flat number', 'Track verification status'].map((t, i) => (
            <View key={t} style={welcome.step}>
              <Text style={welcome.stepNo}>{i + 1}</Text>
              <Text style={{ color: colors.ink, flex: 1 }}>{t}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 12 }}>
        <Button title="Create account" onPress={() => router.push('/register')} testID="go-register" />
        <Button title="Sign in" variant="secondary" onPress={() => router.push('/login')} testID="go-login" />
      </View>
    </Screen>
  );
}

const welcome = StyleSheet.create({
  tagline: { color: colors.leaf, fontWeight: '700', fontSize: 15 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.mint, padding: 12, borderRadius: 12 },
  stepNo: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.forest, color: '#fff', textAlign: 'center', lineHeight: 28, fontWeight: '700', overflow: 'hidden' },
});

function useFormSubmit() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  async function run(action: () => Promise<void>) {
    setFormError(null);
    setSubmitting(true);
    try {
      await action();
    } catch (err) {
      const e = err as ApiClientError;
      if (e.details) setErrors(e.details);
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }
  return { errors, setErrors, formError, submitting, run };
}

export function LoginScreen() {
  const router = useRouter();
  const { login } = useSession();
  const [values, setValues] = useState({ phone: '', password: '' });
  const { errors, setErrors, formError, submitting, run } = useFormSubmit();
  const passwordRef = useRef<React.ElementRef<typeof TextInput>>(null);

  function submit() {
    const parsed = loginSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      await login(values);
      router.replace('/');
    });
  }

  return (
    <Screen testID="login-screen">
      <KreviaMark size={56} />
      <View>
        <H1>Welcome back</H1>
        <Muted>Sign in to {BRAND.name} with your mobile number.</Muted>
      </View>
      <Alert message={formError} />
      <TextField
        label="Mobile number"
        prefix="+91"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        returnKeyType="next"
        maxLength={16}
        value={values.phone}
        onChangeText={(phone) => setValues({ ...values, phone })}
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={errors.phone}
        testID="phone"
      />
      <TextField
        ref={passwordRef}
        label="Password"
        secureTextEntry
        textContentType="password"
        autoComplete="password"
        returnKeyType="go"
        value={values.password}
        onChangeText={(password) => setValues({ ...values, password })}
        onSubmitEditing={submit}
        error={errors.password}
        testID="password"
      />
      <Button title="Sign in" onPress={submit} loading={submitting} testID="submit-login" />
      <Pressable accessibilityRole="link" onPress={() => router.replace('/register')} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ textAlign: 'center', color: colors.forest, fontWeight: '600' }}>New to {BRAND.name}? Create an account</Text>
      </Pressable>
    </Screen>
  );
}

export function RegisterScreen() {
  const router = useRouter();
  const { register } = useSession();
  const [values, setValues] = useState({ fullName: '', phone: '', email: '', password: '' });
  const { errors, setErrors, formError, submitting, run } = useFormSubmit();
  const set = (key: keyof typeof values) => (text: string) => setValues({ ...values, [key]: text });

  function submit() {
    const parsed = registerSchema.safeParse(values);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    void run(async () => {
      await register(values);
      router.replace('/join/search');
    });
  }

  return (
    <Screen testID="register-screen">
      <KreviaMark size={56} />
      <View>
        <H1>Create your account</H1>
        <Muted>Join your society on {BRAND.name}.</Muted>
      </View>
      <Alert message={formError} />
      <TextField label="Full name" textContentType="name" autoComplete="name" value={values.fullName} onChangeText={set('fullName')} error={errors.fullName} testID="fullName" />
      <TextField
        label="Mobile number"
        prefix="+91"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        maxLength={16}
        value={values.phone}
        onChangeText={set('phone')}
        error={errors.phone}
        hint="10-digit Indian mobile number."
        testID="phone"
      />
      <TextField label="Email (optional)" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={values.email} onChangeText={set('email')} error={errors.email} testID="email" />
      <TextField
        label="Password"
        secureTextEntry
        textContentType="newPassword"
        value={values.password}
        onChangeText={set('password')}
        error={errors.password}
        hint="At least 8 characters, with a letter and a number."
        testID="password"
      />
      <Button title="Create account" onPress={submit} loading={submitting} testID="submit-register" />
      <Pressable accessibilityRole="link" onPress={() => router.replace('/login')} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ textAlign: 'center', color: colors.forest, fontWeight: '600' }}>Already registered? Sign in</Text>
      </Pressable>
    </Screen>
  );
}
