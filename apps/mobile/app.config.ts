/// <reference types="node" />
import type { ExpoConfig } from 'expo/config';

/**
 * API base URL is configurable per build: set EXPO_PUBLIC_API_URL
 * (e.g. https://api.krevia.example). When unset, development defaults are used:
 * iOS simulator → http://localhost:4100, Android emulator → http://10.0.2.2:4100.
 */
const config: ExpoConfig = {
  name: 'Krevia',
  slug: 'krevia',
  scheme: 'krevia',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.krevia.app',
    supportsTablet: true,
  },
  android: {
    package: 'com.krevia.app',
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#FFFFFF' },
    softwareKeyboardLayoutMode: 'resize',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 180, backgroundColor: '#FFFFFF' }],
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || null,
  },
};

export default config;
