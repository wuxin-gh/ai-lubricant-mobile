/**
 * 移动控制端「检查更新」——与节点下载升级同构：后端缓存 mobile-releases/version.json，
 * 客户端问后端拿最新版本与 APK 直链，比对版本号，下载 + 校验 sha256 + 调起系统安装。
 *
 * 仅 Android 做下载升级；iOS 不自检，只跳 App Store（iOS 装不了自下载的包）。
 * 与节点升级的对应关系：
 *   节点 version.json（真相源）        ← mobile-releases/version.json
 *   服务端 PG 缓存 + sync_loop         ← mobile_release_catalog
 *   管理页上传 APK 到 GitHub Release    ← /admin/mobile-versions/upload
 *   节点 select_upgrade_assets + 下载  ← checkAppUpdate + downloadAndInstallApk
 *   节点 verifySHA256 + swapBinary     ← sha256 校验 + 系统安装器
 */
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import {
  cacheDirectory,
  createDownloadResumable,
  getContentUriAsync,
  type DownloadProgressData,
} from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';
import { authHeaders, getBaseUrl } from '@/api/client';
import { sha256Bytes } from '@/api/sha256fast';

/** 后端 /consumer/mobile-version 的返回。 */
export interface MobileVersionInfo {
  version: string;
  version_notes: string;
  release_tag: string;
  android: { version: string; download_url: string; proxy_download_url?: string; digest: string; size_bytes: number };
  ios: { version: string; store_url: string };
  updated_at: string;
  stale: boolean;
}

/** 已安装的原生安装包版本（与 OTA 无关；来自安装包，App 唯一可信的自身版本）。 */
export function installedAppVersion(): string {
  return Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? '';
}

async function fetchMobileVersion(): Promise<MobileVersionInfo | null> {
  const base = getBaseUrl().replace(/\/+$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/v1/marketplace/consumer/mobile-version`, {
      headers: { ...authHeaders() },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<MobileVersionInfo>;
    return j as MobileVersionInfo;
  } catch {
    return null;
  }
}

function isNewer(remote: string, installed: string): boolean {
  // 数字/日期串（如 260608 / 26070603）可直接字符串比较；都非空且不同即视为有更新。
  return !!remote && !!installed && remote > installed;
}

export type AppUpdateResult =
  | { status: 'disabled' }
  | { status: 'none'; current: string }
  | { status: 'error'; message?: string }
  | { status: 'ios-store'; storeUrl: string; current: string }
  | {
      status: 'available';
      version: string;
      downloadUrl: string;
      digest: string;
      sizeBytes: number;
      current: string;
      notes?: string;
    };

/** 解析出实际下载地址：优先服务端代理下载（手机不一定能直连 GitHub），回落直链。 */
function resolveDownloadUrl(info: MobileVersionInfo): string {
  const proxy = info.android?.proxy_download_url;
  if (proxy) {
    const base = getBaseUrl().replace(/\/+$/, '');
    return proxy.startsWith('http') ? proxy : `${base}${proxy}`;
  }
  return info.android.download_url;
}

/** 检查更新。iOS 永远走商店（不自检）；Android 比版本号决定是否下载升级。 */
export async function checkAppUpdate(): Promise<AppUpdateResult> {
  const installed = installedAppVersion();
  if (Platform.OS === 'ios') {
    const info = await fetchMobileVersion();
    return {
      status: 'ios-store',
      storeUrl: info?.ios?.store_url || '',
      current: installed,
    };
  }
  const info = await fetchMobileVersion();
  if (!info) return { status: 'error' };
  const remote = info.android?.version || info.version;
  if (!remote) return { status: 'none', current: installed };
  if (!isNewer(remote, installed)) return { status: 'none', current: installed };
  return {
    status: 'available',
    version: remote,
    downloadUrl: resolveDownloadUrl(info),
    digest: info.android.digest,
    sizeBytes: info.android.size_bytes,
    current: installed,
    notes: info.version_notes,
  };
}

/** 下载并安装 APK（仅 Android）。校验 sha256 后调起系统安装器。 */
export async function downloadAndInstallApk(
  downloadUrl: string,
  expectedDigest: string,
  onProgress?: (received: number, total: number) => void,
): Promise<{ ok: boolean; error?: string; localUri?: string }> {
  if (Platform.OS !== 'android') return { ok: false, error: '仅 Android 支持下载安装' };
  // 落在 cache 目录：系统可在空间不足时回收，装完不必自己清理。
  const tmpUri = `${cacheDirectory ?? `${Paths.cache.uri}/`}ai-lubricant-update.apk`;
  try {
    // 经服务端代理下载时 URL 在本站域下，反向代理若加 Basic Auth，这里必须带上头，
    // 否则 Android 的网络栈不带会话凭据、直接 401（iOS 系统凭据缓存救过一次，Android 不会）。
    const task = createDownloadResumable(
      downloadUrl,
      tmpUri,
      { headers: { ...authHeaders() } },
      (progress: DownloadProgressData) => {
        onProgress?.(progress.totalBytesWritten, progress.totalBytesExpectedToWrite);
      },
    );
    const downloadRes = await task.downloadAsync();
    if (!downloadRes || downloadRes.status < 200 || downloadRes.status >= 300) {
      return { ok: false, error: `下载失败（HTTP ${downloadRes?.status ?? '?'}）` };
    }
    const localUri = downloadRes.uri;
    // 校验 sha256：与服务端写入 version.json 的 digest 字段同口径（sha256:<hex>）。
    const fileHash = await fileSha256Hex(localUri);
    const expected = expectedDigest.startsWith('sha256:') ? expectedDigest.slice(7) : expectedDigest;
    if (fileHash !== expected) {
      return { ok: false, error: '校验失败：下载文件 sha256 与发布不一致，已中止安装' };
    }
    // 调起系统安装器：需要 content:// URI（FileProvider），file:// 在 N+ 会抛
    // FileUriExposedException。安装本身由系统弹窗确认，App 不静默装。
    const contentUri = await getContentUriAsync(localUri);
    await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
      data: contentUri,
      flags: 1, // Intent.FLAG_GRANT_READ_URI_PERMISSION
    });
    return { ok: true, localUri };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 取最新 Android 安装包信息（不比较版本）：「关于 → 下载最新安装包」用，可重装/降级。
 * iOS 没有自下载安装通道，返回 null。 */
export async function latestAndroidPackage(): Promise<{ version: string; url: string; digest: string; notes?: string } | null> {
  if (Platform.OS !== 'android') return null;
  const info = await fetchMobileVersion();
  if (!info || !info.android?.download_url) return null;
  return {
    version: info.android.version || info.version,
    url: resolveDownloadUrl(info),
    digest: info.android.digest,
    notes: info.version_notes,
  };
}

async function fileSha256Hex(uri: string): Promise<string> {
  // 读整文件算 sha256。APK 通常 30~80MB，在应用沙箱内，可接受。
  const bytes = await new File(uri).bytes();
  return toHex(sha256Bytes(bytes));
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
