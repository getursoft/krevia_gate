import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { ROLE_LABEL, TOWERS_SVG, colors, type AppRole, type NavItem } from '@krevia/shared';
import { TONES, hrefFor } from '../lib/nav';
import { useSession } from '../lib/session';
import { Icon, type IconName } from './Icon';
import { KreviaMark } from './Logo';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

const SUBTITLE: Record<AppRole, string> = { RESIDENT: 'Secured. Transparent. Trust.', ADMIN: 'Admin Panel', GUARD: 'Gate App' };

/** Top bar from the showcase: Krevia logo, notifications bell, avatar. */
export function AppHeader({ role }: { role: AppRole }) {
  const router = useRouter();
  const { user } = useSession();
  return (
    <View style={s.header}>
      <View style={s.row} accessible accessibilityRole="header" accessibilityLabel={`Krevia ${ROLE_LABEL[role]}`}>
        <KreviaMark size={34} />
        <View>
          <Text style={s.brand}>Krevia</Text>
          <Text style={s.brandSub} testID="header-role">{SUBTITLE[role]}</Text>
        </View>
      </View>
      <View style={s.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={8}
          onPress={() => router.push({ pathname: '/module/[key]', params: { key: 'notices' } })}
          style={s.iconBtn}
        >
          <Icon name="bell" color={colors.forest} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="My profile" onPress={() => router.push('/profile')} style={s.avatar}>
          <Text style={s.avatarText}>{user ? initials(user.fullName) : ''}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Society selector card under the header. */
export function SocietyCard({ title, subtitle, live, onPress }: { title: string; subtitle: string; live?: boolean; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.societyCard} testID="society-card">
      <View style={s.societyIcon}>
        <Icon name="building" color={colors.forest} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.societyName} numberOfLines={1}>{title}</Text>
        <Text style={s.societySub} numberOfLines={1}>{subtitle}</Text>
      </View>
      {live ? (
        <View style={s.liveChip}>
          <View style={s.liveDot} />
          <Text style={s.liveText}>Live</Text>
        </View>
      ) : (
        <Icon name="chevronDown" color={colors.inkSubtle} size={18} />
      )}
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle} accessibilityRole="header">{title}</Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="link">
          <Text style={s.sectionAction}>{action} →</Text>
        </Pressable>
      )}
    </View>
  );
}

export function ToneIcon({ icon, tone = 'green', size = 48 }: { icon: IconName; tone?: NonNullable<NavItem['tone']>; size?: number }) {
  const t = TONES[tone];
  return (
    <View style={[s.toneIcon, { width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg }]}>
      <Icon name={icon} color={t.fg} size={size * 0.48} />
    </View>
  );
}

/** 4-column quick action grid. */
export function QuickActionGrid({ items }: { items: NavItem[] }) {
  const router = useRouter();
  return (
    <View style={s.qaGrid}>
      {items.map((item) => (
        <Pressable
          key={`${item.key}-${item.label}`}
          accessibilityRole="button"
          accessibilityLabel={item.screen ? item.label : `${item.label}, coming soon`}
          onPress={() => router.push(hrefFor(item))}
          style={({ pressed }) => [s.qaTile, pressed && { opacity: 0.7 }]}
          testID={`qa-${item.key}`}
        >
          <ToneIcon icon={item.icon} tone={item.tone} />
          <Text style={s.qaLabel} numberOfLines={2}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function StatTile({ icon, tone, value, label, testID }: { icon: IconName; tone: NonNullable<NavItem['tone']>; value: string | number; label: string; testID?: string }) {
  return (
    <View style={s.statTile}>
      <ToneIcon icon={icon} tone={tone} size={40} />
      <View style={{ flex: 1 }}>
        <Text style={s.statValue} testID={testID}>{value}</Text>
        <Text style={s.statLabel} numberOfLines={2}>{label}</Text>
      </View>
    </View>
  );
}

export function TowersBanner({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={s.banner}>
      <View style={{ flex: 1, paddingRight: 8, zIndex: 1 }}>
        <Text style={s.bannerTitle}>{title}</Text>
        <Text style={s.bannerSub}>{subtitle}</Text>
      </View>
      <View style={s.bannerArt} pointerEvents="none">
        <SvgXml xml={TOWERS_SVG} width="100%" height="100%" />
      </View>
    </View>
  );
}

export function ActivityRow({ icon, tone, title, subtitle, meta }: { icon: IconName; tone: NonNullable<NavItem['tone']>; title: string; subtitle?: string; meta?: string }) {
  return (
    <View style={s.activityRow}>
      <ToneIcon icon={icon} tone={tone} size={36} />
      <View style={{ flex: 1 }}>
        <Text style={s.activityTitle}>{title}</Text>
        {subtitle ? <Text style={s.activitySub}>{subtitle}</Text> : null}
      </View>
      {meta ? <Text style={s.activityMeta}>{meta}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { fontSize: 22, fontWeight: '800', color: colors.forest, letterSpacing: -0.4 },
  brandSub: { fontSize: 10, color: colors.forestSoft },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  societyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minHeight: 56 },
  societyIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center' },
  societyName: { fontSize: 15, fontWeight: '700', color: colors.ink },
  societySub: { fontSize: 12, color: colors.inkSubtle },
  liveChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.successSoft, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveText: { color: colors.success, fontWeight: '700', fontSize: 12 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.ink },
  sectionAction: { color: colors.leaf, fontWeight: '600', fontSize: 13 },
  toneIcon: { alignItems: 'center', justifyContent: 'center' },
  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  qaTile: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 2, minHeight: 88 },
  qaLabel: { fontSize: 12, fontWeight: '600', color: colors.ink, textAlign: 'center' },
  statTile: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.ink },
  statLabel: { fontSize: 12, color: colors.inkSubtle },
  banner: { flexDirection: 'row', minHeight: 150, borderRadius: 18, backgroundColor: colors.mint, padding: 18, overflow: 'hidden' },
  bannerTitle: { fontSize: 22, fontWeight: '800', color: colors.ink },
  bannerSub: { fontSize: 13, color: colors.inkMuted, marginTop: 6 },
  bannerArt: { position: 'absolute', right: -6, bottom: -4, width: 190, height: 110 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  activityTitle: { fontSize: 14, fontWeight: '600', color: colors.ink },
  activitySub: { fontSize: 12, color: colors.inkSubtle, marginTop: 2 },
  activityMeta: { fontSize: 11, color: colors.inkSubtle },
});
