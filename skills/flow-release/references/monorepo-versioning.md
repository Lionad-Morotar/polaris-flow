# Monorepo 版本策略与发版变更矩阵

本文档两件事：一是澄清 monorepo 版本化的三种范式（fixed / linked / independent）的语义与识别方法；二是定义 monorepo 发版的「变更矩阵」流程——在动 Changelog 之前先给用户看全貌：距上次发布哪些包有变化、依赖关系如何、各该怎么 bump。

## 版本策略三范式

### fixed / locked / lockstep：同一范式的不同叫法

组内所有包共享一个版本号，bump 一个即全体 bump。这个范式在不同工具里是**同义术语，不是不同策略**：

| 工具 | 叫法 | 形态 |
|-----|------|------|
| Lerna | fixed mode（默认） | lerna.json 根部共享版本 |
| Rush | lockStepVersion | versionPolicy lockstep |
| changesets | `fixed` 数组 | .changeset/config.json 分组 |

changesets 官方语义：fixed 组任一成员 bump 时**所有成员同时 bump 并发布**，即使某成员没有任何实际变更[^changesets-fixed]。

- 适合场景：强耦合产品族，兼容性是用户第一关切——UI 套件全家桶（组件 + 主题 + 图标）、AWS SDK v2 式套件、按 release train 整体发版的产品
- 优势：兼容性不言自明（同号即可互配）；排查只问一个版本号；一套 changelog 与发布仪式
- 劣势：**版本号通胀**——一个包的 hotfix 让全部包跟着升，未变更包发出虚假变更信号；major 政治成本高——任一角 breaking 就全员 major，团队倾向拖延 major 导致 semver 停滞；要求所有包随时可发布，一个包构建坏掉可能阻塞整列火车

### linked：有条件联动（changesets 特有）

官方语义：组内某包收到 changeset 时，持有 changeset 的成员统一对齐到「组内当前最高版本 + 组内最高 bump 级别」；**没有 changeset 的成员不 bump 也不发布**[^changesets-linked]。

- 适合场景：变更时须保持互配、但不想给未变更包刷空版本的组——react/react-dom 式核心对、需要同步迭代的适配器家族
- 优势：变更时版本收敛、兼容语义保留；未变更成员零噪音
- 劣势：两次发版之间版本仍会漂移（连续两轮只改同一个包）；用户看到组内版本号不一致仍会困惑；规则绕，维护者认知成本高

### independent：不联动（changesets 默认）

各包按自身变更 bump，版本互不同步。

- 适合场景：各包 lifecycle 独立——工具包稳定早、功能包迭代快并存；用户只安装部分包；开源生态（Babel、Vite 生态）
- 优势：版本号诚实（bump = 真有变更）；稳定包零噪音；各包按需出 major
- 劣势：兼容矩阵转嫁给消费方（哪版配哪版靠 `workspace:^` / peerDeps 范围声明兜底）；跨包 breaking 缺统一信号；逐包 changelog/tag 账目增多（changesets 类工具可消化）

### 策略选择参考

- 用户更关心「套件整体版本」而非「哪个包变了」→ fixed
- 核心包族变更时须互配、但迭代节奏不一 → 核心族 linked，外围适配器 independent
- 各包有自己的消费方与迭代节奏 → independent（本技能默认形态：发布脚本幂等跳过已发版本，天然支持「只发有变化的包」）
- 从 independent 切 fixed/linked 前想清楚：历史版本号不同的包进组瞬间会被拉到组内最高版本，这是一次性的版本号跳变

## 是否引入版本工具（changesets / lerna）

项目已用版本工具的从其约定（preflight 识别 release 脚本形态）；**不主动为无版本工具的项目引入**——changesets 的三个产出（哪些包变了、bump 级别、changelog 素材）已被发版变更矩阵 + 第 3 步 Changelog 确认覆盖，引入等于同一份信息写两遍：changeset 声明文件一遍、changelog 确认一遍。

原生路径（无版本工具）的完整覆盖：

- bump：按矩阵确认结果逐包 `npm version <级别|x.y.z> --no-git-tag-version`
- 发布：依赖序顺序发布 + 幂等跳过（已发布版本自动跳过）——「只发有变化的包」由幂等性达成，不依赖 changesets 托管

changesets 才是对的选择的场景（项目已用则沿用；未用但命中以下场景才考虑引入）：

- 多人人类团队协作、PR 纪律存在——changesets 的核心循环是 PR-based：每个 PR 附 changeset 声明，changesets/action 聚合成 Version Packages PR，合并即 bump + changelog + publish
- 需要 `fixed` / `linked` 版本组语义（changesets 独家干净提供）
- 要 GitHub Actions 全自动版本 PR 与发布

trunk-based、无 PR、代理驱动的发版流程中，changesets 的自动化循环不可用，只剩手写 changeset 文件的仪式，引入无收益；lerna 同理。

## 策略识别（探测项目既有策略）

识别顺序，可靠者优先：

1. **tag 形态**（反映真实发版行为，比配置可靠）：仓级 `v<version>` → 统一版本；逐包 `<pkg>@<version>` → 独立版本。monorepo 改造遗留可能两形态并存（早期仓级 tag + 后期包级 tag），以最近的 tag 为准
2. **配置文件**：changesets `.changeset/config.json` 的 `fixed` / `linked` 数组（皆空 = independent）；lerna.json `version` 字段（`"independent"` vs 具体版本号）；Rush versionPolicy
3. **发布脚本形态**：`changeset publish`（changesets 托管 bump）vs 逐包顺序发布脚本 + 幂等跳过（手工 bump + 独立发版）
4. **版本分布**：各包当前版本横切对比——已分叉（如同系列 alpha.10 / alpha.11 / alpha.17 并存）是 independent 的直接证据

## 发版变更矩阵（monorepo 在 SKILL.md 第 3 步 Changelog 前执行）

目的：版本决策前给用户一张全貌表——哪些包距上次发布有变化、依赖长什么样、各该怎么 bump——避免漏 bump、错 bump、给未变更的包白 bump。

### A. 逐包变更检测

以各包最近 tag 为起点统计其目录内变更：

```bash
# 各包最近 tag（无输出 = 未发布过的新包，按首发处理，变更范围取全部 git 历史）
git tag --list "<pkg>@*" --sort=-v:refname | head -1

# 距上次发布的变更提交
git log "<pkg>@<version>..HEAD" --oneline -- <pkg-dir>

# conventional commit 分类统计（feat/fix/breaking 计数，供 bump 建议）
git log "<pkg>@<version>..HEAD" --format=%s -- <pkg-dir>
```

### B. 依赖图

解析各包 package.json 的 dependencies / devDependencies / peerDependencies 中指向仓内包的 `workspace:*` 依赖，构建有向图，按拓扑序呈现（被依赖者在前）。简化示意：

```
definition ← stream ← vue ← comps ← comps-{element-plus,naive-ui,nuxt-ui-v2,nuxt-ui-v4,vtu,tanstack-charts}
                             └← nuxt
```

### C. bump 建议规则

| 包状态 | 建议 |
|--------|------|
| 有变更，含 breaking | major |
| 有变更，含 feat | minor |
| 有变更，仅 fix/chore | patch |
| 无变更，但依赖了有变更的包 | 默认不 bump：`workspace:^` 范围下消费方 install 时自动解析到新版本；范围锁死（`workspace:~` 或精确锁定）或用户要求刷新依赖声明时建议 patch |
| 无变更，与变更包无关 | skip（发布脚本幂等跳过） |
| private 包 | 不进矩阵（preflight 发布清单已分列） |
| 无 tag（未发布新包） | 首发，版本由用户指定或从 0.1.0 起步 |

项目使用 changesets 且有 changeset 记录时，以 changeset 声明的 bump 级别为准，上表规则作兜底。

### D. 矩阵输出模板

呈现给用户确认，确认/调整后才进入第 3 步 Changelog（确认后的变更摘要直接作为 Changelog 条目素材）：

```markdown
| 包 | 当前版本 | 距上次发布变更 | 仓内依赖 | 建议 |
|----|---------|---------------|---------|------|
| @scope/definition | 0.1.0-alpha.10 | 3 commits（feat×2 fix×1） | — | minor |
| @scope/stream | 0.1.0-alpha.10 | 1 commit（fix×1） | definition | patch |
| @scope/renderer | 0.1.0-alpha.10 | 无变更 | definition, stream | skip |
| @scope/comps-charts | 0.1.0-alpha.17 | 5 commits（feat×5） | renderer, comps | minor |
```

### 脚本化现状

矩阵目前由代理按上述命令现算（git log + package.json 解析均为机械操作）；preflight.mjs 已覆盖逐包版本一致性与 tag 占用检查，「变更检测 + 依赖图」并入 preflight 是可选的后续增强。

## 实证案例（已脱敏）

### 案例 A：某组件库 monorepo（independent，分叉演化）

- 形态：pnpm workspace + 本技能模板 scripts/release.mjs（依赖序发布 + 幂等跳过），无 changesets
- 版本分布已分叉：迭代最快的适配器包 `0.1.0-alpha.17`、两个核心包 `alpha.11`、其余 `alpha.10`
- 发版节奏各异：最活跃的适配器包发过 12 次、核心包 8 次、最稳定的包仅 6 次——独立 lifecycle 是既成事实而非配置结果
- tag 全为 `<pkg>@<version>` 形态（仓级 `v0.1.0-alpha.*` 是 monorepo 改造前遗留）

### 案例 B：某 monorepo（changesets 安装未使用）

- `.changeset/config.json` 存在但 `fixed` / `linked` 皆空，发布流程无 `changeset version` 使用痕迹
- 实际链路：手工逐包 bump → 自研构建 CLI 的 release 子命令（npm 模式）逐包发布——源码内 `skipVersion = isReleaseNPM`，npm 模式完全不 bump，跳过 git/build 检查，只发当前版本
- 根 `release` 脚本只发两个核心包，其余公开包不进发布流程
- 版本早已不统一：包全是 `0.0.1`，根 package.json 却是 `1.0.0-alpha.3`

[^changesets-fixed]: [changesets fixed-packages](https://github.com/changesets/changesets/blob/main/docs/fixed-packages.md): fixed 组全员同步 bump 并发布，即使无变更
[^changesets-linked]: [changesets linked-packages](https://github.com/changesets/changesets/blob/main/docs/linked-packages.md): 成员对齐组内最高版本与最高 bump 级别，无 changeset 的成员不 bump 不发布
