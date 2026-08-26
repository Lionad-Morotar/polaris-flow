# flow-agent 模型映射与选择规则

本文件定义 `flow-agent` 支持的模型、caller 模型识别方式，以及 `--effort` 选择规则。模型→启动器链（含降级顺序与默认超时）是本机配置，唯一事实源为 `configs/launchers.json`（不入库，模板见 `configs/launchers.example.json`），本文不重复列举。

## 支持模型与启动器

- `kimi-k3`：k3-256k 档位，light 审查默认；默认超时 1800s
- `kimi-k3-full`：全量 k3·1M 上下文档位，`--deep` 或显式指定时使用；默认超时 1800s
- `glm-5.3`：默认超时 1800s
- `glm-5.3-flash`：默认超时 1800s
- `qwen-3.8-max`：默认超时 1800s
- `deepseek-v4-flash`：默认超时 1800s
- `minimax-m3`：默认超时 1800s

各模型的启动器名册（zsh launcher function，数组顺序即降级优先级）见 `configs/launchers.json`。启动器命名约定建议为 `c` + provider 前缀 + 账号/渠道后缀，便于按降级顺序组织：直连主账号在前，备用渠道（第二 provider、第二账号）依次在后。

`kimi-k3` 与 `kimi-k3-full` 同族：`k3` 的 256k 与 1M 两个上下文档位，强度等同。`glm-5.3` 与 `glm-5.3-flash` 同族：同厂同系的全量与轻量档，训练数据和对齐高度同源。两族均按审查模式选档：默认（light 审查）走低消耗档（`kimi-k3` / `glm-5.3-flash`），`--deep` 深入审查或显式 `--target-model` 指定强档时走 `kimi-k3-full`（全量 `k3`·1M 上下文）/ `glm-5.3`。同族不重复：审查集合内同族只保留一个档位，caller 同族成员也不作为正交视角。

## 识别 caller 模型

`flow-agent` 按以下顺序确定主代理模型：

1. 若显式传入 `--caller-model`，直接使用；
2. 否则从 `--task` 文本中匹配模型名：
   - 出现 `glm-5.3-flash`、`glm-flash` 或 `cgf` → `glm-5.3-flash`；
   - 出现 `glm-5.3` 或 `glm` → `glm-5.3`；
   - 出现 `kimi-k3-full`，或 caller 明确运行于全量 k3 → `kimi-k3-full`；
   - 出现 `kimi-k3`、`k3-256k` 或 `kimi` → `kimi-k3`；
   - 出现 `qwen-3.8-max`、`qwen` → `qwen-3.8-max`；
   - 出现 `deepseek-v4-flash`、`deepseek-flash`、`dsf`、`deepseek`、`ds` → `deepseek-v4-flash`；
   - 出现 `minimax-m3`、`minimax`、`m3` → `minimax-m3`；
   - 出现 `Claude Code`、`claude` 或未匹配 → 默认 `glm-5.3`（作为未识别占位，记录时保持 `glm-5.3`，但实现侧应提示 caller 显式传入 `--caller-model`）。

匹配不区分大小写，优先匹配最长/最具体的模型名。

**注意**：Claude Code 本身不在 `flow-agent` 支持的目标模型列表中，无法被启动来审查。当主代理实为 Claude Code 时，建议调用方显式传入 `--caller-model`，否则正交选择可能偏离预期。

## `--effort` 选择规则（`--target-model auto` 时）

`flow-agent` 根据 caller 模型和 `--effort` 决定要启动哪些非 caller 模型。

- `normal`：启动一个反选模型；caller 为 glm-5.3 `kimi-k3`；caller 为 glm-5.3-flash `kimi-k3`；caller 为 kimi-k3 `glm-5.3`；caller 为 qwen-3.8-max `glm-5.3`；caller 为 deepseek-v4-flash `glm-5.3`；caller 为 minimax-m3 `glm-5.3`
- `max`：反选 + deepseek；caller 为 glm-5.3 `kimi-k3` + `deepseek-v4-flash`；caller 为 glm-5.3-flash `kimi-k3` + `deepseek-v4-flash`；caller 为 kimi-k3 `glm-5.3` + `deepseek-v4-flash`；caller 为 qwen-3.8-max `glm-5.3` + `deepseek-v4-flash`；caller 为 deepseek-v4-flash `glm-5.3` + `kimi-k3`；caller 为 minimax-m3 `glm-5.3` + `kimi-k3`
- `ultra`：除 caller 族外的其余各族各一员
- `fable`：全部 5 族各一员（含 caller 所在档位）

表中的 kimi 与 GLM 档位按审查模式切换：light（默认）为 `kimi-k3`（k3-256k）/ `glm-5.3-flash`（低消耗档）；`--deep` 深入审查把集合中的低耗档整体升级为强档（`kimi-k3-full` 全量 k3·1M / `glm-5.3`）。`fable` 档含 caller 本身，但 caller 的同族自审条目保持原档位不升级；caller 同族的另一档位不重复计入。

## `--target-model` 覆盖

`flow-agent` 支持 `--target-model <model>|auto`：

- `--target-model auto`（默认）：按上表根据 `--effort` 自动选择；
- `--target-model kimi-k3`：强制只启动 `kimi-k3`；
- `--target-model kimi-k3-full`：强制只启动全量 `k3`；
- `--target-model glm-5.3`：强制只启动 `glm-5.3`；
- `--target-model glm-5.3-flash`：强制只启动 `glm-5.3-flash`；
- `--target-model qwen-3.8-max`：强制只启动 `qwen-3.8-max`；
- `--target-model deepseek-v4-flash`：强制只启动 `deepseek-v4-flash`；
- `--target-model minimax-m3`：强制只启动 `minimax-m3`。

强制覆盖仅在明确需要复现或避开某个模型时使用。

### 自审检查

若 `--target-model` 显式指定为与 `--caller-model` 相同的模型，`flow-agent` 必须拒绝或告警，不执行该自审请求。正交审查的核心价值在于异模型视角，自审会静默破坏这一前提。同族视为自审：`kimi-k3` 与 `kimi-k3-full` 是同一模型的两个上下文档位，`glm-5.3` 与 `glm-5.3-flash` 是同厂同系的全量与轻量档；显式 target 与 caller 同族时同样拒绝。实现侧可返回错误：

```
target-model cannot equal caller-model: <model>
```

`--target-model auto` 永远不会选中 caller 自身，因此无需额外检查。

## 启动器降级

单个模型失败后，按 `configs/launchers.json` 中该模型的 launchers 数组顺序依次重试：首选（数组首位）失败则依次尝试后续备用，全部失败才标记 `degraded`。

跨模型不重试：`--effort` 已经决定了要审查的模型集合，一个模型失败不影响其他模型继续执行。
