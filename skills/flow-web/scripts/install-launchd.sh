#!/usr/bin/env bash
# 安装 kimi-webbridge 用户级开机自启（LaunchAgent）。
# 幂等：再次运行会先卸载旧配置再重新安装。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER_SRC="${SCRIPT_DIR}/kimi-webbridge-launchd-wrapper.sh"
WRAPPER_DST="${HOME}/.kimi-webbridge/scripts/launchd-wrapper.sh"
PLIST_PATH="${HOME}/Library/LaunchAgents/cn.kimi.webbridge.plist"
DOMAIN="gui/$(id -u)"

if [ ! -f "$WRAPPER_SRC" ]; then
  echo "wrapper not found: $WRAPPER_SRC" >&2
  exit 1
fi

mkdir -p "${HOME}/.kimi-webbridge/scripts"
mkdir -p "${HOME}/.kimi-webbridge/logs"

cp "$WRAPPER_SRC" "$WRAPPER_DST"
chmod +x "$WRAPPER_DST"

# 如果已加载，先卸载（bootout 对未加载的 plist 会报错，忽略）
if launchctl print "${DOMAIN}/cn.kimi.webbridge" >/dev/null 2>&1; then
  echo "unloading existing launchagent"
  launchctl bootout "${DOMAIN}/${PLIST_PATH}" >/dev/null 2>&1 || true
  sleep 0.5
fi

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>cn.kimi.webbridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>${WRAPPER_DST}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>WorkingDirectory</key>
  <string>${HOME}/.kimi-webbridge</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${HOME}/.kimi-webbridge/logs/launchd-wrapper.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.kimi-webbridge/logs/launchd-wrapper.error.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap "$DOMAIN" "$PLIST_PATH"

# 稍等并验证
echo "waiting for daemon readiness..."
sleep 2
"${SCRIPT_DIR}/ensure-webbridge.sh"
