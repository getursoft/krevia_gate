import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '@krevia/shared';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { SessionProvider, useSession } from '../src/lib/session';

void SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { state } = useSession();
  useEffect(() => {
    if (state.status !== 'restoring') void SplashScreen.hideAsync().catch(() => {});
  }, [state.status]);
  return (
    <>
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvas } }} />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
