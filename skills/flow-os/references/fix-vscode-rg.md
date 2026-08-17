# VSCode 系编辑器内置 rg 超时包装手册

给 VSCode 及其衍生品（Qoder / Cursor / Trae 等基于 VSCode 的编辑器）内置 rg（ripgrep）加超时包装，防止搜索卡死吃满 CPU。

用 `npx -y @lionad/bin-timeout-wrapper` 实现：将原 `rg` 重命名为 `rg_backup`，原位生成带 `alarm` 超时的 shell wrapper，可还原。

## 症状分诊（用户以"CPU 高 / 搜索卡死"等描述调用时）

不要默认 rg 是元凶——先查进程实况：

```sh
command ps -eo pid,%cpu,etime,args | awk 'NR==1 || /ripgrep-universal/ && !/awk/' | head
```

- **有 rg 进程在跑且 CPU 高** → 正常流程（`--kill` 止血 + `--on` 补防线），明确告知用户已处理。
- **`--kill` 后进程仍在**（实测 2026-08 遇到过）→ `pkill -f '/@vscode/ripgrep-universal/bin/.*/rg'` 对**早已 spawn 的失控进程可能失效**（信号未送达，疑似进程被某种隔离机制遮挡）。此时**降级到按 PID 直杀**：从上面 `ps` 输出取 PID，先 `kill -TERM <pid>`，2s 后仍存活再 `kill -9 <pid>`。根因是替换磁盘二进制只影响未来 spawn 的新进程，已在内存里运行的旧映像（这里是 `rg_backup`）对改名/替换无感，要么自己跑完要么被 SIGKILL。
- **没有任何 rg 进程** → 如实告知：本次 CPU 与 rg 无关。仍可 `--on` 补超时防线（wrapper 常被编辑器更新覆盖），但**不要声称"已修复 CPU 问题"**。已知其他元凶：ccstatusline（2026-07 实测确诊过一次）。

## 参数

- `--on`：给所有发现的内置 rg 加超时包装（幂等，已包装则跳过）。**默认行为。**
- `--off`：还原所有发现的内置 rg，移除 wrapper。
- `--kill`：杀掉当前所有运行中的 rg 进程（先 `pkill`，3s 后不退出再 `pkill -9`）。可与 `--on`/`--off` 组合。
- `--timeout N`：自定义超时秒数，默认 `5`。
- 不带参数：发现所有内置 rg 并显示包装状态。

## 前置条件

macOS Sequoia+ 的 TCC「应用管理 / App Management」保护会拦截写入 `/Applications` 下 app bundle 的操作（owner 是自己也拦，**sudo 也不行**）。操作前会自动检测授权：

```sh
D="/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/darwin-arm64"
touch "$D/.test" 2>/dev/null && echo OK && rm -f "$D/.test"
```

若未输出 `OK`（提示 `Operation not permitted`）：

1. 系统设置 → 隐私与安全性 → **应用管理**
2. 点「+」添加启动当前终端的 app（Terminal / iTerm / Warp / Ghostty / Kitty 等）
3. 启用开关，重新测试

## 发现所有内置 rg

自动扫描 `/Applications` 下所有匹配 `@vscode/ripgrep-universal/bin/*/rg` 的二进制：

```sh
RGS=$(command find /Applications -maxdepth 10 -path '*@vscode/ripgrep-universal/bin/*/rg' -type f 2>/dev/null | command sort -u)
[ -z "$RGS" ] && echo "未找到内置 rg" || echo "$RGS"
```

覆盖 VSCode Stable / Insiders / Qoder / Cursor / Trae 等基于 VSCode 的编辑器。

## 完整执行脚本

根据用户参数组合执行。以下脚本可直接粘贴运行：

```sh
#!/bin/bash
set -euo pipefail

MODE="on"
TIMEOUT=5
KILL=false

# 解析参数
NEXT_IS_TIMEOUT=false
for arg in "$@"; do
  if [ "$NEXT_IS_TIMEOUT" = true ]; then
    TIMEOUT="$arg"
    NEXT_IS_TIMEOUT=false
    continue
  fi
  case "$arg" in
    --on) MODE="on" ;;
    --off) MODE="off" ;;
    --kill) KILL=true ;;
    --timeout) NEXT_IS_TIMEOUT=true ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# 发现所有内置 rg
RGS=$(command find /Applications -maxdepth 10 -path '*@vscode/ripgrep-universal/bin/*/rg' -type f 2>/dev/null | command sort -u)

if [ -z "$RGS" ]; then
  echo "未在 /Applications 下找到内置 rg"
  exit 0
fi

# 检测 App Management 授权（取第一个 rg 所在目录做写入测试）
FIRST_RG=$(echo "$RGS" | command head -1)
TEST_DIR=$(command dirname "$FIRST_RG")
if ! touch "$TEST_DIR/.fix-vscode-rg-test" 2>/dev/null; then
  echo "错误：无法写入 $TEST_DIR"
  echo "macOS Sequoia+ 需要给当前终端授予「应用管理」权限："
  echo "系统设置 → 隐私与安全性 → 应用管理 → 添加当前终端 app（Terminal / iTerm / Warp / Ghostty / Kitty 等）"
  exit 1
fi
rm -f "$TEST_DIR/.fix-vscode-rg-test"

# 先止血：杀掉卡死的 rg
if [ "$KILL" = true ]; then
  echo "==> 正在终止 rg 进程..."
  pkill -f '/@vscode/ripgrep-universal/bin/.*/rg' 2>/dev/null || true
  sleep 3
  pkill -9 -f '/@vscode/ripgrep-universal/bin/.*/rg' 2>/dev/null || true
  echo "==> rg 进程已清理"
fi

# 批量处理（用 here-string 兼容路径中的空格，适配 macOS bash 3.2）
while IFS= read -r RG; do
  [ -z "$RG" ] && continue
  echo "=== $RG ==="
  case "$MODE" in
    on)
      if npx -y @lionad/bin-timeout-wrapper --status -- "$RG" 2>&1 | command grep -q "^Status: wrapped"; then
        echo "已 wrapped，跳过"
      else
        npx -y @lionad/bin-timeout-wrapper --timeout "$TIMEOUT" -- "$RG"
      fi
      ;;
    off)
      npx -y @lionad/bin-timeout-wrapper --restore -- "$RG"
      ;;
    *)
      npx -y @lionad/bin-timeout-wrapper --status -- "$RG"
      ;;
  esac
done <<< "$RGS"

# 验证第一个 rg 的超时生效
if [ "$MODE" = "on" ]; then
  echo "=== 验证超时 ==="
  set +e
  BIN_TIMEOUT=1 "$FIRST_RG" --files /System >/dev/null 2>&1
  EXIT_CODE=$?
  set -e
  echo "exit=$EXIT_CODE (期望 137)"
fi
```

## 验证超时生效

单独验证某一条路径：

```sh
RG="<rg-path>"
BIN_TIMEOUT=1 "$RG" --files /System >/dev/null 2>&1; echo "exit=$? (期望 137)"
```

`exit=137`（128+9 SIGKILL）表示超时杀进程生效。编辑器无需重启——每次搜索按需 spawn rg，下次 `Ctrl+Shift+F` 即走 wrapper。

## 失效与重包

编辑器每次更新可能会在 rg 包版本变化时用原始二进制覆盖 wrapper。**更新后若搜索又卡死，重新 `--on` 即可。**

## 为什么不用 search.rgPath

VSCode **不支持** `search.rgPath` setting——app bundle 全文 0 命中，rg 路径硬编码从 `@vscode/ripgrep-universal` 解析。在 settings.json 配它无效。只能改 app bundle 内的 rg 本身，这也是本手册的原理。

## 自动巡检（rg-wrap-guard）

人工 `--on` 之外另有一道 launchd 定时巡检：登录时跑一次、此后每整点检测所有内置 rg 是否仍处于包装态，发现未包装即弹系统通知，提醒回来执行本手册。只告警、不自动改二进制——修复保留上面的验证流程。

- 脚本（全部逻辑、路径、通知文案都在这里，就近维护）：`scripts/rg-wrap-guard.sh`
- 瘦 plist（launchd 只从 `~/Library/LaunchAgents/` 加载，故仅此一个指针文件散在外面）：`~/Library/LaunchAgents/com.example.rg-wrap-guard.plist`
- 日志：`~/logs/rg-wrap-guard/guard.log`（巡检记录）、`launchd-std{out,err}.log`（launchd 捕获）

检测原理与包装产物一致：`rg_backup` 兄弟文件存在 且 `rg` 本体非 Mach-O，任一不满足即判失效。发现用的 `find` 通配与上文「发现所有内置 rg」完全相同——路径自适应，绝不写死。

历史教训：旧的 `com.example.wrap-vscode-rg` 把 rg 路径硬编码成 `@vscode/ripgrep`，VSCode 迁移到 `@vscode/ripgrep-universal` 后找不到文件、静默 SKIP 了 6 周（防线死了无人知晓；其 plist 已退役备份为 `.bak`）。本巡检因此绝不写死路径；若上文 find 通配日后变更，须同步修改 `rg-wrap-guard.sh`，两者必须一致。

手动触发与运维：

```sh
UID_=$(id -u)
launchctl kickstart "gui/$UID_/com.example.rg-wrap-guard"    # 立即巡检一次
launchctl list | grep rg-wrap-guard                          # 看状态（上次退出码应为 0）
tail ~/logs/rg-wrap-guard/guard.log                          # 看巡检记录

# 卸载
launchctl bootout "gui/$UID_/com.example.rg-wrap-guard"
rm ~/Library/LaunchAgents/com.example.rg-wrap-guard.plist

# 重装（改了脚本或 plist 后）
launchctl bootout "gui/$UID_/com.example.rg-wrap-guard" 2>/dev/null
launchctl bootstrap "gui/$UID_" ~/Library/LaunchAgents/com.example.rg-wrap-guard.plist
```
