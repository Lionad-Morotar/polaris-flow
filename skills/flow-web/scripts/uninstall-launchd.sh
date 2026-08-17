#!/usr/bin/env bash
# 卸载 kimi-webbridge 用户级开机自启（LaunchAgent）。

set -euo pipefail

WRAPPER_DST="${HOME}/.kimi-webbridge/scripts/launchd-wrapper.sh"
PLIST_PATH="${HOME}/Library/LaunchAgents/cn.kimi.webbridge.plist"
DOMAIN="gui/$(id -u)"

if [ -f "$PLIST_PATH" ]; then
  echo "unloading launchagent"
  launchctl bootout "${DOMAIN}/${PLIST_PATH}" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
else
  echo "plist not found, already uninstalled?"
fi

rm -f "$WRAPPER_DST"

echo "done"
