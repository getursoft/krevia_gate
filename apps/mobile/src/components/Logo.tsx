import { Image, StyleSheet, Text, View } from 'react-native';
import { BRAND, colors } from '@krevia/shared';

// Static image assets are resolved by Metro via require().
/* eslint-disable @typescript-eslint/no-require-imports */
const MARK = require('../../assets/krevia-mark.png');
const MARK_WHITE = require('../../assets/krevia-mark-white.png');
/* eslint-enable @typescript-eslint/no-require-imports */

/** Krevia mark — the official "K" house logo, same asset as the web (design/krevia-mark.png). */
export function KreviaMark({ size = 40, inverse = false }: { size?: number; inverse?: boolean }) {
  return (
    <Image
      source={inverse ? MARK_WHITE : MARK}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export function Logo({ size = 40, tagline = true, inverse = false }: { size?: number; tagline?: boolean; inverse?: boolean }) {
  const ink = inverse ? '#FFFFFF' : colors.forest;
  return (
    <View style={styles.row} accessible accessibilityRole="header" accessibilityLabel={`${BRAND.name}. ${BRAND.tagline}`}>
      <KreviaMark size={size} inverse={inverse} />
      <View>
        <Text style={[styles.word, { fontSize: size * 0.62, color: ink }]}>{BRAND.name}</Text>
        {tagline && <Text style={[styles.tagline, { color: inverse ? '#DCEFE3' : colors.forestSoft }]}>{BRAND.tagline}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  word: { fontWeight: '800', letterSpacing: -0.4 },
  tagline: { fontSize: 11, marginTop: 2 },
});
