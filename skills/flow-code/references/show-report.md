# --show 报告规范：近况总览怎么写

Workflow A Step 2 的归簇方法与 Step 3 的成文依据。

## 结构（固定三段 + 条件段）

1. 白话概述——放最前面，important things say loud。2-4 句判断句，口语化讲清这批改动是什么、这阵子在发生什么（如「遥测从骨架 span 升级成了带内容原文的运行日志产品面」「操作记录在收敛写入语义」）。读者只看这一段也应能把握全貌。
2. 需求树——按功能域把变动组织成树（规范见下节）。树是概述的精确展开：概述给印象，树给枝干与事实。
3. 未来展望——放最后。依据有二：变动轨迹的自然延伸（最近提交序列指向的方向）；读变动时观察到的技术债与半成品线索（TODO、只接了一半的链路、被注释的入口）。写 2-4 条，每条是可验证的方向判断，不是许愿。
4. 合并前确认点（条件段）——仅当 show-range.mjs 报告 direction 为 `diverged` 或 `behind`（存在远端待合入面）时追加，放在展望之后。内容与方法见 `references/pre-merge.md`；不找缺陷（缺陷审查归 flow-code-review），只给合并动作的前置知情。

## 需求树方法

树按「需求/功能域」分枝，不按目录、不按时间——读者关心「这批改动在做哪些事」，目录只是证据。

1. 大枝 = 功能域/需求线，用用户语言命名（如「操作记录语义收敛」而非「server/api/operations 改动」），枝名后括注规模（commits 数 / 文件数 / 增删行）。
2. 子枝 = 能力点或子功能，可再嵌套一层；枝干行内联关键事实（表名、端点、页面、关键行数），让读者不点进 commit 也能定位。
3. 树末可用一句话概括主线（多条需求线之间的共同方向），没有就不写，不硬凑。
4. 树符用 ASCII（`├─ └─ │`），终端等宽字体下对齐即可，不追求像素级规整。

归簇信号优先级：

1. commit message 的 type/scope（如 `feat(agent):`、`perf:`）——最直接的意图声明
2. 文件路径聚类——同一批 commit 触碰的目录揭示任务边界
3. diffstat 规模——给每枝的占比数字背书，禁止拍脑袋估占比

大 range（>100 commits）分层读：先全量 oneline log 归簇，再对每枝挑 1-3 个代表 commit 看 `git show --stat` 或段级 `git diff --stat` 校准。merge commit 用 `git show <merge> --stat` 单独看，其带动的面按 merge 描述归簇，不拆成逐 commit。

## 定性词纪律

看到的只是窗口内的部分变动，严格限制「完成 / 收尾 / 闭环 / 彻底 / 全部」类状态推断。允许陈述事实，禁止推断状态：

- 「workflow 瘦身完成」：「最近一批 commit 移除画布与工作流逻辑层」
- 「市场功能闭环」：「市场三表 schema + 端点 + 前端 tab 已接线」
- 「LanceDB 彻底移除」：「LanceDB 相关代码与依赖被移除，pgvector 成唯一实现」

例外：commit message 自带的定性词可引用，但用引号标明是 commit 原文，不当作报告作者的结论。

## 裁量声明

对比基退化链是默认值，可按情况自由裁量：range 过大（如 >500 commits）改时间窗；默认分支非 main 时改用实际默认分支；detached HEAD 直接用时间窗。无论是否裁量，报告开头必须有一行交代对比基、direction 与路径，例如：

> 对比基：`origin/feat-x...HEAD`（upstream 策略，direction=ahead，42 commits）；无退化。

> 对比基：`HEAD --since=1个月`（时间窗策略，direction=ahead）；退化路径：当前分支无 upstream → 相对 origin/main 无未合并提交。

> 对比基：`origin/develop...HEAD`（upstream 策略，direction=diverged，本地 21 / 远端 48）；需求树按远端待合入面（`HEAD...origin/develop`）展开。

## 长度与输出

默认约 1k 字终端报告，调用方指定长度时从其。需求树的行内事实（表名/端点/行数）不压缩：树的价值正在精确定位，砍事实换长度是本末倒置。输出中文。
