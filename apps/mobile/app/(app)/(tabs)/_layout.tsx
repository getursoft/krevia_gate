import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { ROLE_NAVIGATION, colors } from '@krevia/shared';
import { Icon, type IconName } from '../../../src/components/Icon';
import { hrefFor } from '../../../src/lib/nav';
import { useSession } from '../../../src/lib/session';

const icon = (name: IconName) => ({ color }: { color: unknown }) => <Icon name={name} color={String(color)} />;

/** Bottom tabs from the showcase: Home · role tab · centre action · role tab · More. */
export default function TabsLayout() {
  const { role } = useSession();
  const router = useRouter();
  const nav = ROLE_NAVIGATION[role];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.forest,
        tabBarInactiveTintColor: colors.inkSubtle,
        sceneStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Tabs.Screen name="index" options={{ title: role === 'ADMIN' ? 'Dashboard' : 'Home', tabBarIcon: icon('home') }} />
      <Tabs.Screen name="second" options={{ title: nav.tabs.second.label, tabBarIcon: icon(nav.tabs.second.icon) }} />
      <Tabs.Screen
        name="action"
        options={{
          title: nav.tabs.centre.label,
          tabBarButton: () => (
            <View style={styles.fabWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={nav.tabs.centre.label}
                onPress={() => router.push(hrefFor(nav.tabs.centre))}
                style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
                testID="tab-fab"
              >
                <Icon name={role === 'GUARD' ? 'qr' : 'plus'} color="#FFFFFF" size={28} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen name="fourth" options={{ title: nav.tabs.fourth.label, tabBarIcon: icon(nav.tabs.fourth.icon) }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('more') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  fabWrap: { flex: 1, alignItems: 'center' },
  fab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    marginTop: -20,
    backgroundColor: colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
});
