#!/usr/bin/env bash
# 在指定 Edge 工作区、新窗口或当前窗口打开 URL，并让 webbridge session 接管。
#
# 默认行为：根据当前 cwd 查询 workspace-binding 缓存；若命中绑定，则在对应
# workspace 后台开 tab（必要时自动拉起工作区）。未命中时才在当前窗口开 tab。
# --workspace：显式指定目标工作区/窗口名。
# --new-window：新建独立窗口。
# --current-window：强制忽略 cwd 绑定，在当前窗口开 tab。
# --restore：完成后尝试把 Edge 目标窗口置为 frontmost；默认不抢占焦点。
#
# 并发安全：不同任务用不同 --session；脚本内部用 shlock 串行化 AppleScript
# 窗口操作。

set -euo pipefail

URL=""
SESSION=""
WORKSPACE=""
NEW_WINDOW=0
RESTORE=0
AUTO_LAUNCH=0
CURRENT_WINDOW=0

usage() {
  cat <<'USAGE'
Usage: open-tab.sh --url <url> --session <name> [--workspace <name>] [--new-window] [--current-window] [--restore] [--no-restore] [--auto-launch]
  --url            目标 URL（必填）
  --session        webbridge session 名（必填，不同任务务必用不同名）
  --workspace      目标工作区/窗口名（严格大小写）；省略则按 cwd 绑定自动选择
  --new-window     新建独立窗口（默认不激活；传 --restore 则保留焦点）
  --current-window 强制在当前窗口开 tab，忽略 cwd 绑定
  --restore        完成后把 Edge 目标窗口置为 frontmost
  --no-restore     不恢复焦点（默认行为；后台静默打开 tab，不激活窗口）
  --auto-launch    当 --workspace 指定的工作区未打开时，自动通过 --launch-workspace 拉起
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2;;
    --session) SESSION="$2"; shift 2;;
    --workspace) WORKSPACE="$2"; shift 2;;
    --new-window) NEW_WINDOW=1; shift;;
    --current-window) CURRENT_WINDOW=1; shift;;
    --restore) RESTORE=1; shift;;
    --no-restore) RESTORE=0; shift;;
    --auto-launch) AUTO_LAUNCH=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "unknown arg: $1" >&2; usage; exit 2;;
  esac
done

[ -n "$URL" ] || { echo "missing --url" >&2; usage; exit 2; }
[ -n "$SESSION" ] || { echo "missing --session" >&2; usage; exit 2; }

if [ "$NEW_WINDOW" = "1" ] && [ -n "$WORKSPACE" ]; then
  echo "--new-window and --workspace are mutually exclusive" >&2
  exit 2
fi
if [ "$CURRENT_WINDOW" = "1" ] && [ -n "$WORKSPACE" ]; then
  echo "--current-window and --workspace are mutually exclusive" >&2
  exit 2
fi
if [ "$CURRENT_WINDOW" = "1" ] && [ "$NEW_WINDOW" = "1" ]; then
  echo "--current-window and --new-window are mutually exclusive" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WB="http://127.0.0.1:10086"
LOCK_FILE="${KW_LOCK_FILE:-/tmp/kimi-web-open-tab.lock}"
LOCK_TIMEOUT="${KW_LOCK_TIMEOUT:-30}"
TAB_ID=""
NAV_OK=0

out_json() { printf '{"ok":%s%s}\n' "$1" "${2:-}"; }

# --- 失败时关闭已接管 tab（仅限 webbridge 已拿到 tabId 的情况）---
cleanup_tab() {
  if [ "$NAV_OK" = "1" ]; then return 0; fi
  if [ -n "$TAB_ID" ]; then
    curl -s -m 5 -X POST "$WB/command" -H 'Content-Type: application/json' \
      -d "{\"action\":\"close_tab\",\"session\":\"${SESSION}\"}" >/dev/null 2>&1 || true
  fi
}

# --- 并发锁 ---
acquire_lock() {
  local waited=0
  while :; do
    if shlock -p $$ -f "$LOCK_FILE" 2>/dev/null; then return 0; fi
    local owner; owner=$(cat "$LOCK_FILE" 2>/dev/null || true)
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -f "$LOCK_FILE"; continue
    fi
    sleep 0.2; waited=$((waited+1))
    if [ "$waited" -gt $((LOCK_TIMEOUT*5)) ]; then return 1; fi
  done
}

if ! acquire_lock; then
  out_json false ',"error":"lock timeout"'; exit 3
fi
trap 'cleanup_tab; rm -f "$LOCK_FILE"' EXIT INT TERM

# --- 步骤 0：确保 daemon + 扩展就绪 ---
ENSURE=$("$SCRIPT_DIR/ensure-webbridge.sh" 2>&1) || {
  out_json false ",\"error\":\"ensure-webbridge failed\",\"detail\":$(printf '%s' "$ENSURE" | jq -Rs .)"
  exit 7
}
if [ "$(printf '%s' "$ENSURE" | jq -r '.ok // false')" != "true" ]; then
  out_json false ",\"error\":\"webbridge not healthy\",\"detail\":$(printf '%s' "$ENSURE" | jq -Rs .)"
  exit 7
fi

esc() {
  printf '%s' "$1" | jq -Rs 'sub("\\n$";"")'
}
ESC_URL=$(esc "$URL")
ESC_SESSION=$(esc "$SESSION")

# --- 默认行为：按 cwd 绑定自动选择 workspace ---
# 当用户没有显式指定 --workspace / --new-window / --current-window 时，
# 先查询 workspace-binding 缓存。只要当前 cwd 有绑定（defaultWorkspace 或 site 覆盖），
# 就落到对应 workspace；否则回退到当前窗口的 navigate + newTab。
if [ "$NEW_WINDOW" = "0" ] && [ -z "$WORKSPACE" ] && [ "$CURRENT_WINDOW" = "0" ]; then
  LOOKUP_RESP=$("$SCRIPT_DIR/workspace-binding.sh" lookup --url "$URL" --cwd "$(pwd)" 2>&1) || true
  if [ "$(printf '%s' "$LOOKUP_RESP" | jq -r '.found // false')" = "true" ]; then
    WS_FROM_BINDING=$(printf '%s' "$LOOKUP_RESP" | jq -r '.workspace // empty')
    if [ -n "$WS_FROM_BINDING" ]; then
      WORKSPACE="$WS_FROM_BINDING"
      AUTO_LAUNCH=1
    fi
  fi
fi

# --- 快速路径：当前窗口 navigate + newTab ---
if [ "$NEW_WINDOW" = "0" ] && [ -z "$WORKSPACE" ]; then
  NAV_RESP=$(curl -s -m 15 -X POST "$WB/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"navigate\",\"args\":{\"url\":${ESC_URL},\"newTab\":true},\"session\":${ESC_SESSION}}" 2>&1) || {
    out_json false ",\"error\":\"navigate request failed\",\"detail\":$(printf '%s' "$NAV_RESP" | jq -Rs .)"
    exit 9
  }
  if [ "$(printf '%s' "$NAV_RESP" | jq -r '.ok // false')" != "true" ]; then
    out_json false ",\"error\":\"navigate failed\",\"detail\":$(printf '%s' "$NAV_RESP" | jq -Rs .)"
    exit 9
  fi
  TAB_ID=$(printf '%s' "$NAV_RESP" | jq -r '.data.tabId // empty')
  NAV_OK=1
  out_json true ",\"tabId\":${TAB_ID:-null},\"mode\":\"navigate\",\"session\":$(esc "$SESSION")"
  exit 0
fi

# --- AppleScript 路径：新建窗口 / 指定工作区 ---
esc_applescript() {
  # 把字符串插进 AppleScript 时做一次转义
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

ORIG_ID=""
MODE=""
CREATE_SCRIPT=$(cat <<'APPLESCRIPT'
tell application "Microsoft Edge"
    set origId to id of window 1
    set wsName to "__WS__"
    set targetUrl to "__URL__"
    if __NEW_WIN__ then
        set newWin to make new window
        set URL of active tab of newWin to targetUrl
        return (origId as string) & "|new-window|" & (id of newWin as string)
    else if wsName is not "" then
        set targetWin to missing value
        repeat with i from 1 to count of windows
            if name of window i is wsName then
                set targetWin to window i
                exit repeat
            end if
        end repeat
        if targetWin is missing value then
            return (origId as string) & "|workspace-not-found|0"
        end if
        tell targetWin
            set newTab to make new tab with properties {URL:targetUrl}
        end tell
        return (origId as string) & "|workspace|" & (id of targetWin as string)
    end if
end tell
APPLESCRIPT
)
# 替换串必须加引号：bash 5.2+ 默认开启 patsub_replacement，未加引号时替换内容里的
# `&` 会被展开成被匹配的占位符本身（URL query 里的 & 变成 __URL__），AppleScript 拿到残缺的 URL。
CREATE_SCRIPT="${CREATE_SCRIPT//__WS__/"$(esc_applescript "$WORKSPACE")"}"
CREATE_SCRIPT="${CREATE_SCRIPT//__URL__/"$(esc_applescript "$URL")"}"
if [ "$NEW_WINDOW" = "1" ]; then
  CREATE_SCRIPT="${CREATE_SCRIPT//__NEW_WIN__/true}"
else
  CREATE_SCRIPT="${CREATE_SCRIPT//__NEW_WIN__/false}"
fi

RETRY=0
while true; do
  RESULT_A=$(osascript -e "$CREATE_SCRIPT" 2>&1) || {
    out_json false ",\"error\":\"osascript failed\",\"detail\":$(printf '%s' "$RESULT_A" | jq -Rs .)"
    exit 4
  }
  [[ "$RESULT_A" =~ ^[0-9]+\|[a-z-]+\|[0-9]+$ ]] || {
    out_json false ",\"error\":\"unexpected applescript output\",\"detail\":$(printf '%s' "$RESULT_A" | jq -Rs .)"
    exit 5
  }
  ORIG_ID="${RESULT_A%%|*}"
  TAIL="${RESULT_A#*|}"
  MODE="${TAIL%%|*}"
  TARGET_ID="${TAIL#*|}"

  if [ "$MODE" = "workspace-not-found" ]; then
    if [ "$AUTO_LAUNCH" = "1" ] && [ "$RETRY" = "0" ]; then
      LAUNCH_RESP=$("${SCRIPT_DIR}/launch-workspace.sh" --name "$WORKSPACE" 2>&1) || true
      if [ "$(printf '%s' "$LAUNCH_RESP" | jq -r '.ok // false')" != "true" ]; then
        out_json false ",\"error\":\"workspace not found and auto-launch failed\",\"workspace\":$(esc "$WORKSPACE"),\"launchDetail\":$(printf '%s' "$LAUNCH_RESP" | jq -Rs .)"
        exit 6
      fi
      RETRY=1
      continue
    fi
    out_json false ",\"error\":\"workspace not found\",\"workspace\":$(esc "$WORKSPACE")"
    exit 6
  fi
  break
done

# --- 接管目标窗口中新创建的 tab ---
# --- 接管目标窗口中新创建的 tab ---
# 由于不再激活窗口，新 tab 是后台 tab；尝试 active:true（当前前台窗口中匹配）和
# active:false（全局 URL 匹配）。active:true 可能找不到，active:false 是主路径。
# 为提高 active:false 的命中率，通过 session 名预先建立该 session 的 tab 记录。
TAB_ID=""
for active_flag in true false; do
  sleep 0.8
  FIND_RESP=$(curl -s -m 10 -X POST "$WB/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"find_tab\",\"args\":{\"url\":${ESC_URL},\"active\":${active_flag}},\"session\":${ESC_SESSION}}" 2>&1) || continue
  if [ "$(printf '%s' "$FIND_RESP" | jq -r '.ok // false')" = "true" ]; then
    TAB_ID=$(printf '%s' "$FIND_RESP" | jq -r '.data.tabId // empty')
    [ -n "$TAB_ID" ] && break
  fi
done

# 若 active:false 全局匹配仍失败，可能是扩展按 session 隔离了 tab 列表；
# 尝试用 active:true 在前台窗口中匹配一次（某些扩展版本对 session 处理不同）。
if [ -z "$TAB_ID" ]; then
  sleep 0.5
  FIND_RESP=$(curl -s -m 10 -X POST "$WB/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"find_tab\",\"args\":{\"url\":${ESC_URL},\"active\":true},\"session\":${ESC_SESSION}}" 2>&1) || true
  if [ "$(printf '%s' "$FIND_RESP" | jq -r '.ok // false')" = "true" ]; then
    TAB_ID=$(printf '%s' "$FIND_RESP" | jq -r '.data.tabId // empty')
  fi
fi

if [ -z "$TAB_ID" ]; then
  # workspace 路径接管失败，回退到默认 navigate + newTab
  NAV_RESP=$(curl -s -m 15 -X POST "$WB/command" -H 'Content-Type: application/json' \
    -d "{\"action\":\"navigate\",\"args\":{\"url\":${ESC_URL},\"newTab\":true},\"session\":${ESC_SESSION}}" 2>&1) || {
    out_json false ",\"error\":\"workspace attach and navigate fallback both failed\",\"workspace\":$(esc "$WORKSPACE")"
    exit 9
  }
  if [ "$(printf '%s' "$NAV_RESP" | jq -r '.ok // false')" != "true" ]; then
    out_json false ",\"error\":\"workspace attach and navigate fallback both failed\",\"workspace\":$(esc "$WORKSPACE")"
    exit 9
  fi
  TAB_ID=$(printf '%s' "$NAV_RESP" | jq -r '.data.tabId // empty')
  NAV_OK=1
  out_json true ",\"tabId\":${TAB_ID:-null},\"mode\":\"navigate-fallback\",\"session\":$(esc "$SESSION")"
  exit 0
fi

NAV_OK=1

# 恢复焦点（默认不抢占；--restore 会把目标窗口前置）
RESTORED="false"
if [ "$RESTORE" = "1" ] && [ "$TARGET_ID" != "0" ]; then
  osascript -e "tell application \"Microsoft Edge\" to set index of window id ${TARGET_ID} to 1" >/dev/null 2>&1 || true
  FRONT_ID=$(osascript -e 'tell application "Microsoft Edge" to get id of window 1' 2>/dev/null || echo "")
  [ "$FRONT_ID" = "$TARGET_ID" ] && RESTORED="true"
fi

out_json true ",\"tabId\":${TAB_ID:-null},\"mode\":\"${MODE}\",\"session\":$(esc "$SESSION"),\"restoredFocus\":${RESTORED},\"targetWindowId\":${TARGET_ID}"
