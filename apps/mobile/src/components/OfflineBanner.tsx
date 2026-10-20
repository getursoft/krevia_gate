import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@krevia/shared';

/** Persistent banner shown while the device has no network connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => NetInfo.addEventListener((s) => setOffline(s.isConnected === false)), []);
  if (!offline) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert" testID="offline-banner">
      <Text style={styles.text}>No internet connection. Changes cannot be saved until you are back online.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningSoft, paddingVertical: 8, paddingHorizontal: 16 },
  text: { color: colors.warning, fontSize: 13, textAlign: 'center' },
});
