#!/usr/bin/env bash
# 确保 kimi-webbridge daemon 已运行且浏览器扩展已连接。
# 输出统一 JSON，供其他脚本或 workflow 调用。

set -euo pipefail

WB_BIN="${HOME}/.kimi-webbridge/bin/kimi-webbridge"
STATUS_URL="http://127.0.0.1:10086/status"
MAX_WAIT=30

out_json() {
  local ok="$1"
  local extra="${2:-}"
  if [ -n "$extra" ]; then
    printf '{"ok":%s,%s}\n' "$ok" "$extra"
  else
    printf '{"ok":%s}\n' "$ok"
  fi
}

# 从 HTTP status 端点取 JSON；daemon 未启动时返回空。
fetch_status() {
  curl -s -m 3 "$STATUS_URL" 2>/dev/null || true
}

# 解析状态： running 与 extension_connected
parse_running() {
  printf '%s' "$1" | jq -r '.running // false'
}
parse_extension_connected() {
  printf '%s' "$1" | jq -r '.extension_connected // false'
}

main() {
  if [ ! -x "$WB_BIN" ]; then
    out_json false '"error":"kimi-webbridge not installed at ~/.kimi-webbridge/bin/kimi-webbridge"'
    exit 1
  fi

  local status
  status=$(fetch_status)

  # daemon 未运行则启动
  if [ -z "$status" ] || [ "$(parse_running "$status")" != "true" ]; then
    "$WB_BIN" start >/dev/null 2>&1 || {
      out_json false '"error":"failed to start kimi-webbridge daemon"'
      exit 1
    }
  fi

  # 轮询扩展连接
  local waited=0
  local connected="false"
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    status=$(fetch_status)
    if [ -n "$status" ] && [ "$(parse_running "$status")" = "true" ]; then
      connected=$(parse_extension_connected "$status")
      if [ "$connected" = "true" ]; then
        break
      fi
    fi
    sleep 1
    waited=$((waited + 1))
  done

  status=$(fetch_status)
  if [ -z "$status" ]; then
    out_json false '"error":"daemon did not respond after start"'
    exit 1
  fi

  if [ "$connected" != "true" ]; then
    out_json false "\"error\":\"extension not connected after ${MAX_WAIT}s; please open Edge and ensure the Kimi WebBridge extension is enabled\",\"status\":$(printf '%s' "$status" | jq -c .)"
    exit 1
  fi

  # 成功：输出精简状态
  printf '%s' "$status" | jq -c '{
    ok: true,
    running: (.running // false),
    extension_connected: (.extension_connected // false),
    version: (.version // ""),
    extension_version: (.extension_version // ""),
    port: (.port // 10086)
  }'
}

main
