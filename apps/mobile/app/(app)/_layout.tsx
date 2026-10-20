import { Redirect, Stack } from 'expo-router';
import { colors } from '@krevia/shared';
import { useSession } from '../../src/lib/session';

/** Authenticated area: anyone without a validated session is sent back to the entry route. */
export default function AppLayout() {
  const { state } = useSession();
  if (state.status !== 'signedIn') return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.forest,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { fontWeight: '700', color: colors.ink },
        contentStyle: { backgroundColor: colors.canvas },
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="join/search" options={{ title: 'Find your society' }} />
      <Stack.Screen name="join/[societyId]" options={{ title: 'Apartment details' }} />
      <Stack.Screen name="join/review" options={{ title: 'Review request' }} />
      <Stack.Screen name="society" options={{ title: 'My Society' }} />
      <Stack.Screen name="profile" options={{ title: 'My Profile' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      <Stack.Screen name="requests" options={{ title: 'Resident Approvals' }} />
      <Stack.Screen name="module/[key]" options={{ title: '' }} />
    </Stack>
  );
}
