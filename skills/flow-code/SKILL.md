---
name: flow-code
description: 代码库元架构维护入口：--show 总结代码库近期变动，产出白话概述前置、需求树展开的终端报告；diverged/behind 形态（pull 前预览远端待合入面）自动追加合并前确认点；--scan 全仓坏味道扫描（backup/兜底模式 + 坏味道测试），产出按运行时风险/代码卫生分轴的列表。当用户说「代码库近期干了什么」「总结近期变动」「代码库近况」「show recent」「pull 前看看远端有什么」「待合入变动」或「backup 模式」「兜底模式」「坏味道扫描」「扫一下兜底」「假测试」「坏味道测试」「低价值测试」「flow-code」时触发
argument-hint: "[--show [recent] | --scan [path]]"
disable-model-invocation: true
metadata:
  version: 0.2.0-alpha.0
---

# flow-code：代码库元架构维护入口

## 要求

* 意图路由先行：分支 A（--show）与分支 B（--scan）；其他 `--*` 模式报错并列出合法值后停止
* --show 产出「发生了什么」的叙事总览，不是缺陷审查（找缺陷归 flow-code-review）
* --scan 是全仓主动坏味道狩猎（无 diff 基），产出分轴列表，不做修复；两个主题域：backup/兜底模式（生产代码）、坏味道测试（测试套件），可单独扫也可全量扫
* 渐进披露：归簇方法与报告规范在 Workflow A Step 2 才读 references/show-report.md；合并前确认点规范在 Workflow A Step 3 且 direction 为 diverged/behind 时才读 references/pre-merge.md；坏味道分类与判定规则在 Workflow B Step 2 才读 references/scan-backup-pattern.md 与 references/scan-test-smell.md
* 强调纪律：非必要不使用「**」着重号
* 输出中文

## 意图路由

- 显式 `--show`；「总结 / 展示 / 报告」+「近期 / 近况 / 变动」；「pull / 合入」+「前」+「看 / 确认 / 审查」：A 近况总览；Workflow A
- 显式 `--scan`；「扫描 / 排查」+「backup / 兜底 / 坏味道 / 假测试 / 低价值测试」：B 坏味道扫描；Workflow B
- 无参调用：不适用；报告用法并停止
- 其他 `--*` 模式：不适用；报错并列出合法值（`--show`、`--scan`）后停止

与相邻技能的边界：

- flow-code --show 回答「这段时间发生了什么」；diverged/behind 形态兼答「合入前要确认什么」（前置知情，非缺陷审查）；flow-code-review 回答「这些改动有什么缺陷」；flow-code --scan 回答「全仓有哪些坏味道」（backup/兜底模式 + 坏味道测试，主动狩猎，不依赖 diff）
- --scan 只发现与定性，不做修复；按列表清理归 flow-dev；机器可判定的重复模式归 flow-dx lint 基建固化为 ESLint 规则（扫描一次换永久防线，判定见 scan-test-smell.md 的配合节）
- 查历史决策与沉淀知识归 flow-mem --search；本技能只读 git 事实与源码事实

## 参数

- `--show [recent]`（默认 `recent`）：总结近期近况；recent 的对比基由退化链探测（Workflow A Step 1），可按情况自由裁量
- `--scan [path]`（默认 当前仓库）：全仓坏味道扫描（backup/兜底模式 + 坏味道测试）；path 可收窄到子目录

## 外部依赖入口

- show-range.mjs — node 脚本：`node ~/.claude/skills/flow-code/scripts/show-range.mjs`，探测对比基并输出 JSON（含 direction：ahead/behind/diverged）；退出码 0 有变动 / 1 无变动 / 3 环境错误
- pre-merge-check.mjs — node 脚本：同目录，direction 为 diverged/behind 时跑；输出 overlap（文本冲突候选）与 migrations（迁移 journal 条件核对）JSON；退出码 0 正常 / 3 环境错误
- git — CLI：Step 2 读 commit 与 diffstat

## Workflow A：近况总览（--show）

0. 初始化
   - [ ] 解析参数：无 `--show` 时报错并列出合法值后停止
1. 定范围
   - [ ] 运行 `node ~/.claude/skills/flow-code/scripts/show-range.mjs`；退出码 3 → 报告环境问题停止；退出码 1 → 报告「近期无变动」停止
   - [ ] 记录输出的 strategy、direction 与 fallbacks：退化链只是默认值，可按实际情况自由裁量（如 range 过大改时间窗、默认分支非 main、detached HEAD），裁量理由在报告中一句话交代
   - [ ] direction 裁定总结面：`ahead` 总结本地领先面（range）；`behind` 总结远端待合入面（range 已翻转指向 upstream）；`diverged` 双面——远端待合入面（incomingRange/incomingCommits）通常为主体，本地领先面一句话带过
2. 读变动
   - [ ] 读 `references/show-report.md`（需求树方法与报告规范）
   - [ ] 全量 commit message 先行归簇；大 range（>100 commits）对每簇挑代表 commit 补 diffstat 校准规模，禁止逐 commit 看全 diff
3. 成文
   - [ ] 按 show-report.md 的结构输出：白话概述前置 → 需求树展开 → 未来展望收尾
   - [ ] 开头交代本次对比基、direction 与退化/裁量路径
   - [ ] direction 为 diverged/behind 时：读 `references/pre-merge.md`，跑 `scripts/pre-merge-check.mjs`，报告追加合并前确认点段

## Workflow B：坏味道扫描（--scan）

0. 初始化
   - [ ] 解析参数：无 `--scan` 时报错并列出合法值后停止；`[path]` 缺省为当前仓库根
1. 铺面
   - [ ] fd/rg 列出扫描面的全部目标目录（server/packages/app 等），清单写入输出——漏掉整个目录是漏检主因，禁止凭印象圈定范围
2. 搜索
   - [ ] 按扫描主题读规则：backup/兜底模式读 `references/scan-backup-pattern.md`；坏味道测试读 `references/scan-test-smell.md`；未指定主题（全量扫）两个都读
   - [ ] 按分类的搜索模式逐类执行，命中进候选；每类无命中也在报告中交代
3. 判定
   - [ ] 逐命中过判定三问（默认方向 / 可观测 / 可达），为每个轴一候选命名具体 failure_scenario
   - [ ] 遵守判定纪律：必然与概率分开、happy path 与死代码分开、定性不过度
4. 成文
   - [ ] 按 scan-backup-pattern.md 的分轴规范输出列表：轴一运行时风险 → 轴二代码卫生 → 豁免区 → 知晓区
   - [ ] 列表作为清理依据前，建议接异模型正交审查（外部审查 runner 或全新上下文子代理）修正定性（重要清单必经）

## 红线与故障恢复

- show-range.mjs 退出码 3 → 停止并报告，禁止猜测 range
- 报告只陈述 git 事实，禁止把窗口内观察外推为代码库全局状态（窗口是切片不是全貌）
- 每级退化原因必须可追溯（脚本 fallbacks 字段），报告开头交代本次使用的对比基
- --scan 找不到 failure_scenario 的命中不许进轴一；判定不确定时降级到知晓区，不凑数

## References 地图

- `references/show-report.md`：报告规范：三段结构（白话概述→需求树→展望）+ 条件确认点段、需求树归簇方法、定性词纪律、裁量声明写法、长度约定；Workflow A Step 2 必读
- `references/pre-merge.md`：合并前确认点规范：overlap 冲突预测定性、迁移 journal 核对解读、高风险杂物提示、merge commit 决策审查、「报行动项前先核实机制覆盖」判定纪律；Workflow A Step 3 且 direction 为 diverged/behind 时必读
- `references/scan-backup-pattern.md`：backup/兜底模式坏味道分类（10 类）与 grep 模式、判定三问（fail-open/fail-deceptive/可达性）、分轴输出规范、判定纪律；Workflow B Step 2（生产代码主题）必读
- `references/scan-test-smell.md`：坏味道测试分类（8 类）与 grep 模式、判定三问（会红吗/红意味着源码错吗/断言够得着用例名吗）、差异断言判据、判定纪律；Workflow B Step 2（测试主题）必读
