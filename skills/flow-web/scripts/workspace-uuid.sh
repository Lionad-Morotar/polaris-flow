#!/usr/bin/env bash
# 维护 Edge 工作区名称到 UUID 的映射（configs/workspace-uuids.json）。
# UUID 用于 --launch-workspace=<uuid> 直接启动工作区窗口。
#
# Usage:
#   workspace-uuid.sh get --name <workspace-name>    # 从缓存或 Edge Sync LevelDB 获取 UUID
#   workspace-uuid.sh set --name <name> --uuid <uuid> # 写入缓存
#   workspace-uuid.sh list                             # 列出所有缓存
#   workspace-uuid.sh sync                             # 从 Edge Sync LevelDB 全量重建

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}/../configs"
CONFIG_FILE="${CONFIG_DIR}/workspace-uuids.json"
IDS_SCRIPT="${SCRIPT_DIR}/_lib/edge-workspace-ids.mjs"

usage() {
  cat <<'USAGE'
Usage:
  workspace-uuid.sh get  --name <workspace-name>
  workspace-uuid.sh set  --name <name> --uuid <uuid>
  workspace-uuid.sh list
  workspace-uuid.sh sync
USAGE
}

ensure_config() {
  mkdir -p "$CONFIG_DIR"
  if [ ! -f "$CONFIG_FILE" ]; then
    echo '{"version":1,"uuids":{}}' > "$CONFIG_FILE"
  fi
}

out_json() { printf '%s\n' "$1"; }

cmd_get() {
  local name=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) name="$2"; shift 2;;
      *) usage; exit 2;;
    esac
  done
  [ -n "$name" ] || { usage; exit 2; }

  ensure_config
  local cached
  cached=$(jq -r --arg n "$name" '.uuids[$n] // empty' "$CONFIG_FILE" 2>/dev/null || true)
  if [ -n "$cached" ]; then
    out_json "{\"ok\":true,\"name\":$(printf '%s' "$name" | jq -Rs .),\"uuid\":$(printf '%s' "$cached" | jq -Rs .),\"source\":\"cache\"}"
    return 0
  fi

  # 缓存未命中，从 Edge Sync LevelDB 查询
  if [ ! -f "$IDS_SCRIPT" ]; then
    out_json '{"ok":false,"error":"edge-workspace-ids.mjs not found"}'
    return 1
  fi
  local result
  result=$(node "$IDS_SCRIPT" lookup --name "$name")
  local uuid
  uuid=$(printf '%s' "$result" | jq -r '.uuid // empty')
  if [ -n "$uuid" ]; then
    # 自动写入缓存
    cmd_set --name "$name" --uuid "$uuid" > /dev/null
    out_json "{\"ok\":true,\"name\":$(printf '%s' "$name" | jq -Rs .),\"uuid\":$(printf '%s' "$uuid" | jq -Rs .),\"source\":\"leveldb\"}"
    return 0
  fi
  out_json "{\"ok\":false,\"name\":$(printf '%s' "$name" | jq -Rs .),\"error\":\"workspace not found in Edge Sync LevelDB\"}"
  return 1
}

cmd_set() {
  local name="" uuid=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --name) name="$2"; shift 2;;
      --uuid) uuid="$2"; shift 2;;
      *) usage; exit 2;;
    esac
  done
  [ -n "$name" ] && [ -n "$uuid" ] || { usage; exit 2; }

  ensure_config
  local tmp
  tmp=$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")
  jq --arg n "$name" --arg u "$uuid" '.uuids[$n] = $u' "$CONFIG_FILE" > "$tmp"
  mv "$tmp" "$CONFIG_FILE"
  out_json "{\"ok\":true,\"name\":$(printf '%s' "$name" | jq -Rs .),\"uuid\":$(printf '%s' "$uuid" | jq -Rs .)}"
}

cmd_list() {
  ensure_config
  jq '.' "$CONFIG_FILE"
}

cmd_sync() {
  if [ ! -f "$IDS_SCRIPT" ]; then
    out_json '{"ok":false,"error":"edge-workspace-ids.mjs not found"}'
    return 1
  fi
  local list
  list=$(node "$IDS_SCRIPT" list)
  ensure_config
  local tmp
  tmp=$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")
  printf '%s' "$list" | jq '{version: 1, uuids: ([.workspaces[] | {key: .name, value: .uuid}] | from_entries)}' > "$tmp"
  mv "$tmp" "$CONFIG_FILE"
  out_json '{"ok":true,"message":"workspace uuids synced from Edge Sync LevelDB"}'
}

case "${1:-}" in
  get)  shift; cmd_get "$@";;
  set)  shift; cmd_set "$@";;
  list) cmd_list;;
  sync) cmd_sync;;
  -h|--help) usage; exit 0;;
  *) usage; exit 2;;
esac
