import * as SecureStore from 'expo-secure-store';

const KEY = 'krevia.session.token';

/**
 * Session token persistence in the platform secure store
 * (iOS Keychain, Android Keystore-encrypted storage). Never AsyncStorage.
 */
export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token: string) =>
    SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};
