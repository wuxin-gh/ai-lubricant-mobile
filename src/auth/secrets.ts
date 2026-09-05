/**
 * 敏感凭据存储。
 *
 * 密码（自动填充用）与测试环境 HTTP Basic Auth 凭据不再以明文写入 AsyncStorage，
 * 改用 expo-secure-store（iOS Keychain / Android Keystore 加密存储）。
 *
 * 非敏感配置（baseUrl、email、登录态、主题等）仍走 AsyncStorage。
 *
 * 启动时 `migrateLegacy()` 做一次性迁移：把旧版本写在 AsyncStorage 的明文凭据
 * 搬到 SecureStore，并删除明文。迁移是幂等的——已迁移过则不产生任何写入。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// AsyncStorage 里的旧明文键（迁移源；迁移成功后删除）。
const LEGACY_PASSWORD = 'mc.pw';
const LEGACY_BASIC_AUTH = 'mc.basicAuth';

// SecureStore 里的新键。
const SECURE_PASSWORD = 'mc.password';
const SECURE_BASIC_AUTH = 'mc.basicAuth';

// SecureStore 在某些环境（web、部分模拟器）不可用；此时回退到 AsyncStorage，
// 但仅用于自动填充，不用于保存新写入的敏感值——回退态下新登录不再持久化密码。
let secureAvailable: boolean | null = null;

async function probeSecureStore(): Promise<boolean> {
  if (secureAvailable !== null) return secureAvailable;
  try {
    // 用一个固定探针 key 测试可写可读可删。
    const probe = '__mc_probe__';
    await SecureStore.setItemAsync(probe, '1');
    const back = await SecureStore.getItemAsync(probe);
    await SecureStore.deleteItemAsync(probe);
    secureAvailable = back === '1';
  } catch {
    secureAvailable = false;
  }
  return secureAvailable;
}

/** 读取密码（自动填充用）。无值或不可用时返回空串。 */
export async function loadPassword(): Promise<string> {
  if (!(await probeSecureStore())) return '';
  try {
    return (await SecureStore.getItemAsync(SECURE_PASSWORD)) ?? '';
  } catch {
    return '';
  }
}

/** 保存密码。SecureStore 不可用时直接放弃持久化（不留明文）。 */
export async function savePassword(value: string): Promise<void> {
  if (!(await probeSecureStore())) return;
  try {
    if (value) await SecureStore.setItemAsync(SECURE_PASSWORD, value);
    else await SecureStore.deleteItemAsync(SECURE_PASSWORD);
  } catch {
    /* 忽略：自动填充凭据丢失不影响会话（Cookie 仍是会话真相源） */
  }
}

/** 清除保存的密码。 */
export async function clearPassword(): Promise<void> {
  if (!(await probeSecureStore())) return;
  try {
    await SecureStore.deleteItemAsync(SECURE_PASSWORD);
  } catch {
    /* ignore */
  }
}

/** 读取 Basic Auth 凭据。无值返回空串。 */
export async function loadBasicAuth(): Promise<string> {
  if (!(await probeSecureStore())) return '';
  try {
    return (await SecureStore.getItemAsync(SECURE_BASIC_AUTH)) ?? '';
  } catch {
    return '';
  }
}

/** 保存 Basic Auth 凭据。SecureStore 不可用时放弃持久化。 */
export async function saveBasicAuth(value: string): Promise<void> {
  if (!(await probeSecureStore())) return;
  try {
    if (value) await SecureStore.setItemAsync(SECURE_BASIC_AUTH, value);
    else await SecureStore.deleteItemAsync(SECURE_BASIC_AUTH);
  } catch {
    /* ignore */
  }
}

/**
 * 一次性迁移：把 AsyncStorage 里的旧明文凭据搬到 SecureStore，并删除明文。
 * SecureStore 不可用时，同样删除 AsyncStorage 明文（避免长期保留明文），
 * 用户下次需重新输入——但会话 Cookie 仍在，不影响已登录用户。
 *
 * 幂等：已迁移过（旧 key 不存在）则什么都不做。
 */
export async function migrateLegacy(): Promise<void> {
  try {
    const [legacyPw, legacyBasic] = await Promise.all([
      AsyncStorage.getItem(LEGACY_PASSWORD),
      AsyncStorage.getItem(LEGACY_BASIC_AUTH),
    ]);
    if (legacyPw == null && legacyBasic == null) return;

    const ok = await probeSecureStore();
    if (ok) {
      if (legacyPw != null) await savePassword(legacyPw);
      if (legacyBasic != null) await saveBasicAuth(legacyBasic);
    }
    // 无论 SecureStore 是否可用，都清掉 AsyncStorage 里的明文。
    await AsyncStorage.multiRemove([LEGACY_PASSWORD, LEGACY_BASIC_AUTH]);
  } catch {
    /* 迁移失败不影响启动：最坏情况是明文继续躺在 AsyncStorage，下次启动再试 */
  }
}