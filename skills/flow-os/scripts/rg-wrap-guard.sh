#!/bin/bash
# rg-wrap-guard.sh — 每整点巡检 VSCode 系编辑器内置 rg 是否仍处于超时包装状态。
#
# 由 launchd 触发：~/Library/LaunchAgents/com.example.rg-wrap-guard.plist（登录跑一次 + 每小时 :00）。
# 发现任何内置 rg 未被包装 → 弹系统通知，提醒回来执行 /flow-os fix-vscode-rg（人工确认后走手册修复）。
# 只检测、只告警，不自动改任何二进制——修复保留手册的验证流程。
#
# 检测原理（与 references/fix-vscode-rg.md 的包装产物一致）：
#   bin-timeout-wrapper 包装时把原 rg 改名为 rg_backup，并把 rg 本体替换成 shell wrapper。
#   故「已包装」⟺ 存在 rg_backup 兄弟文件 且 rg 本体不再是 Mach-O 二进制。
#   任一条件不满足即判防线失效（原始 rg 已复活，可能再次吃满 CPU）。
#
# 路径自适应：用与手册相同的 find 通配发现 rg，绝不写死路径——
#   这正是旧 com.example.wrap-vscode-rg 的死因：它硬编码 @vscode/ripgrep 旧路径，VSCode 迁移到
#   @vscode/ripgrep-universal 后找不到文件、静默 SKIP 了 6 周。若手册的 find 通配日后变更，请同步此处。
#
# 测试钩子（默认值即生产值，便于不触碰真实 rg 做端到端验证）：
#   RG_GUARD_SCAN_ROOT  发现根目录，默认 /Applications
#   RG_GUARD_LOG_DIR    日志目录，默认 $HOME/logs/rg-wrap-guard
set -euo pipefail

# launchd 环境极简，显式给定干净 PATH（本脚本只用系统自带工具，不依赖 node/npx）
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

SCAN_ROOT="${RG_GUARD_SCAN_ROOT:-/Applications}"
LOG_DIR="${RG_GUARD_LOG_DIR:-${HOME:?HOME or RG_GUARD_LOG_DIR required}/logs/rg-wrap-guard}"
LOG_FILE="$LOG_DIR/guard.log"
NOTIFY_TITLE="rg 防线失效"

mkdir -p "$LOG_DIR"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }

# 自适应发现所有内置 rg（通配与 references/fix-vscode-rg.md 完全一致）
RGS="$(find "$SCAN_ROOT" -maxdepth 10 -path '*@vscode/ripgrep-universal/bin/*/rg' -type f 2>/dev/null | sort -u || true)"

if [ -z "$RGS" ]; then
  log "WARN 未在 ${SCAN_ROOT} 下发现任何内置 rg（编辑器被卸载/路径布局变更？请核对 find 通配）"
  exit 0
fi

UNWRAPPED=""
while IFS= read -r RG; do
  [ -z "$RG" ] && continue
  # 已包装 ⟺ 有 rg_backup 兄弟 且 rg 本体非 Mach-O；两个条件任一不满足即失效
  if [ ! -e "${RG}_backup" ] || file "$RG" 2>/dev/null | grep -q 'Mach-O'; then
    UNWRAPPED="${UNWRAPPED}${RG}"$'\n'
  fi
done <<< "$RGS"

if [ -n "$UNWRAPPED" ]; then
  COUNT="$(printf '%s' "$UNWRAPPED" | grep -c . || true)"
  log "ALERT 发现 ${COUNT} 个未包装 rg："
  printf '%s' "$UNWRAPPED" | sed 's/^/    /' >> "$LOG_FILE"
  # 通知风格沿用 com.example.remind.qoder-reset（display notification + sound default）
  osascript -e "display notification \"检测到 ${COUNT} 个内置 rg 未被超时包装，搜索可能再次卡死 CPU。请回来执行 /flow-os fix-vscode-rg\" with title \"${NOTIFY_TITLE}\" sound name \"default\"" >/dev/null 2>&1 \
    || log "WARN 通知发送失败（osascript 返回非零）"
  exit 0
fi

log "OK 全部内置 rg 均已包装"
exit 0
