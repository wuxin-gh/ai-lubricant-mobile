/**
 * 局域网发现原生模块注入（Android + iOS），与 withAndroidFileSaver /
 * withDouyinLogin 同一套自研 config plugin 范式，不引第三方依赖
 * （react-native-udp 对 RN 0.83 新架构有兼容风险）。
 *
 * 模块 API（TS 包装见 mobile/src/native/lanDiscover.ts）：
 *   discover(port: number, timeoutMs: number) -> Promise<string[]>
 *   返回 JSON 数组字符串：["{\"source_ip\":\"192.168.1.5\",\"raw_payload\":\"{...}\"}"]
 *   原生侧只透传字节，不做 JSON 解析（解析/校验/去重统一在 TS 层）。
 *
 * 流程：ephemeral UDP socket -> setBroadcast -> sendto 魔法串
 * AILUBRICANT_DISCOVER_V1 到 255.255.255.255:port -> 轮询收包到 deadline。
 * 只发送广播 + 接收单播回复，Android 无需 CHANGE_WIFI_MULTICAST_STATE（该
 * 权限只影响接收组播）。iOS 14+ 触发本地网络权限弹窗，描述文案见
 * withInfoPlist 段。
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const { IOSConfig } = require('@expo/config-plugins');

function writeFileIfChanged(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf-8') === contents) return;
  fs.writeFileSync(filePath, contents);
}

function androidModuleSource(packageName) {
  return `package ${packageName}

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.InterruptedIOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException

class LanDiscoverModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  @ReactMethod
  fun discover(port: Int, timeoutMs: Int, promise: Promise) {
    Thread {
      var socket: DatagramSocket? = null
      try {
        socket = DatagramSocket()
        socket.broadcast = true

        // 广播质询：一发 255.255.255.255，一发本网 directed broadcast（部分
        // 路由器对 limited broadcast 处理不一致，双保险显著提升命中率）。
        val magic = "AILUBRICANT_DISCOVER_V1".toByteArray(Charsets.UTF_8)
        val limited = InetAddress.getByName("255.255.255.255")
        socket.send(DatagramPacket(magic, magic.size, limited, port))
        val interfaces = java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())
        val sentTo = mutableSetOf<String>()
        for (iface in interfaces) {
          if (!iface.isUp || iface.isLoopback) continue
          for (addr in iface.interfaceAddresses) {
            val mask = addr.networkPrefixLength
            val inet = addr.address
            if (inet is java.net.Inet4Address && mask in 0..31 && inet.isSiteLocalAddress) {
              val ipInt = java.nio.ByteBuffer.wrap(inet.address).int
              // 网络前缀 | 主机位全 1 = directed broadcast
              val hostBits = 32 - mask
              val hostMask = if (hostBits == 32) -1 else (1 shl hostBits) - 1
              val bcInt = (ipInt ushr hostBits shl hostBits) or hostMask
              val bcBytes = byteArrayOf(
                (bcInt shr 24).toByte(), (bcInt shr 16).toByte(), (bcInt shr 8).toByte(), bcInt.toByte(),
              )
              val bc = InetAddress.getByAddress(bcBytes)
              val bcText = bc.hostAddress
              if (bcText != null && sentTo.add(bcText)) {
                try { socket.send(DatagramPacket(magic, magic.size, bc, port)) } catch (_: Exception) { }
              }
            }
          }
        }

        // 轮询收包到 deadline；soTimeout 短片切片，让循环保持响应。
        val deadline = System.currentTimeMillis() + timeoutMs.coerceAtLeast(300)
        socket.soTimeout = 200
        val seen = LinkedHashMap<String, String>() // source_ip -> 原始 payload（去重）
        val buf = ByteArray(2048)
        while (System.currentTimeMillis() < deadline) {
          val packet = DatagramPacket(buf, buf.size)
          try {
            socket.receive(packet)
          } catch (_: SocketTimeoutException) {
            continue
          } catch (_: InterruptedIOException) {
            continue
          }
          val ip = packet.address.hostAddress ?: continue
          val payload = String(packet.data, 0, packet.length, Charsets.UTF_8)
          seen.putIfAbsent(ip, payload.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\""))
        }

        val items = seen.entries.joinToString(",") { (ip, payload) ->
          "{\\"source_ip\\":\\"$ip\\",\\"raw_payload\\":\\"$payload\\"}"
        }
        promise.resolve("[$items]")
      } catch (error: Exception) {
        promise.reject("E_LAN_DISCOVER", error.message ?: "局域网扫描失败", error)
      } finally {
        try { socket?.close() } catch (_: Exception) { }
      }
    }.start()
  }

  override fun getName(): String = "LanDiscover"
}
`;
}

function androidPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LanDiscoverPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(LanDiscoverModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;
}

function patchMainApplication(projectRoot, packageName) {
  const file = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
  if (!fs.existsSync(file)) return;
  let source = fs.readFileSync(file, 'utf-8');
  if (!source.includes('add(LanDiscoverPackage())')) {
    source = source.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      (match) => `${match}\n          add(LanDiscoverPackage())`,
    );
    fs.writeFileSync(file, source);
  }
}

function iosSwiftSource() {
  return `import Foundation
import React

@objc(LanDiscover)
class LanDiscover: NSObject {
  @objc(discover:timeout:resolver:rejecter:)
  func discover(port: Int, timeoutMs: Int, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      var sock: Int32 = -1
      defer {
        if sock >= 0 { close(sock) }
      }

      sock = socket(AF_INET, SOCK_DGRAM, 0)
      if sock < 0 {
        reject("E_LAN_DISCOVER", "无法创建 UDP socket", nil)
        return
      }

      var broadcast: Int32 = 1
      setsockopt(sock, SOL_SOCKET, SO_BROADCAST, &broadcast, socklen_t(MemoryLayout<Int32>.size))

      // 有限广播。sendto 的指针操作全部收进一个局部块，规避 Escaping closure /
      // exclusive access 检查。
      var addr = sockaddr_in()
      addr.sin_family = sa_family_t(AF_INET)
      addr.sin_port = UInt16(port).bigEndian
      addr.sin_addr = in_addr(s_addr: inet_addr("255.255.255.255"))
      var sent: Int = -1
      let magic = "AILUBRICANT_DISCOVER_V1".data(using: .utf8)!
      magic.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
        withUnsafePointer(to: &addr) { (sa: UnsafePointer<sockaddr_in>) in
          sent = sendto(sock, raw.baseAddress, raw.count, 0, UnsafePointer(sa), socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
      if sent < 0 {
        reject("E_LAN_DISCOVER", "广播发送失败（errno=\\(errno)）", nil)
        return
      }

      // 轮询收包到 deadline。recvfrom 每次最多阻塞 200ms。
      var timeout = timeval(tv_sec: 0, tv_usec: 200_000)
      setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

      var buf = [UInt8](repeating: 0, count: 2048)
      var fromAddr = sockaddr_in()
      var fromLen = socklen_t(MemoryLayout<sockaddr_in>.size)
      var seen = [String: String]()
      let deadline = Date().addingTimeInterval(Double(max(300, timeoutMs)) / 1000.0)

      while Date() < deadline {
        var n: Int = -1
        withUnsafeMutablePointer(to: &fromAddr) { (fa: UnsafeMutablePointer<sockaddr_in>) in
          withUnsafeMutablePointer(to: &fromLen) { (fl: UnsafeMutablePointer<socklen_t>) in
            n = recvfrom(sock, &buf, buf.count, 0, UnsafeMutableRawPointer(fa), fl)
          }
        }
        if n <= 0 {
          if errno == EAGAIN { continue } // SO_RCVTIMEO 超时切片
          break
        }
        var addrCopy = fromAddr
        let ipBytes = withUnsafeBytes(of: &addrCopy.sin_addr) { Data($0) }
        guard ipBytes.count == 4 else { continue }
        let ip = "\\(ipBytes[0]).\\(ipBytes[1]).\\(ipBytes[2]).\\(ipBytes[3])"
        if ip.isEmpty { continue }
        let payload = String(bytes: buf[0..<n], encoding: .utf8) ?? ""
        if seen[ip] == nil {
          seen[ip] = payload
        }
      }

      let items = seen.map { (ip, payload) -> String in
        let escaped = payload
          .replacingOccurrences(of: "\\\\", with: "\\\\\\\\")
          .replacingOccurrences(of: "\\"", with: "\\\\\\"")
        return "{\\"source_ip\\":\\"\\(ip)\\",\\"raw_payload\\":\\"\\(escaped)\\"}"
      }.joined(separator: ",")
      resolve("[\\(items)]")
    }
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
`;
}

function iosBridgeSource() {
  return `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LanDiscover, NSObject)
RCT_EXTERN_METHOD(discover:(double)port timeout:(double)timeoutMs resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
`;
}

function writeIOSNativeFiles(projectRoot) {
  const base = path.join(projectRoot, 'ios', 'AiLubricant');
  writeFileIfChanged(path.join(base, 'LanDiscover.swift'), iosSwiftSource());
  writeFileIfChanged(path.join(base, 'LanDiscoverBridge.m'), iosBridgeSource());
}

function addIOSNativeFilesToProject(projectRoot, project) {
  const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
  let targetUuid;
  try {
    targetUuid = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName })?.uuid;
  } catch {
    targetUuid = undefined;
  }
  for (const filename of ['LanDiscover.swift', 'LanDiscoverBridge.m']) {
    const filepath = `${projectName}/${filename}`;
    const fileReferences = project.pbxFileReferenceSection();
    let existing = false;
    for (const uuid of Object.keys(fileReferences)) {
      if (uuid.endsWith('_comment')) continue;
      const file = fileReferences[uuid];
      if (file?.path === filename || file?.path === filepath || file?.name === filename) {
        file.name = filename;
        file.path = filepath;
        file.sourceTree = '"<group>"';
        existing = true;
      }
    }
    if (existing) continue;

    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath,
      groupName: projectName,
      project,
      targetUuid,
    });
  }
}

module.exports = function withLanDiscovery(config) {
  const packageName = config.android?.package || 'com.ailubricant.mobile';

  config = withInfoPlist(config, (mod) => {
    // iOS 14+：任何发往本地网络的流量都要求此描述文案，否则弹窗不出现且流量被静默丢弃。
    mod.modResults.NSLocalNetworkUsageDescription = '用于在同一局域网内发现 Ai Lubricant 服务器并自动填入登录地址';
    return mod;
  });

  config = withXcodeProject(config, (mod) => {
    addIOSNativeFilesToProject(mod.modRequest.projectRoot, mod.modResults);
    return mod;
  });

  config = withDangerousMod(config, ['android', (mod) => {
    const base = path.join(mod.modRequest.projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'));
    writeFileIfChanged(path.join(base, 'LanDiscoverModule.kt'), androidModuleSource(packageName));
    writeFileIfChanged(path.join(base, 'LanDiscoverPackage.kt'), androidPackageSource(packageName));
    patchMainApplication(mod.modRequest.projectRoot, packageName);
    return mod;
  }]);

  config = withDangerousMod(config, ['ios', (mod) => {
    writeIOSNativeFiles(mod.modRequest.projectRoot);
    return mod;
  }]);

  return config;
};
