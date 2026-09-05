const storage: Record<string, string> = {};
const secure: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => storage[key] ?? null),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete storage[k]); }),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => { secure[key] = value; }),
  getItemAsync: jest.fn(async (key: string) => secure[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => { delete secure[key]; }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadBasicAuth, loadPassword, migrateLegacy } from '../secrets';

describe('SecureStore credential migration', () => {
  beforeEach(() => {
    Object.keys(storage).forEach((k) => delete storage[k]);
    Object.keys(secure).forEach((k) => delete secure[k]);
    jest.clearAllMocks();
  });

  it('moves legacy plaintext values then deletes both AsyncStorage keys', async () => {
    storage['mc.pw'] = 'secret-password';
    storage['mc.basicAuth'] = 'proxy:user';

    await migrateLegacy();

    expect(await loadPassword()).toBe('secret-password');
    expect(await loadBasicAuth()).toBe('proxy:user');
    expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(['mc.pw', 'mc.basicAuth']);
    expect(storage['mc.pw']).toBeUndefined();
    expect(storage['mc.basicAuth']).toBeUndefined();
  });

  it('is idempotent when no legacy values remain', async () => {
    await migrateLegacy();
    expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
  });
});
