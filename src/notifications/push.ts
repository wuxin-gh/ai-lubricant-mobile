/**
 * 手机推送基础设施：权限 → Expo token → 设备注册 → 心跳/换绑。
 *
 * 设计原则（与后端 notify_push.py 对应）：
 * - 一切失败静默：推送注册/心跳绝不能阻塞登录、首页或任务操作；
 * - device_key 持久化在本机（AsyncStorage），换 token/升级 App 走幂等 register；
 * - 登出时 revoke 当前设备（token 不能留在上一个账号名下，否则通知串号）；
 * - 权限被系统关闭时不循环弹窗，由设置页提供「去系统设置」。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { heartbeatPushDevice, registerPushDevice } from '@/api/notifications';

const DEVICE_KEY_STORAGE = 'mc.push.deviceKey';
const DEVICE_ID_STORAGE = 'mc.push.deviceId';
const TOKEN_STORAGE = 'mc.push.lastToken';

/**
 * 当前版本默认走「服务端通知表 + App 前台轮询」；Expo/FCM/APNs 代码保留，
 * 等以后配置好对应凭据后只需打开这个开关即可切换，不让远程推送配置阻塞当前版本。
 */
export const REMOTE_PUSH_ENABLED = false;

/** Android 前台通知通道 id —— 与服务端 notify_push.DEFAULT_ANDROID_CHANNEL 同名。 */
export const ANDROID_CHANNEL_ID = 'task-events';

let registered = false;

/** 前台通知展示策略：默认弹横幅（Android 必须有 channel）。web 无原生实现，跳过。 */
export function configurePushPresentation(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: '任务通知',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1FA855',
    });
  }
}

/** 当前系统通知权限状态（不弹窗）。 */
export async function notificationPermission(): Promise<Notifications.PermissionResponse | null> {
  try {
    return await Notifications.getPermissionsAsync();
  } catch {
    return null;
  }
}

/** 请求权限（仅在用户主动触发时调用，见设置页）。 */
export async function requestNotificationPermission(): Promise<Notifications.PermissionResponse | null> {
  try {
    return await Notifications.requestPermissionsAsync();
  } catch {
    return null;
  }
}

/** 稳定 device_key：一次安装生成一次。 */
async function ensureDeviceKey(): Promise<string> {
  let key = await AsyncStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
}

function expoProjectId(): string | undefined {
  // EAS 构建注入 extra.eas.projectId；本地开发时没有 → getExpoPushTokenAsync
  // 会失败，注册流程据此静默退出（通知中心仍然可用）。
  const pid = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return pid || undefined;
}

/** 取 Expo push token；模拟器/无 projectId/未授权/远程推送关闭返回 null。 */
export async function getPushToken(): Promise<string | null> {
  if (!REMOTE_PUSH_ENABLED) return null;
  if (!Device.isDevice) return null; // 模拟器收不到推送
  const perm = await notificationPermission();
  if (!perm?.granted) return null;
  const projectId = expoProjectId();
  if (!projectId) return null;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    return token || null;
  } catch {
    return null;
  }
}

/**
 * 注册（或刷新）当前手机到登录账号。幂等：token 未变也只发一次心跳。
 * fire-and-forget —— 调用方不得 await 其结果做任何用户可见决策。
 */
export async function registerForPush(appVersion?: string): Promise<void> {
  if (registered) return;
  const token = await getPushToken();
  if (!token) return;
  const deviceKey = await ensureDeviceKey();
  const lastToken = await AsyncStorage.getItem(TOKEN_STORAGE);
  const lastDeviceId = await AsyncStorage.getItem(DEVICE_ID_STORAGE);
  try {
    if (lastDeviceId && token === lastToken) {
      // token 没变：只心跳（活跃时间 + app 版本）。
      await heartbeatPushDevice(lastDeviceId, { push_token: token, app_version: appVersion || '' });
    } else {
      const result = await registerPushDevice({
        device_key: deviceKey,
        push_token: token,
        name: Device.modelName || undefined,
        default_name: Device.modelName || '我的手机',
        platform: Platform.OS,
        push_provider: 'expo',
        app_version: appVersion || '',
      });
      await AsyncStorage.multiSet([
        [TOKEN_STORAGE, token],
        [DEVICE_ID_STORAGE, result.device.id],
      ]);
    }
    registered = true;
  } catch {
    // 注册失败下次登录/回前台再试；绝不抛出。
  }
}

/** 登出：清本机的绑定痕迹（服务端 device 行保留，可在此账号再登录后继续用）。 */
export async function clearLocalPushBinding(): Promise<void> {
  registered = false;
  await AsyncStorage.multiRemove([DEVICE_ID_STORAGE, TOKEN_STORAGE]).catch(() => undefined);
}

/** 当前手机在服务端的设备 id（未注册过为 null）。 */
export async function currentDeviceId(): Promise<string | null> {
  return AsyncStorage.getItem(DEVICE_ID_STORAGE).catch(() => null);
}

/** 通知点击 → 路由目标。data 由服务端 notify_push._deliver_mobile_push 注入。 */
export function routeFromNotification(data: Record<string, unknown> | undefined | null): string | null {
  const raw = data?.route;
  if (typeof raw === 'string' && raw.startsWith('/')) return raw;
  const taskId = data?.task_id;
  if (typeof taskId === 'string' && taskId) return `/task/${taskId}`;
  return null;
}
