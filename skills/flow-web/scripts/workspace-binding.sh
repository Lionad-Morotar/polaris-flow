#!/usr/bin/env bash
# 维护 cwd / 站点 / Edge 工作区 三者的绑定关系缓存（v2）。
#
# 绑定以完整 cwd 路径为一级 key。特殊 key "Default" 作为任何 cwd 都未命中时的 fallback。
# 每个条目可包含：
#   - defaultWorkspace: 该 cwd 下未命中具体站点时的默认 workspace
#   - sites:            域名 -> workspace 的覆盖表
#
# 子命令：
#   lookup [--url <url>] [--cwd <cwd>]           查询绑定
#   save --workspace <name> [--url <url>] [--cwd <cwd>]  写入/更新绑定
#   delete [--url <url>] [--cwd <cwd>]           删除绑定
#   list                                         列出所有绑定

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${SCRIPT_DIR}/../configs"
CONFIG_FILE="${CONFIG_DIR}/workspace-bindings.json"

usage() {
  cat <<'USAGE'
Usage:
  workspace-binding.sh lookup [--url <url>] [--cwd <cwd>]
  workspace-binding.sh save --workspace <name> [--url <url>] [--cwd <cwd>]
  workspace-binding.sh delete [--url <url>] [--cwd <cwd>]
  workspace-binding.sh list

Examples:
  # 把当前 cwd 绑定到固定 workspace
  workspace-binding.sh save --workspace "Github | FE Benchmark"

  # 把某个具体站点绑定到另一个 workspace（覆盖 cwd 默认）
  workspace-binding.sh save --url https://investingagents.com --workspace "Investing | Research"

  # 设置全局 fallback workspace
  workspace-binding.sh save --cwd Default --workspace "Personal"
USAGE
}

ensure_config() {
  mkdir -p "$CONFIG_DIR"
  if [ ! -f "$CONFIG_FILE" ]; then
    echo '{"version":2,"bindings":{}}' > "$CONFIG_FILE"
  fi
}

# 从 URL 提取域名
extract_site() {
  python3 -c 'from urllib.parse import urlparse; import sys; print(urlparse(sys.argv[1]).hostname or "")' "$1"
}

# 规范化 cwd：Default 保持原样，其他转成绝对真实路径
normalize_cwd() {
  local cwd="$1"
  if [ "$cwd" = "Default" ]; then
    printf '%s' "$cwd"
  else
    (cd "$cwd" && pwd -P)
  fi
}

out_json() {
  printf '%s\n' "$1"
}

# 读取配置文件并处理 v1 -> v2 迁移（一次性）。迁移规则：
#   旧 bindings[project][site] -> 无法反推完整 cwd，直接丢弃，保留空 v2 结构。
#   用户后续重新绑定即可。
migrate_if_needed() {
  local version
  version=$(jq -r '.version // 1' "$CONFIG_FILE")
  if [ "$version" = "1" ]; then
    local tmp
    tmp=$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")
    echo '{"version":2,"bindings":{}}' > "$tmp"
    mv "$tmp" "$CONFIG_FILE"
  fi
}

# 查询顺序：cwd/site -> cwd/default -> 祖先目录（逐级向上，每级 site -> default，就近优先）-> Default/site -> Default/default
# 祖先回退让 monorepo 根目录的绑定自动覆盖其下所有子目录（如 git submodule），无需逐个绑定。
cmd_lookup() {
  local url="" cwd=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --url) url="$2"; shift 2;;
      --cwd) cwd="$2"; shift 2;;
      *) usage; exit 2;;
    esac
  done
  cwd="${cwd:-$(pwd)}"

  ensure_config
  migrate_if_needed

  local key site
  key=$(normalize_cwd "$cwd")
  site=""
  [ -n "$url" ] && site=$(extract_site "$url")

  local workspace="" matchType="" sourceKey="" viaAncestor="false"

  # 1. cwd -> site
  if [ -n "$site" ]; then
    workspace=$(jq -r --arg k "$key" --arg s "$site" '
      .bindings[$k].sites[$s].workspace // empty
    ' "$CONFIG_FILE" 2>/dev/null || true)
    if [ -n "$workspace" ]; then
      matchType="site"
      sourceKey="$key"
    fi
  fi

  # 2. cwd -> default
  if [ -z "$workspace" ]; then
    workspace=$(jq -r --arg k "$key" '
      .bindings[$k].defaultWorkspace // empty
    ' "$CONFIG_FILE" 2>/dev/null || true)
    if [ -n "$workspace" ]; then
      matchType="default"
      sourceKey="$key"
    fi
  fi

  # 3. 祖先目录逐级向上（就近优先），每级先 site 后 default
  if [ -z "$workspace" ] && [ "$key" != "Default" ]; then
    local ancestor="$key"
    while [ -z "$workspace" ]; do
      local parent="${ancestor%/*}"
      [ -n "$parent" ] || parent="/"
      [ "$parent" != "$ancestor" ] || break
      ancestor="$parent"
      if [ -n "$site" ]; then
        workspace=$(jq -r --arg k "$ancestor" --arg s "$site" '
          .bindings[$k].sites[$s].workspace // empty
        ' "$CONFIG_FILE" 2>/dev/null || true)
        if [ -n "$workspace" ]; then
          matchType="site"
          sourceKey="$ancestor"
          viaAncestor="true"
          break
        fi
      fi
      workspace=$(jq -r --arg k "$ancestor" '
        .bindings[$k].defaultWorkspace // empty
      ' "$CONFIG_FILE" 2>/dev/null || true)
      if [ -n "$workspace" ]; then
        matchType="default"
        sourceKey="$ancestor"
        viaAncestor="true"
        break
      fi
    done
  fi

  # 4. Default -> site
  if [ -z "$workspace" ] && [ -n "$site" ]; then
    workspace=$(jq -r --arg s "$site" '
      .bindings["Default"].sites[$s].workspace // empty
    ' "$CONFIG_FILE" 2>/dev/null || true)
    if [ -n "$workspace" ]; then
      matchType="site"
      sourceKey="Default"
    fi
  fi

  # 5. Default -> default
  if [ -z "$workspace" ]; then
    workspace=$(jq -r '
      .bindings["Default"].defaultWorkspace // empty
    ' "$CONFIG_FILE" 2>/dev/null || true)
    if [ -n "$workspace" ]; then
      matchType="default"
      sourceKey="Default"
    fi
  fi

  if [ -n "$workspace" ]; then
    out_json "{\"found\":true,\"cwd\":$(printf '%s' "$key" | jq -Rs .),\"sourceKey\":$(printf '%s' "$sourceKey" | jq -Rs .),\"matchType\":$(printf '%s' "$matchType" | jq -Rs .),\"viaAncestor\":$viaAncestor,\"site\":$(printf '%s' "$site" | jq -Rs .),\"workspace\":$(printf '%s' "$workspace" | jq -Rs .)}"
  else
    out_json "{\"found\":false,\"cwd\":$(printf '%s' "$key" | jq -Rs .),\"site\":$(printf '%s' "$site" | jq -Rs .)}"
  fi
}

cmd_save() {
  local url="" workspace="" cwd=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --url) url="$2"; shift 2;;
      --workspace) workspace="$2"; shift 2;;
      --cwd) cwd="$2"; shift 2;;
      *) usage; exit 2;;
    esac
  done
  [ -n "$workspace" ] || { usage; exit 2; }
  cwd="${cwd:-$(pwd)}"

  ensure_config
  migrate_if_needed

  local key site
  key=$(normalize_cwd "$cwd")
  site=""
  [ -n "$url" ] && site=$(extract_site "$url")

  local now
  now=$(date +"%Y-%m-%dT%H:%M:%S%z")

  local tmp
  tmp=$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")

  if [ -n "$site" ]; then
    jq --arg k "$key" --arg s "$site" --arg w "$workspace" --arg t "$now" '
      (.bindings[$k] // {}) as $entry |
      .bindings[$k] = ($entry + {"sites": (($entry.sites // {}) + {$s: {"workspace": $w, "updatedAt": $t}})})
    ' "$CONFIG_FILE" > "$tmp"
  else
    jq --arg k "$key" --arg w "$workspace" --arg t "$now" '
      (.bindings[$k] // {}) as $entry |
      .bindings[$k] = ($entry + {"defaultWorkspace": $w, "updatedAt": $t})
    ' "$CONFIG_FILE" > "$tmp"
  fi

  mv "$tmp" "$CONFIG_FILE"

  # 同步缓存 workspace 名称到 UUID 的映射
  "${SCRIPT_DIR}/workspace-uuid.sh" get --name "$workspace" > /dev/null 2>&1 || true

  if [ -n "$site" ]; then
    out_json "{\"ok\":true,\"cwd\":$(printf '%s' "$key" | jq -Rs .),\"site\":$(printf '%s' "$site" | jq -Rs .),\"workspace\":$(printf '%s' "$workspace" | jq -Rs .),\"updatedAt\":$(printf '%s' "$now" | jq -Rs .)}"
  else
    out_json "{\"ok\":true,\"cwd\":$(printf '%s' "$key" | jq -Rs .),\"defaultWorkspace\":$(printf '%s' "$workspace" | jq -Rs .),\"updatedAt\":$(printf '%s' "$now" | jq -Rs .)}"
  fi
}

cmd_delete() {
  local url="" cwd=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --url) url="$2"; shift 2;;
      --cwd) cwd="$2"; shift 2;;
      *) usage; exit 2;;
    esac
  done
  cwd="${cwd:-$(pwd)}"

  ensure_config
  migrate_if_needed

  local key site
  key=$(normalize_cwd "$cwd")
  site=""
  [ -n "$url" ] && site=$(extract_site "$url")

  local tmp
  tmp=$(mktemp "${CONFIG_FILE}.tmp.XXXXXX")

  if [ -n "$site" ]; then
    jq --arg k "$key" --arg s "$site" 'del(.bindings[$k].sites[$s])' "$CONFIG_FILE" > "$tmp"
  else
    jq --arg k "$key" 'del(.bindings[$k])' "$CONFIG_FILE" > "$tmp"
  fi

  mv "$tmp" "$CONFIG_FILE"

  if [ -n "$site" ]; then
    out_json "{\"ok\":true,\"deleted\":true,\"cwd\":$(printf '%s' "$key" | jq -Rs .),\"site\":$(printf '%s' "$site" | jq -Rs .)}"
  else
    out_json "{\"ok\":true,\"deleted\":true,\"cwd\":$(printf '%s' "$key" | jq -Rs .)}"
  fi
}

cmd_list() {
  ensure_config
  migrate_if_needed
  jq '.' "$CONFIG_FILE"
}

# --- main ---
[ $# -ge 1 ] || { usage; exit 2; }
CMD="$1"; shift

case "$CMD" in
  lookup) cmd_lookup "$@";;
  save)   cmd_save "$@";;
  delete) cmd_delete "$@";;
  list)   cmd_list "$@";;
  -h|--help) usage; exit 0;;
  *) usage; exit 2;;
esac
