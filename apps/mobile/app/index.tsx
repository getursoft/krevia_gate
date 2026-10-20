import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { BRAND } from '@krevia/shared';
import { Button, ErrorView, LoadingView, Screen } from '../src/components/ui';
import { useSession } from '../src/lib/session';

/** Entry: restores the stored session, then routes to the app or the welcome screen. */
export default function Index() {
  const { state, retryRestore, logout } = useSession();
  if (state.status === 'restoring') return <LoadingView label={`Starting ${BRAND.name}…`} />;
  if (state.status === 'signedIn') return <Redirect href="/(app)/(tabs)" />;
  if (state.status === 'offline') {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
          <ErrorView error={state.error} onRetry={retryRestore} />
          <Button title="Sign out" variant="ghost" onPress={logout} />
        </View>
      </Screen>
    );
  }
  return <Redirect href="/welcome" />;
}
