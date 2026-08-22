# 合并前确认点：diverged / behind 形态的报告追加段

show-range.mjs 报告 `direction=diverged` 或 `behind` 时，--show 报告在「未来展望」后追加本段。定位：合并动作的前置知情——告诉读者「合入这批东西之前有哪些点值得看一眼」，不找缺陷（缺陷归 flow-code-review），不替代人工 merge 决策。

## 事实来源

先跑 `scripts/pre-merge-check.mjs` 拿两份事实：

- `overlap`：双边都改动的文件清单——merge 文本冲突候选
- `migrations`：迁移 journal 核对（`unregistered` 游离迁移、`numberCollisions` 编号撞车）；无 drizzle 结构的项目为 null，跳过该节

overlap 为空且 migrations 无异常时，确认点段可以只写一句「无文本冲突候选与迁移异常」，不硬凑内容。

## 段内结构

1. 冲突预测——overlap 清单逐个定性：真冲突（同区域双改）还是可自动合并（不同区域双改）。定性方法是对交集文件做双边 diff 对照（`git diff base..HEAD -- <file>` vs `git diff base..theirs -- <file>`），看 hunk 是否落在同一区域。语义冲突（同语义、不同文件，如一边改调用方一边改实现）不在 overlap 内，靠归簇期对功能面的理解识别，识别到就写，没识别到不声称「无语义冲突」。
2. 迁移一致性——`unregistered` 与 `numberCollisions` 照实列出。定性用「游离即不执行」的事实陈述（drizzle 程序化 migrate 只按 journal 跑），不直接断言缺陷：游离可能是有意的手动运维 SQL。写法示例：「0071_cleanup.sql 未登记 journal， migrate 不会执行；若属有意手动执行则忽略」。
3. 高风险杂物——双边任一侧改动了 husky hooks、CI 配置、compose/Dockerfile、密钥/环境变量面时提示一句。理由：这类变更影响后续所有贡献者的流程，合入前知情权优先级最高。
4. merge commit 决策——range 内含 merge commit 时，读其提交信息（`git log --format=%B`）与 `--stat`，把内嵌的冲突解决决策（如 "keep telemetry"、"preserve X while merging Y"）点出来：merge 的决策已经做了一次取舍，读者需要知道这个取舍发生过。

## 判定纪律：报行动项前先核实机制覆盖

揭示风险或行动项之前，先核实仓库既有机制是否已覆盖该面；已覆盖的进「知晓」而非「待办」。两个实证：

- 「已有库缺新表」看似待办 → 核实存在启动期 schema 对齐插件（幂等重放建表脚本）→ 降级为「重启自动补齐，知晓即可」
- 「端点文件被删除」看似链路断裂 → 读 diff 实为删除文件内某个写库块 → 定性为语义收敛而非功能移除

可核实的机制面包括：启动对齐/自愈插件、fail-soft 降级约定、历史移除记录类先例、运行时 runner 的真实执行语义（如 migrate 只按 journal）。核实不到才进行动项，并交代核实路径。

## 边界

- 本段不做修复建议的展开，一点一行结论 + 必要的证据指针（file:line 或 commit）
- 不评估「该不该合」——合不合、怎么合是读者的决策
- overlap 预测的是文本冲突候选，不保证完备：重命名、跨文件语义依赖、锁文件重解析等不在交集法覆盖内
