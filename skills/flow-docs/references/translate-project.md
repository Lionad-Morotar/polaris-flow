# 项目翻译执行手册

由 SKILL.md Workflow D 调起。定义 tp CLI 契约、两条子流程（T-1 全量翻译 / T-2 上游对齐）、translator 子代理契约、T-2 主代理语义合并规则、术语表与配置的三层合并机制。

设计取向：翻译服务于「学习项目」，不是把旧项目分叉成可发布产物——严肃翻译仍须人工核查担责，所以 T-1/T-2 的收尾提交都必须经用户确认后才执行。T-1 的翻译动作只允许由 translator 子代理逐文件完成，严格禁止用脚本做批量机器翻译替换；T-2 的合并冲突由主代理 inline 按语义解决（非翻译动作，是合并决策）。

## 上下文约定

- tp CLI：`~/.claude/skills/flow-docs/scripts/tp/tp.js`（下文以 `tp` 代称完整 `node <路径>` 调用）
- 待翻译项目：用户指定的项目根目录，一律绝对路径，下文记 `$PROJ`
- 上游：待翻译项目的 `upstream/main`（T-2 的同步基准）
- 翻译分支：`translation/cn`（T-2 要求当前分支；T-1 收尾提交也在此分支，前提是配置了 origin + upstream 双 remote）
- 任务清单：`$PROJ/.todo/tp-tasks.md`（scan 生成，逐文件 checkbox，T-1 用）
- 对齐批次清单：`$PROJ/.todo/tp-diff-task.md`（diff init 生成，逐批次 checkbox，T-2 用。每行 = 一个 merge 目标，tag 名优先；无 tag 区间回退为 commit hash）
- 状态文件：`$PROJ/.tp/.translation-status.jsonl`（子代理完成回写，主代理轮询依据）
- 翻译语义：就地翻译（同路径覆盖原文件），不产平行文件
- 非 git 项目：跳过一切 git 相关步骤（分支、提交、打标），其余流程不变

## tp CLI 契约

- `scan <path>`：扫描项目识别待翻译文件，按优先级生成任务清单
- `batch`：从任务清单取当前批次文件（按行数动态分组）；关键参数 `-w $PROJ --target-lines 600`
- `todo update <file> --status=completed`：勾选任务清单；关键参数 无 `-w`，依赖 cwd 是 `$PROJ`（实证：todo.js 用 `process.cwd()` 解析清单路径）
- `status record <id> --status <s>`：回写完成/失败状态；关键参数 `-w $PROJ`；`--type commit` 用于 T-2 批次
- `status completed`：列出已完成条目（轮询用）；关键参数 `-w $PROJ`；`--type commit` 用于 T-2 批次
- `diff init`：生成对齐批次清单（tag 优先，无 tag 回退逐 commit）；关键参数 `-w $PROJ --upstream upstream/main`
- `diff next`：取下一个待对齐批次的 ref（tag 名或 commit hash）；关键参数 `-w $PROJ`
- `diff update <ref> --status=completed`：勾选批次清单（ref 为 tag 名或 commit hash）；关键参数 `-w $PROJ`
- `glossary <add|list|show|remove>`：术语表管理；关键参数 `-w $PROJ`；层选 `-p/-g/-d` 互斥
- `config <get|set|list>`：配置读写；关键参数 `-w $PROJ`；层选 `-p/-g/-d` 互斥

## 子流程 T-1：全量翻译

1. 任务清单：不存在则 `tp scan $PROJ` 生成；随后人工移除清单中无需翻译的条目（多语言文档、AI 指令文件等）
2. 暂存区对齐：`git status --porcelain` 中的文件视为已翻译——在清单内则勾选，不在清单内则忽略
3. 术语表收集：`tp glossary list -w $PROJ`，只收集名称列表备用
4. 循环翻译（直到无待翻译任务）：
   - `tp batch -w $PROJ --target-lines 600` 取当前批次
   - 用 Agent 工具（`subagent_type: general-purpose`）并行 spawn 本批 translator 子代理，传入 `file_path` / `working_dir` / `glossary_names`
   - 轮询 `tp status completed -w $PROJ`（间隔 5–10 秒），本批全部完成或出现失败后继续
   - 每批结束只输出一句话进度：「已完成第 N 批翻译（X 个文件），预计还剩 Y 条任务」
   - 不检测翻译质量、不等用户确认、不提交——直接进入下一批
5. 收尾（必须等用户明确确认后）：
   - 删除任务清单与状态文件
   - 双 remote（origin + upstream）齐备时：切 `translation/cn`，`git commit -am 'chore: cn translation'`，打标 `git tag "v-$(git rev-parse --short=6 'main^{commit}')" 'main^{commit}'` 记录本次翻译对应的上游基点。**第三个参数必填**：`git tag <name>` 不带 commit 时默认指向 HEAD（翻译分支提交），会导致 tag 名字记录的是上游 hash、指针却指向翻译提交——下次 T-2 靠 `getCurrentTag` 从 tag 名取 hash 才没算错（纯属运气）。显式 `'main^{commit}'` 让指针与名字一致，都指向上游 commit

## 子流程 T-2：上游对齐

设计取向：翻译分支长期存活、定期对齐上游。用 **merge**（保留同步历史）而非 rebase（线性、丢弃翻译提交历史）。对齐目标始终是 `upstream/main` HEAD，但执行上**分批 merge**——优先以 release tag 为批次边界，把一次大撞车拆成 N 次小撞车；无 tag 区间回退为逐 commit 批次。冲突由**主代理 inline 按语义合并**，不 spawn 子代理（语义合并需要全局上下文：i18n key 映射、上游意图判断，切片反而丢语境）。

1. 准备：确认在 `translation/cn`；探测 remote——有 `upstream` 远端则 `git fetch origin upstream`，目标用 `upstream/main`；只有 `origin` 则 `git fetch origin`，目标用 `origin/main`（单 remote 项目，上游即 origin）
2. `tp diff init -w $PROJ --upstream <upstream/main|origin/main>` 生成对齐批次清单（依上一步探测结果填）
   - 清单每行一个批次，ref 为该批次的 merge 目标（tag 名优先；无 tag 区间回退为 commit hash）
   - 区间内无任何 release tag 时，整段回退为逐 commit 批次
   - 基点解析：`getCurrentTag` 只认 `v-<hash>` 格式的翻译基点 tag（排除上游 release tag），从 HEAD 沿祖先链回溯取最近的
   - 基点 == 目标（已最新）时输出「当前项目的翻译已经是最新的啦！」并停止
3. 循环对齐（直到无待处理批次）：
   - `tp diff next -w $PROJ` 取下一个批次 ref
   - `git merge <ref> --no-ff -m "chore: align cn translation to upstream <ref>"`（`--no-ff` 保留对齐节点）
   - 冲突按「语义合并决策规则」由主代理 inline 逐文件解决（见下节）
   - 解决后 `git add` + `git commit --no-edit` 完成 merge；`tp diff update <ref> --status=completed -w $PROJ` 勾选批次
   - 每批次结束输出一句话进度：「批次 N/M `<ref>` 已对齐，X 个文件语义合并」
4. typecheck（可选但强烈建议）：有 `tsc` 的项目跑 `npm run typecheck`（或 `node_modules/.bin/tsc --noEmit`）。文档性分支合并后，git 文本合并抓不住「同名变量存中文文本 vs i18n key」这类语义不兼容——只有编译器能。报错先分类再处理：
   - 全是 `Cannot find module '<外部 npm 包>'`（workspace 内部 `@scope/*` 包链接正常）→ **环境问题，非合并语义错误**：上游在区间内引入了新依赖但本地 node_modules 未更新。跑 `pnpm install` 更新依赖即可（这会更新 lockfile，是预期的依赖升级，非污染）。验证：报错的包在 `git diff <prev>..<ref> -- '**/package.json'` 里有新增
   - 类型不兼容、`Cannot find name`、i18n key 改名、同名变量语义冲突等 → **合并引入的语义问题**：按下方「上游引入 i18n / 重构」边界情况处理，inline 修复后重跑
   - 判据：先看报错的模块名。外部包缺失 → 装依赖；内部类型/符号冲突 → 语义修复。两者不要混淆——为「装依赖」去 inline 改代码，或为「语义冲突」去 `npm install`，都会跑偏
5. 收尾（必须等用户明确确认后）：
   - 删除批次清单与状态文件
   - 打标：`git tag "v-$(git rev-parse --short=6 'upstream/main^{commit}')" 'upstream/main^{commit}'`——完整命令必须带第三个参数 `'upstream/main^{commit}'`，否则 tag 指向 HEAD（翻译分支）而非上游 commit（指针错指是高频踩坑点：tag 名字对、指针错，`getCurrentTag` 从名字取 hash 才没翻车）。`^{commit}` 解引用annotated tag 到 commit；单 remote 项目用 `origin/main^{commit}` 替换两处 `upstream/main`
   - `git checkout main && git merge upstream/main --ff-only` 同步 origin main → 切回 `translation/cn`

### 语义合并决策规则

merge 冲突是 diff3 三路格式（`<<<<<<< HEAD` / `||||||| base` / `======= incoming` / `>>>>>>> ref`）。HEAD 是翻译分支（含中文），incoming 是上游（英文 / i18n / 新逻辑）。逐冲突块判断：

- 含 `t("i18n…")` 等 i18n 调用 — 决策：取 incoming；说明：上游已 i18n 化，是更优方案；中文已在消息表里。翻译分支的硬编码中文在此让位
- 与 base 段完全相同（上游未动这块） — 决策：取 HEAD；说明：上游没改，HEAD 的中文翻译正确
- 纯英文、与 base 段不同（上游改了文本） — 决策：取 incoming 新文本，若适合则当场译成中文；说明：上游改了文案，旧译作废
- 改了代码逻辑/结构（非字符串：函数名、条件、新 API） — 决策：取 incoming 逻辑 + HEAD 的中文意图重组；说明：不是二选一，是「上游代码 + 中文注释/错误信息」。上游新增的英文注释当场译中文
- 新增整段代码或注释 — 决策：取 incoming，注释译中文；说明：纯增量，无冲突语义

判定信号：优先看 **base 段**（`|||||||` 之后）。`base == incoming` 说明上游没动这块，取 HEAD 中文；`base != incoming` 说明上游改了，需人工看改了什么。`base == HEAD`（无中文时）说明翻译分支没动这块，取 incoming。

### modify-delete 冲突决策规则

不是所有冲突都是 diff3 三路文本块。`UD`/`DU` 状态（git status 第二列 `U`/`D`：上游删了文件、翻译分支修改过；或反之）没有 `<<<<<<<` 标记，文件内容可能是 HEAD 版本被原样保留在树里。这类冲突按删除意图判断：

- **功能端到端移除**（删除 commit message 含 `remove … module`/`drop …`，且该批次伴随同模块的源码/测试/脚本/资源大批量删除） — 决策：**采纳上游删除**（`git rm <file>`）；说明：保留对应已移除功能的中文文档会形成「文档孤岛」（描述的 API/功能在代码里已不存在），误导后续读者
- **文件搬迁/重命名**（删除 commit 是 `move`/`rename`，或同批次有同名/近名文件新增） — 决策：**跟随上游新路径迁移翻译**；说明：内容仍有效，只是位置变了，把 HEAD 的中文内容写到上游新路径，删旧路径
- **上游删了，但翻译分支的修改是独立的新内容**（HEAD 改的不是翻译，是功能性改动） — 决策：人工裁决，通常保留 HEAD 内容到合适位置；说明：罕见，需看 HEAD 改了什么

判定信号：`git log --oneline <prev-tag>..<ref> -- <file>` 看删除 commit message；`git diff --name-status <prev-tag>..<ref> | rg -i '<module>'` 看同批次是否大批删除同源文件。三个信号齐了就能定夺。

注释规范：合并产生的注释禁夹带外部编号引用（如 `#236`、`见 ADR-X`），需要溯源时用自己的话重述 why。

## translator 子代理契约

`subagent_type: general-purpose`，工具 Read / Write / Bash，负责单文件就地翻译。

主代理传入：`file_path`（绝对路径）、`working_dir`（即 `$PROJ`）、`glossary_names`（可选；不传则由子代理按文件内容自选术语表）。

流程与规则（写进子代理 prompt）：

1. 读源文件，判定类型（代码 / 文档）与涉及的技术领域
2. `tp glossary show <name> -w <working_dir>` 读适用术语表（show 已按三层优先级合并，无需手工合并）
3. 翻译范围：
   - 代码文件——译注释、docstring、用户可见字符串；不译标识符、路径、URL、关键字、日志标记、错误码
   - 文档文件——译全部自然语言；不译代码块内代码、文件名、路径、URL 与链接文本
4. 术语应用：术语表优先，未覆盖按上下文；`action: "keep"` 保留英文，`action: "translate"` 强制指定译法；全文术语一致
5. 就地写入，保持原始格式、缩进、换行
6. 收尾两步缺一不可：cd `$PROJ` 后 `tp todo update <file> --status=completed`（注意 cwd 依赖），再 `tp status record <file> --status completed -w $PROJ`；出错则 record failed

返回约束：只回确认块（文件 / 字数变化 / 使用的术语表 / 命中数 / 清单与状态回写情况），禁止回贴原文译文摘录、过程描述或建议。

## 主代理语义合并（T-2 冲突处理）

T-2 的冲突由主代理 inline 解决，**不 spawn 合并子代理**。原因：语义合并需要全局上下文——i18n key 与消息表的映射、上游 commit 的意图、术语表一致性——子代理切片处理反而丢语境，且无法跨文件协调（如某 i18n key 在多文件引用）。

主代理在每个批次的 merge 冲突上，逐文件应用「语义合并决策规则」。工具用法：

- 看冲突块：`awk '/^<<<<<<< /{p=1} p{print} /^>>>>>>> /{p=0}' <file>` 或直接 Read
- 批量替换：Edit 工具对单冲突块精确替换；多块用 Python 按行号区间或正则
- 替换后校验：`rg -c '^<<<<<<< HEAD$' <file>` 确认无残留标记
- 全部解决后 `git add` + `git commit --no-edit`

辅助脚本（可选）：merge 冲突块多时，可写一次性 Node 脚本按决策规则批量分类——但只处理「incoming 含 i18n」和「base==incoming」两类机械情况；含逻辑改动的块必须人工语义判断。脚本写完即弃，不沉淀进 tp（语义合并的价值在判断，不在自动化）。

返回约束：每批次只回一句话进度（批次数 / 文件数），禁止回贴大段 diff。

## 术语表机制

三层合并，优先级 项目 > 个人 > 默认：

- 默认 — `~/.claude/skills/flow-docs/scripts/tp/assets/glossary/`：只读，内置 `agent.toml`（智能体领域）
- 个人 — `~/.tp/glossary/`：跨项目共享
- 项目 — `$PROJ/.tp/glossary/`：优先级最高

支持 TOML 与 CSV 两种格式，条目四要素：`term` / `action`（`translate` 或 `keep`）/ `translation` / `reason`。TOML 表头可带 `domain`、`description`、`when_to_use`（帮助子代理判断适用场景）。`glossary show <name>` 返回合并后的最终生效表；`add`/`remove` 不能作用于默认层。

## 配置机制

三层合并，优先级 项目 > 个人 > 默认。注意仓内并存两条装载链（历史结构，勿再发散）：

- `lib/config.js` `loadConfig` — 默认层：硬编码 `getDefaultConfig()`；合并方式：深合并；消费方：scan / batch / todo 等运行时命令
- `tp/config.js` `loadConfig` — 默认层：`configs/setting.json`（只读）；合并方式：浅合并；消费方：`config get/set/list` 展示与读写

两条链的默认层已逐字段校准一致（`taskTrackingFile: .todo/tp-tasks.md`、`targetBranch: upstream/main`、excludeFiles 7 项、excludeDirs 10 项、priority 7 项）；`targetBranch` 仅存在于 setting.json（T-2 契约使用）。个人层 `~/.tp/config.json`、项目层 `$PROJ/.tp/config.json` 两条链共用。

主要配置项：`targetLanguage`（默认「中文」）、`fileFilters.supportedExtensions` / `excludeFiles` / `excludeDirs`、`fileFilters.ignoreGitignore`、`translation.priority`（README.md → CONTRIBUTING.md → CHANGELOG.md → docs/ → src/ …）、`translation.previewLines`。`config set` 不能作用于默认层。

## 边界情况

- 非 git 项目：跳过分支/提交/打标；scan/翻译/状态机照常
- 单 remote（无 upstream）：T-1 可正常提交打标（基点 tag 指向 `origin/main^{commit}`）；T-2 主流程 Step 1 已内置探测，自动用 `--upstream origin/main` 跑
- 无基点 tag 的 T-2（首次对齐）：`getCurrentTag` 返回 null 说明从未对齐过。两条出路：跑 T-1 建立首个基点；或翻译已存在于某分支但无 tag 时，用 `git merge-base HEAD upstream/main` 回溯翻译时的上游基点，手工 `git tag v-<short-hash> <base>` 补打锚点后继续
- 基点 tag 打标陷阱（两道，都踩过）：①指针错指——`git tag <name>` 不带 commit 参数默认指向 HEAD（翻译分支提交），但 tag 名字记录的是上游 hash，名字对指针错。`getCurrentTag` 只从 tag 名字取 hash 不看指针，靠这点才没算错基点，属运气。务必带第三个参数 `'upstream/main^{commit}'`。②annotated tag 的 `--short` 返回 tag 对象 hash 而非 commit hash——名字算法必须用 `git rev-parse --short=6 'upstream/main^{commit}'` 解引用。`getSourceCommit` 已在内部处理名字解析，收尾手工打标时两道都勿漏
- 上游引入 i18n / 重构：冲突块 incoming 段若含 `t("i18n…")` 调用，必须取 incoming（让位上游 i18n）；翻译分支原硬编码中文作废。常见伴随：上游把 `*_LABELS`/`*_DESC` 等 Record 重命名为 `*_KEYS`（值从中文文本变 i18n key），行层面零冲突但 typecheck 报「Cannot find name」，需整体迁移 Record 定义与引用
- merge 期间 npm install 与 lockfile：分两种情况。①上游区间引入新依赖（typecheck 报 `Cannot find module '<外部包>'`）→ 跑 `pnpm install` 是预期的，lockfile 更新反映上游依赖升级，**应随 merge 一起保留**，不要恢复。②merge 工具自身因 npm/pnpm 版本差异误重写 lockfile（报错并非缺模块，lockfile 却出现无关行变更）→ 这才是污染，`git checkout <upstream> -- package-lock.json` 恢复后 commit。区分关键：看 `git diff <prev>..<ref> -- '**/package.json'` 是否真有依赖变更
- 子代理失败（T-1 translator）：状态文件已记 failed；主代理报告失败条目，由用户决定重试或人工处理，不静默跳过
- franc 依赖缺失（node_modules 未安装）：preflight 拦截；恢复命令：`cd ~/.claude/skills/flow-docs/scripts/tp && pnpm install`
- 任务清单路径被自定义：scan 尊重 `taskTrackingFile` 配置项，但 batch/todo 硬编码读 `.todo/tp-tasks.md`——用 `config set` 改该项会让批次循环断掉，禁止自定义
