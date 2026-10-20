import Constants from 'expo-constants';
import { Platform } from 'react-native';

const asUrl = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/\/+$/, '') : null;

/** Resolves the API origin: build-time EXPO_PUBLIC_API_URL, else simulator/emulator defaults. */
export function resolveApiUrl(): string {
  // Either source may be absent or non-string on device, so only accept real strings.
  const configured = asUrl(process.env.EXPO_PUBLIC_API_URL) ?? asUrl(Constants.expoConfig?.extra?.apiUrl);
  if (configured) return configured;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4100' : 'http://localhost:4100';
}

export const API_URL = resolveApiUrl();
