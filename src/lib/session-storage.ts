import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

function withoutProviderTokens(value: string) {
  try {
    const session = JSON.parse(value);
    if (session && typeof session === 'object') {
      delete session.provider_token;
      delete session.provider_refresh_token;
      return JSON.stringify(session);
    }
  } catch {}
  return value;
}

export const sessionStorage = {
  async getItem(key: string) {
    if (Platform.OS === 'web') return globalThis.sessionStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  async setItem(key: string, value: string) {
    const safeValue = withoutProviderTokens(value);
    if (Platform.OS === 'web') globalThis.sessionStorage.setItem(key, safeValue);
    else await SecureStore.setItemAsync(key, safeValue);
  },
  async removeItem(key: string) {
    if (Platform.OS === 'web') globalThis.sessionStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
