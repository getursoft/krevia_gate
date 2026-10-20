import Svg, { Path } from 'react-native-svg';
import { ICON_PATHS, type IconName } from '@krevia/shared';

export type { IconName };

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICON_PATHS[name]} />
    </Svg>
  );
}
