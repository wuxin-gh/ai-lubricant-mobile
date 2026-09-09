import { NativeModules, Platform } from 'react-native';

/** UDP 广播端口；与服务端 lan_discovery.py 的 LAN_DISCOVERY_PORT 默认值保持一致。 */
const LAN_DISCOVERY_PORT = 58160;
/** 扫描窗口；原生侧轮询收包到这个 deadline 后返回。 */
const SCAN_TIMEOUT_MS = 2500;

export interface LanServer {
  ip: string;
  url: string; // http://<ip>:<http_port>
  name: string;
  version: string;
}

interface LanDiscoverNativeModule {
  discover: (port: number, timeoutMs: number) => Promise<string>;
}

interface RawEntry {
  source_ip: string;
  raw_payload: string;
}

interface DiscoveryPayload {
  app: string;
  name: string;
  version: string;
  http_port: number;
}

const NativeLanDiscover = NativeModules.LanDiscover as LanDiscoverNativeModule | undefined;

export function isLanDiscoverAvailable(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

/**
 * 扫描局域网内的 Ai Lubricant 服务器。
 *
 * 原生模块广播 AILUBRICANT_DISCOVER_V1 并收集单播回复（超时或权限被拒时返回
 * 空数组/报错）。本层负责 JSON 解析、校验 payload.app === 'ai-lubricant'（防
 * 同端口其他流量）、按 IP 去重并拼出登录 URL。
 */
export async function discoverLanServers(timeoutMs = SCAN_TIMEOUT_MS): Promise<LanServer[]> {
  if (!NativeLanDiscover?.discover) {
    throw new Error('当前安装包不支持局域网扫描，请更新 App');
  }
  const raw = await NativeLanDiscover.discover(LAN_DISCOVERY_PORT, timeoutMs);
  const entries: RawEntry[] = JSON.parse(raw || '[]');
  const out: LanServer[] = [];
  for (const entry of entries) {
    if (!entry?.source_ip) continue;
    let payload: DiscoveryPayload;
    try {
      payload = JSON.parse(entry.raw_payload || '{}');
    } catch {
      continue;
    }
    // 只认自家协议的回复，过滤同端口的其他 UDP 流量
    if (payload?.app !== 'ai-lubricant') continue;
    const port = Number(payload.http_port);
    if (!Number.isFinite(port) || port <= 0) continue;
    out.push({
      ip: entry.source_ip,
      url: `http://${entry.source_ip}:${port}`,
      name: payload.name || 'Ai Lubricant',
      version: String(payload.version || ''),
    });
  }
  return out;
}
