#!/usr/bin/env bash
# 如果指定名称的 Edge 工作区窗口未打开，则通过 --launch-workspace=<uuid> 自动拉起。
# 已打开则直接返回窗口信息。
#
# Usage:
#   launch-workspace.sh --name <workspace-name> [--uuid <uuid>]
#
# Output JSON:
#   { "ok": true, "name": "...", "uuid": "...", "windowId": 123, "opened": false }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EDGE_BIN='/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'

usage() {
  echo 'Usage: launch-workspace.sh --name <workspace-name> [--uuid <uuid>]' >&2
}

out_json() { printf '%s\n' "$1"; }

# 将变量转义为 AppleScript 字符串字面量（仅处理双引号和反斜杠）
aescape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# 查询窗口；若找到返回 "name\tid"，否则返回空
find_window() {
  local name="$1"
  local as_name
  as_name=$(aescape "$name")
  osascript <<EOF
tell application "Microsoft Edge"
  set wsName to "${as_name}"
  try
    set w to first window whose name begins with wsName
    return (name of w) & "\t" & (id of w)
  on error
    return ""
  end try
end tell
EOF
}

main() {
  local name="" uuid=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) name="$2"; shift 2;;
      --uuid) uuid="$2"; shift 2;;
      *) usage; exit 2;;
    esac
  done
  [ -n "$name" ] || { usage; exit 2; }

  # 获取 UUID
  if [ -z "$uuid" ]; then
    local uuid_result
    uuid_result=$("${SCRIPT_DIR}/workspace-uuid.sh" get --name "$name" 2>&1) || true
    uuid=$(printf '%s' "$uuid_result" | jq -r '.uuid // empty')
    if [ -z "$uuid" ]; then
      out_json "{\"ok\":false,\"name\":$(printf '%s' "$name" | jq -Rs .),\"error\":\"cannot resolve uuid\"}"
      exit 1
    fi
  fi

  # 检查窗口是否已打开
  local existing
  existing=$(find_window "$name")
  if [ -n "$existing" ]; then
    local win_name win_id
    win_name=$(printf '%s' "$existing" | cut -f1)
    win_id=$(printf '%s' "$existing" | cut -f2)
    out_json "{\"ok\":true,\"name\":$(printf '%s' "$win_name" | jq -Rs .),\"uuid\":$(printf '%s' "$uuid" | jq -Rs .),\"windowId\":$win_id,\"opened\":false}"
    return 0
  fi

  # 未打开，启动工作区窗口
  open -n -a "$EDGE_BIN" --args --profile-directory="Default" --launch-workspace="$uuid"

  # 轮询等待窗口出现
  local found="" max_wait=20
  for ((i=0; i<max_wait; i++)); do
    sleep 0.5
    found=$(find_window "$name")
    [ -n "$found" ] && break
  done

  if [ -n "$found" ]; then
    local win_name win_id
    win_name=$(printf '%s' "$found" | cut -f1)
    win_id=$(printf '%s' "$found" | cut -f2)
    out_json "{\"ok\":true,\"name\":$(printf '%s' "$win_name" | jq -Rs .),\"uuid\":$(printf '%s' "$uuid" | jq -Rs .),\"windowId\":$win_id,\"opened\":true}"
    return 0
  fi

  out_json "{\"ok\":false,\"name\":$(printf '%s' "$name" | jq -Rs .),\"uuid\":$(printf '%s' "$uuid" | jq -Rs .),\"error\":\"workspace launched but window not detected\"}"
  exit 1
}

main "$@"
