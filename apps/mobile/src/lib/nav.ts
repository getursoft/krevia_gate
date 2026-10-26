import type { Href } from 'expo-router';
import type { NavItem } from '@krevia/shared';

/** Where a menu item goes in the app. Unbuilt modules open the shared "Coming soon" screen. */
export function hrefFor(item: NavItem): Href {
  switch (item.screen) {
    case 'home':
      return '/(app)/(tabs)';
    case 'membership':
      return '/society';
    case 'profile':
      return '/profile';
    case 'settings':
      return '/settings';
    case 'requests':
      return '/requests';
    case 'household':
      return '/household';
    default:
      return { pathname: '/module/[key]', params: { key: item.key } };
  }
}

export const TONES = {
  green: { bg: '#E3F3E6', fg: '#2F7A44' },
  blue: { bg: '#E4EDFD', fg: '#2F5FCE' },
  orange: { bg: '#FFF0DC', fg: '#C26A0A' },
  purple: { bg: '#EEE8FD', fg: '#6B4FD1' },
  red: { bg: '#FDE7E5', fg: '#C0392B' },
  teal: { bg: '#DDF3F1', fg: '#137A70' },
} as const;
