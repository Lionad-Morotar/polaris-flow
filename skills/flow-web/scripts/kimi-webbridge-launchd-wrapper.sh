#!/usr/bin/env bash
# kimi-webbridge daemon 的 launchd 守护包装器。
# 由 ~/Library/LaunchAgents/cn.kimi.webbridge.plist 在登录时启动。
#
# 行为：
# - 循环检查 daemon 状态，未运行则调用 start
# - 扩展未连接时等待，不盲目重启
# - 发现 ~/.kimi-webbridge/.disable-autostart 时优雅退出（launchd 不再重启）

set -uo pipefail

WB_BIN="${HOME}/.kimi-webbridge/bin/kimi-webbridge"
STATUS_URL="http://127.0.0.1:10086/status"
DISABLE_FLAG="${HOME}/.kimi-webbridge/.disable-autostart"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

fetch_status() {
  curl -s -m 3 "$STATUS_URL" 2>/dev/null || true
}

is_running() {
  local status="$1"
  [ -n "$status" ] && [ "$(printf '%s' "$status" | jq -r '.running // false')" = "true" ]
}

is_extension_connected() {
  local status="$1"
  [ -n "$status" ] && [ "$(printf '%s' "$status" | jq -r '.extension_connected // false')" = "true" ]
}

# 禁用标志存在时直接退出 0，让 launchd 的 SuccessfulExit=false 不触发重启
if [ -f "$DISABLE_FLAG" ]; then
  log "disable flag found, exiting"
  exit 0
fi

if [ ! -x "$WB_BIN" ]; then
  log "kimi-webbridge not installed at $WB_BIN"
  exit 1
fi

log "starting kimi-webbridge launcher loop"

while true; do
  if [ -f "$DISABLE_FLAG" ]; then
    log "disable flag found, exiting"
    exit 0
  fi

  status=$(fetch_status)

  if ! is_running "$status"; then
    log "daemon not running, starting"
    "$WB_BIN" start >/dev/null 2>&1 || true
    sleep 2
    continue
  fi

  if ! is_extension_connected "$status"; then
    # daemon 在但扩展还没连，等一会儿再检查
    sleep 3
    continue
  fi

  # 一切正常，低频心跳
  sleep 5
done
