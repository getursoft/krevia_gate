import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { MEMBERSHIP_STATUS_LABEL, colors, radii, spacing, type ApiClientError, type MembershipStatus } from '@krevia/shared';

/** Safe-area aware, keyboard-avoiding scroll container used by every screen. */
export function Screen({
  children,
  edges = ['top', 'bottom'],
  scroll = true,
  testID,
}: {
  children: ReactNode;
  edges?: Edge[];
  scroll?: boolean;
  testID?: string;
}) {
  const content = scroll ? (
    <ScrollView contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled" testID={testID}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screenContent, { flex: 1 }]} testID={testID}>
      {children}
    </View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const v = buttonVariants[variant];
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [styles.button, v.container, pressed && { opacity: 0.85 }, isDisabled && { opacity: 0.6 }, style]}
    >
      {loading ? <ActivityIndicator color={v.text.color} /> : <Text style={[styles.buttonText, v.text]}>{title}</Text>}
    </Pressable>
  );
}

const buttonVariants: Record<ButtonVariant, { container: ViewStyle; text: { color: string } }> = {
  primary: { container: { backgroundColor: colors.forest }, text: { color: '#FFFFFF' } },
  secondary: { container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, text: { color: colors.forest } },
  danger: { container: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#F2C4BF' }, text: { color: colors.danger } },
  ghost: { container: { backgroundColor: 'transparent' }, text: { color: colors.forest } },
};

export const TextField = forwardRef<React.ElementRef<typeof TextInput>, TextInputProps & { label: string; error?: string; hint?: string; prefix?: string }>(
  function TextField({ label, error, hint, prefix, style, ...input }, ref) {
    const [focused, setFocused] = useState(false);
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.inputRow, focused && styles.inputFocused, !!error && styles.inputError, input.editable === false && styles.inputDisabled]}>
          {prefix && <Text style={styles.prefix}>{prefix}</Text>}
          <TextInput
            ref={ref}
            accessibilityLabel={label}
            accessibilityHint={error ?? hint}
            placeholderTextColor={colors.inkSubtle}
            style={[styles.input, style]}
            onFocus={(e) => {
              setFocused(true);
              input.onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              input.onBlur?.(e);
            }}
            {...input}
          />
        </View>
        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : hint ? (
          <Text style={styles.hint}>{hint}</Text>
        ) : null}
      </View>
    );
  },
);

export function Card({ children, style, tone = 'surface', testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'surface' | 'mint'; testID?: string }) {
  return (
    <View testID={testID} style={[styles.card, tone === 'mint' && { backgroundColor: colors.mint, borderColor: 'transparent' }, style]}>
      {children}
    </View>
  );
}

export function H1({ children }: { children: ReactNode }) {
  return <Text style={styles.h1} accessibilityRole="header">{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2} accessibilityRole="header">{children}</Text>;
}
export function Muted({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

const BADGE: Record<MembershipStatus, { bg: string; fg: string }> = {
  PENDING: { bg: colors.warningSoft, fg: colors.warning },
  APPROVED: { bg: colors.successSoft, fg: colors.success },
  REJECTED: { bg: colors.dangerSoft, fg: colors.danger },
  CANCELLED: { bg: '#EEF1EF', fg: colors.inkMuted },
};

export function StatusBadge({ status }: { status: MembershipStatus }) {
  const c = BADGE[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]} testID="membership-status">
      <Text style={[styles.badgeText, { color: c.fg }]}>{MEMBERSHIP_STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Badge({ label }: { label: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: '#EEF1EF' }]}>
      <Text style={[styles.badgeText, { color: colors.inkMuted }]}>{label}</Text>
    </View>
  );
}

export function Alert({ message, tone = 'error' }: { message?: string | null; tone?: 'error' | 'success' | 'info' | 'warning' }) {
  if (!message) return null;
  const palette = {
    error: [colors.dangerSoft, colors.danger],
    success: [colors.successSoft, colors.success],
    info: [colors.infoSoft, colors.info],
    warning: [colors.warningSoft, colors.warning],
  }[tone];
  return (
    <View style={[styles.alert, { backgroundColor: palette[0] }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Text style={{ color: palette[1], fontSize: 14 }}>{message}</Text>
    </View>
  );
}

export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.forest} size="large" />
      <Muted style={{ marginTop: spacing.md }}>{label}</Muted>
    </View>
  );
}

/** Error with retry. Network failures get an offline-specific title. */
export function ErrorView({ error, onRetry }: { error: ApiClientError; onRetry?: () => void }) {
  return (
    <Card style={{ alignItems: 'center', gap: spacing.md }} testID="error-view">
      <Text style={styles.h2}>{error.isNetwork ? 'You appear to be offline' : 'Something went wrong'}</Text>
      <Muted style={{ textAlign: 'center' }}>{error.message}</Muted>
      {onRetry && <Button title="Try again" variant="secondary" onPress={onRetry} testID="retry" />}
    </Card>
  );
}

export function EmptyView({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <Card tone="mint" style={{ alignItems: 'center', gap: spacing.sm }}>
      <Text style={styles.h2}>{title}</Text>
      <Muted style={{ textAlign: 'center' }}>{message}</Muted>
      {action}
    </Card>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  screenContent: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1 },
  button: { minHeight: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600', color: colors.ink },
  inputRow: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, overflow: 'hidden' },
  inputFocused: { borderColor: colors.forest },
  inputError: { borderColor: colors.danger },
  inputDisabled: { backgroundColor: '#F1F4F2' },
  prefix: { paddingHorizontal: 12, alignSelf: 'stretch', textAlignVertical: 'center', lineHeight: 48, backgroundColor: colors.mint, color: colors.forest, fontWeight: '600' },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.ink },
  error: { color: colors.danger, fontSize: 13 },
  hint: { color: colors.inkSubtle, fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  h1: { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 },
  h2: { fontSize: 18, fontWeight: '700', color: colors.ink },
  muted: { color: colors.inkMuted, fontSize: 15, lineHeight: 21 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: radii.pill },
  badgeText: { fontSize: 12, fontWeight: '700' },
  alert: { padding: spacing.md, borderRadius: radii.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
});
