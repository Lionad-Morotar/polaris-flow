# Claude Provider 维护手册

本手册覆盖 Claude Code 多账号 provider 的全部维护操作：新增、验证、登记进 flow-agent 降级链、修改与删除。本机实际账号名册属私有信息，登记在 `configs/providers.local.md`（不入库），手册示例一律使用占位账号 `alice`。

## 架构总览

三件套：

1. **`~/.cp/<name>.json`**：provider 配置。`env` 块是声明式环境覆盖，经 `--settings` 注入子进程，与交互 shell 的全局环境隔离——每个文件自包含完整配置，不是增量补丁。
2. **`~/.zshrc` 启动器函数**：形如 `ckklal() { _claude_run_with_version 900000 "$HOME/.cp/kimi-k3-alice.json" "ckklal" "$@"; }`。
   - `_claude_run_with_version <window> <json> <name> [args...]` 是统一 wrapper：把 json 写入临时 settings 目录、在子 shell 中注入 env、退出后清理临时目录。
   - `<window>` 是上下文窗口档位：`270000`（kimi k2.7、k3-256k · 27w）/ `900000`（k3、glm、volc、deepseek · 90w）。窗口经 `cc-expand` 解析为对应档位的 patch 版 Claude Code 二进制，27w/90w 二进制已就绪，新增模型复用现有档位即可。
3. **UA 归因**：`ANTHROPIC_CUSTOM_HEADERS` 的 User-Agent 携带 `<user>/<device>/<provider>-<model>-<account缩写>`，服务端按 UA 区分调用来源做用量归因。

## 命名约定

- json 文件：`kimi[-k3[-256k]][-<account>][-highspeed].json`；k2.7 无模型段，k3 两族无高速段，主账号无 account 段；`kimi-alice.json`、`kimi-k3-alice.json`、`kimi-k3-256k-alice.json`
- 启动器函数：`c` + 族前缀（k2.7 为 `k`、k3-256k 为 `kk`、k3 全量为 `kkl`）+ 账号码；高速版加 `h` 后缀。账号码：主账号无后缀；人名账号建议双字母拼音首字母（alice → `al`）；纯数字账号可用尾号短码。k2.7 族若存在历史单字母码可保留、不随新族迁移；示例：`ckal`（k2.7 alice）、`ckalh`（k2.7 高速）、`ckkal`（k3-256k）、`ckklal`（k3 全量）
- UA 标识：`kimi[-k3[-256k]]-<account缩写>[-h]`；`kimi-al`、`kimi-al-h`、`kimi-k3-al`、`kimi-k3-256k-al`
- 模型名：k2.7 为 `kimi-for-coding`（高速 `kimi-for-coding-highspeed`）；k3 全量为 `k3`（1M 上下文）；k3-256k 为 `k3-256k`（同强度、256k 上下文、消耗更低）

zshrc 中函数按窗口档位分区块（`# --- Kimi k2.7 · 27w ---`、`# --- Kimi k3-256k · 27w ---`、`# --- Kimi k3 · 90w ---`），同区块内主账号在前、人名账号随后。注释惯例随区块：k2.7 区块每个人名账号带 `# <name>` 注释，k3 两族区块无注释。每个 provider 在 k2.7 有普通 + 高速两个函数，k3-256k 与 k3 各一个（k3 族无高速变体）。k3 两族的账号码与 UA 缩写保持一致（`ckkal` 的 UA 即 `kimi-k3-256k-al`），启动器键位与归因码对齐。

## 新增 provider 清单

1. **备份**：`cp ~/.zshrc /tmp/zshrc.bak`（json 是新建无需备份）。
2. **按族复制模板**：取同 provider 同族最近的已有 json 作模板——kimi 账号需四份：k2.7 普通、k2.7 高速、k3-256k、k3 全量。不跨族复制：三族的 window、模型名不同；高速版与普通版仅模型名后缀 `-highspeed` 和 UA 后缀 `-h` 不同；k3-256k 与 k3 仅模型名（`k3-256k`/`k3`）、UA 段（`kimi-k3-256k-xx`/`kimi-k3-xx`）和 window 档位不同。
3. **每份改两处**：
   - [ ] `ANTHROPIC_AUTH_TOKEN` → 新账号 token。**向用户索取**，禁止编造、禁止复用其他账号 token。同账号 token 跨模型通用，三份 json 共用同一 token；可用 `jq --arg` 从已填好的 json 注入，避免终端回显 token。
   - [ ] `ANTHROPIC_CUSTOM_HEADERS` 的 UA → 按命名约定改 account 缩写。
4. **zshrc 注册函数**：k2.7 区块加普通 + 高速两个函数（带 `# <name>` 人名注释），k3-256k 与 k3 区块各加一个函数（无注释，双字母账号码）；均追加到对应区块末尾。
5. **验证**：见下节，三项全过才算完成（k2.7 两个函数 + k3-256k 一个 + k3 一个都要验证）。
6. **（可选）登记 flow-agent 降级链**：见下下节。flow-agent 只收录 k3 族模型（k3-256k 与 k3 全量各有独立链），k2.7 函数无需登记。

k2.7（27w）、k3-256k（27w）与 k3（90w）三族都在维护，新 provider 按上表全量补齐，不能只加一族。

## 验证

```bash
# 1. 函数可解析（不用 zsh -i：无 TTY 子进程会触发 powerlevel10k gitstatus 初始化失败，污染 stderr 且可能致 function 加载不全）
zsh -c 'source ~/.zshrc 2>/dev/null; command -v <launcher>'

# 2. json 合法
jq empty ~/.cp/kimi-k3-alice.json

# 3. probe 实测全链路（zsh → cc → binary → API），预期 ~10s 返回 pong
zsh -c 'source ~/.zshrc 2>/dev/null; <launcher> -p "ping (just reply me pong)"'
```

## 登记进 flow-agent 降级链

仅当新 provider 要作为正交审查的备用启动器时执行。账号级启动器统一放**降级链末尾**：新账号未经实战检验，probe 按序试链，尾部位置让它只在前面账号全部故障时兜底。新账号需同时登记进 `kimi-k3`（k3-256k 链）与 `kimi-k3-full`（全量 k3 链）两条链。

启动器链唯一事实源是 `flow-agent/configs/launchers.json`（本机配置，不入库）：在对应模型的 `launchers` 数组末尾追加新启动器即完成登记，脚本（`run-external-review.py` / `preflight.mjs`）运行时读取，文档不含具体启动器名、无需同步。调整链内优先级用 `node flow-agent/scripts/swap-launcher.mjs <A> <B>` 原子交换。

登记后验证：`jq empty flow-agent/configs/launchers.json` 通过，且 `node flow-agent/scripts/preflight.mjs` 报告中对应族 `ok: true`。

## 修改与删除

- **改 token**：直接编辑 json 单字段。
- **删 provider**：先移出 flow-agent 降级链（`configs/launchers.json` 两处数组），再删 zshrc 函数，最后删 json——顺序反过来会留下指向不存在配置的死启动器。
