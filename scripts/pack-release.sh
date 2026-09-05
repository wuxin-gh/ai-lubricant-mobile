#!/usr/bin/env bash
#
# 打包移动控制端发行版：产出 Android APK，重命名为发布契约名，待拖入市场管理页
# 「mobile-versions」上传弹框。与节点 pack-release.sh 同风格——脚本只负责出产物，
# version.json 由服务端在上传后自动生成（_refresh_mobile_release_marker 投影）。
#
# 命名契约（与 validator.identify_mobile_asset 一致）：
#   ai-lubricant-<version>-android.apk    <version> = 可比较数字/日期串（如 260608）
#
# iOS 走 App Store，不在本脚本产出；上架后只把商店链接填进上传弹框。
#
# 用法（从 mobile/ 目录）：
#   bash scripts/pack-release.sh                  # 默认版本取 app.json 的 version
#   VERSION=260706 bash scripts/pack-release.sh    # 显式指定版本
#   EAS_PROFILE=preview bash scripts/pack-release.sh   # 默认 preview（出 APK）
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$HERE/.." && pwd)"

VERSION="${VERSION:-}"
EAS_PROFILE="${EAS_PROFILE:-preview}"

# 默认版本号取 app.json 的 expo.version（数字/日期串），与装机 App 自报版本一致。
if [ -z "$VERSION" ]; then
  VERSION="$(node -e "console.log(require('$APP_ROOT/app.json').expo.version)")"
fi
echo "==> 移动端打包版本: $VERSION (profile=$EAS_PROFILE)"

OUT_NAME="ai-lubricant-${VERSION}-android.apk"
OUT_DIR="$APP_ROOT/dist"
mkdir -p "$OUT_DIR"

# preview profile 在 eas.json 里 buildType=apk；production 是 app-bundle（走商店）。
echo "==> EAS build (Android, profile=$EAS_PROFILE)…"
( cd "$APP_ROOT" && npx eas-cli build -p android --profile "$EAS_PROFILE" --non-interactive --local 2>&1 ) \
  | tee "$OUT_DIR/eas-build-$VERSION.log" || {
    echo "EAS 本地构建失败，日志见 $OUT_DIR/eas-build-$VERSION.log" >&2
    echo "（也可去掉 --local 走云端构建，或手动用 Android Studio 出 APK 后重命名）" >&2
    exit 1
  }

# EAS --local 把产物放在 android/app/build/outputs/apk/<profile>/*.apk；找到它重命名。
APK_SRC="$(find "$APP_ROOT/android" -name '*.apk' -path '*apk*' 2>/dev/null | head -1 || true)"
if [ -z "$APK_SRC" ] || [ ! -f "$APK_SRC" ]; then
  echo "找不到构建产物 APK（在 android/app/build/outputs 下）。请手动定位并重命名为 $OUT_NAME 后拖进上传弹框。" >&2
  exit 1
fi

cp "$APK_SRC" "$OUT_DIR/$OUT_NAME"
echo
echo "==> 完成：$OUT_DIR/$OUT_NAME"
echo "下一步：把 $OUT_DIR/$OUT_NAME 拖进市场管理页 mobile-versions「上传新版本」弹框，"
echo "  版本号填 $VERSION，可选填 iOS 商店链接。上传后服务端自动写 mobile-releases/version.json。"
