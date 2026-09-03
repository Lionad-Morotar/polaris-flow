# Agents.md 切片执行手册

由 SKILL.md Workflow 步骤 2 调起。环境盘点与范围确认已在 Workflow 中完成，本手册接收其决策输入，执行 `Agents.md` + `Claude.md`（互为 symlink）初始化与 AI 上下文基建（gsd-docs、PAGES.md 页面入口清单、产品上下文、Domain Docs 挂载、全库通读）。

纯文档编排，没有代码可 TDD，flow-dx **直接执行**，不委托 flow-dev。产物是项目基建文件，**全部进入 git**。

## 输入（来自 Workflow）

* 盘点 JSON（契约见 `references/preflight-contract.md`）
* 范围确认决策：增强步骤勾选集、是否允许覆盖重写 A/C、提交方式

## 上下文

* 项目根目录：`<repo-root>`（盘点 JSON 的 `repoRoot` 字段）
* A：`<repo-root>/Agents.md`
* C：`<repo-root>/Claude.md`
* gsd-docs：`<repo-root>/.planning/codebase/*.md`
* PAGES.md：`<repo-root>/.planning/codebase/PAGES.md`（盘点 `pagesMd.applicable=true` 时维护）
* 产品上下文：`<repo-root>/PRODUCT.md`
* 模板：技能目录 `templates/agents-md.template`、`templates/pages-md.template`

## 执行步骤

### 1. A/C 文件骨架

- [ ] 若允许重写且盘点 JSON 中 `gitTracked` 为 false：先备份原内容到 `/tmp/agents-md-backup-<YYYY-MM-DD>/`
- [ ] A 不存在：C 存在则复制 C 内容到 A；C 不存在则按 `templates/agents-md.template` 写入 A（`{项目简介}` 等占位符按项目实况填充）
- [ ] 允许重写：以模板与最新项目实况重写真实文件
- [ ] 确保 A、C 内容一致且互为 symlink：一者为真实文件，另一者 `ln -s`（A 真实 C 链接，或反之）。两者都是真实文件时，以内容较新者为真实文件，另一者改为 symlink

### 2. 按勾选执行增强步骤

> 勾选集已经过 preflight `skills.*.available` 可用性过滤（Workflow 步骤 1 Q2），直接按名执行，**禁止 Read `~/.claude/skills/**` 做存在性确认**——探测已由 preflight.mjs 一次完成，重复探测纯耗上下文。执行方式分两路：impeccable、setup-matt-pocock-skills、learn-codebase、gsd-map-codebase 可 Skill 调用，按名调用即可（impeccable 需传子命令参数，如 `init`）；flow-docs 是 `disable-model-invocation` 编排技能，读其 SKILL.md 按 Workflow 执行（为执行而读是必要成本，与探测性 Read 不同）。

按依赖顺序执行（matt-pocock 会往 A 写入内容，故必须在骨架之后；各步骤生成的文档最后进入 A 的表格）：

1. **gsd-docs**
   * 不存在：派发子代理执行 `gsd-map-codebase`，明确要求——生成的 `.planning/codebase/*.md` 必须使用中文撰写；技能执行完毕后检查文档语言，对非中文内容兜底翻译；**禁止 git 提交**；**禁止 checkout/建分支与运行包管理器安装**（实测 mapper 会自行 checkout 新分支并 `pnpm install`——依赖信息只读 package.json/lockfile 即可，install 会重排 node_modules 并留下 lockfile/manifest 副作用）
   * 已存在：读 `~/.claude/skills/flow-docs/SKILL.md` 按其 Workflow 执行（检查 → 过期则增量更新，默认模式即够，无需 flag）
   * `meta.yaml` 缺失降级：文档在盘但 `.planning/meta.yaml` 缺失时 flow-docs preflight 拦「非 GSD 项目」——勿降级 gsd-map-codebase 全量重建，bootstrap 恢复：`git log --diff-filter=A -- .planning/codebase/` 定位文档基线提交写入 `from`，按 flow-docs gsd-sync.md 指纹协议算当前文档指纹写入 `hash`，再以 `--force` 触发增量同步（bootstrap 后 hash 一致、isOld 恒 false，不 --force 不会执行）
   * `meta.yaml` 残缺补齐：mapper 合成的 meta.yaml 可能缺 flow-docs 指纹块（实测：本地 GSD 无 meta.yaml 模板时按 init context 自造格式）——已有 `codebase.hash/from/updated_at` 则不动；缺失时按 gsd-sync.md 协议手工补齐：hash 为 `.planning/codebase/*.md` 按固定字母序拼接内容的 sha256，from 取 `git rev-parse --short HEAD`（映射锚点），不补则下次 flow-docs 误判过期
   * mapper 完成后主代理后验检查（mapper 可能越界而不自知）：`git branch --show-current` 应仍为派发时分支、`git status --short` 不应出现 lockfile/workspace 清单类新文件。实测偏差的恢复路径：`git checkout <原分支> && git merge --ff-only <偏差分支>` 带回提交（偏差分支保留不删）；按仓库实际包管理器重装依赖恢复 node_modules 布局；顶层 symlink 计数为 0 后删 `node_modules/.pnpm` 孤儿存储
   * 指纹一致性：任何对 `.planning/codebase/*.md` 的手工修改（含主代理补漏）之后必须重算指纹写回 `meta.yaml.hash`，否则下次 flow-docs 误判文档过期
   * `gsd-sdk` 降级：本机 `gsd-sdk` 可能是 fnm wrapper（仅 `run`/`auto`/`init`，无 `query` 子命令）——workflow 里 `gsd-sdk query init.map-codebase` / `query agent-skills` 失败时手动填充 init context：`mapper_model` 省略（Agent 工具继承会话模型）、`date` 取当日、`AGENT_SKILLS_MAPPER` 尾部注入缺失不阻塞（mapper agent 自带模板），汇报中如实标注
   * 等 mapper 完成用 task-notification 而非 `TaskOutput block=true` 轮询——后者超时回吐的是子代理 JSONL 转录的大段截断（4 个并行各吐一坨）；GSD workflow 自带的 commit 步骤按上方"禁止 git 提交"约束跳过，入库由本手册 Step 5 垂直切片统一收尾
   * 生成后密钥扫描（**rg 版，禁用 `-E`**——rg 原生支持正则，误用 `rg -E` 会报错退出触发 `||` 短路，打印假阴性）：
     ```
     rg -n '(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xox[baprs]-[a-zA-Z0-9-]+|BEGIN.*PRIVATE KEY|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.)' .planning/codebase/
     ```
     命中则人工复核清除，确认非敏感再继续
2. **产品上下文**：Skill 调用 `impeccable` 并传 `init`（仅 `PRODUCT.md` 缺失时）。flow-dx 自动模式下无访谈机会时，按 impeccable 允许的"仅从仓库证据推断"路径执行，推断项在 PRODUCT.md 内显式标注
3. **Domain Docs 挂载**：执行 `setup-matt-pocock-skills`，仅保留 `Domain Docs` 部分与文档；**无需 `Issue tracker`、`Triage Labels` 的描述及 `docs/agents/xxx` 文档**。正因不建 `docs/agents/domain.md`，其消费规则须**内联**进 A/C 的 `## Agent skills` 段——模板块里的 "See `docs/agents/domain.md`" 引用会成死链，禁止照抄
4. **全库通读**：执行 `learn-codebase`。大库（数万行起）内联全读会淹没编排会话：按目录职责切 4-6 个分区并行派代理全读、摘要回流，主代理不重复读

### 3. PAGES.md 页面入口清单（按适用性执行）

仅当盘点 `pagesMd.applicable` 为 true 时执行；为 false（纯后端项目，前端入口族与 CLI 命令族信号皆空）跳过——强行生成只会得到空表。PAGES.md 不进范围确认勾选集：它是本切片的内建子产物，适用即维护。

- [ ] 落盘 `<repo-root>/.planning/codebase/PAGES.md`，骨架取 `templates/pages-md.template`（前端/CLI 双形态表头，按 `pagesMd.pkgs` 各包信号选用；两族都有则分节都写）
- [ ] create（`pagesMd.exists=false`）：按 pkgs 信号静态提取——前端项目从路由配置（如 `src/router/**` 的 `path` × `meta.title`）或文件系统路由目录（`pages/`、`app/pages/` 等）枚举页面；CLI 项目从 `bin` 字段与命令目录（`commands/`、`src/commands/` 等）枚举子命令。提取口径与差异标注约定写进「数据来源」段，让阅读者能复核清单从哪来、何时过期
- [ ] update（`pagesMd.exists=true`）：重新静态提取、以代码现状为准全文刷新，并更新 `<!-- refreshed: -->` 时间戳——它是下游判断清单新鲜度的唯一依据
- [ ] 大项目（路由模块/命令数十个以上）派子代理提取回流，主代理不内联逐个读路由文件——与 learn-codebase 分区全读同理，防编排会话上下文淹没
- [ ] 指纹约束：PAGES.md 落盘/刷新属于对 `.planning/codebase/*.md` 的修改，`.planning/meta.yaml` 存在时必须按 Step 2 gsd-docs 条目的指纹协议重算 `hash` 写回，否则下次 flow-docs 误判整族文档过期
- [ ] 索引登记：PAGES.md 必须进挂载索引（Step 4 表格，模板尾 gsd-docs 片段已有对应表行）——漏登会在验证阶段被 `gsdDocs.unindexed` 漂移检测捕获

### 4. 挂载文档引用（按入库策略分支）

挂载目标由盘点 `gsdDocs.ignored` 决定——**不预设入库策略**，据实推断：

- [ ] `gsdDocs.ignored=false`（`.planning/` 将入库）→ 挂团队共享的 `CLAUDE.md`（A/C 若为"真实文件 + symlink"组合，改真实文件即可，链接自动跟随）。同事 clone 后有 `.planning/`，链接可达
- [ ] `gsdDocs.ignored=true`（`.planning/` 不入库）→ 挂个人本地 `CLAUDE.local.md`（CC 官方本地 memory 层，与 CLAUDE.md 一同加载）。**切勿挂 CLAUDE.md**——否则同事 clone 后看到死链。`CLAUDE.local.md` 不存在则创建（通常已被全局 `*.local.*` 或项目 ignore 覆盖，无需手动加 ignore）
- [ ] 用模板文件尾的可选表行片段补全表格，仅添加真实存在的文档行，禁止虚空引用
- [ ] 索引完整性对账：以盘点 `gsdDocs.files` 为准，确保 `.planning/codebase/` 下**每个在盘文档**都有对应表行——`gsdDocs.unindexed` 非空即有文档在盘但未进索引（手工补登的文档易与索引脱节，如 TESTING.md/IDENTITY.md），逐行补登。已知文档的描述行优先复用模板文件尾片段；模板未收录的新文档按既有表格风格补一行，并把该文档回流进模板片段供后续项目复用

### 5. 提交

- [ ] 提交落点：SKILL.md Workflow 步 0 已按 `git.owned` 归一化工作分支（他人项目即 `owned=false` 一律落 dev，本人项目落当前分支），本步骤直接提交到当前分支，勿再自行切分支；若单独调起本手册绕过了步 0，先按步 0 规则自行归一化再提交
- [ ] 提交前 ignore 检查：若盘点 `gitignoreDocsAgents.agentsSafe` 为 false（已前置检出），需先为例外——把 `.gitignore` 中的 `docs/` 改写为 `docs/*` 并追加 `!docs/agents/`，确保 AI 基建文档入库而运行文档仍不入库；`.planning/` 同理需确认未被忽略（`git check-ignore` 验证）
- [ ] 垂直切片依赖顺序（按入库策略调整）：
  * `gsdDocs.ignored=false`：先提交 gsd-docs（被引用方），再提交挂载方（CLAUDE.md 或 Domain Docs），避免中间态死链
  * `gsdDocs.ignored=true`：gsd-docs 与挂载的 `CLAUDE.local.md` 均不入库，仅提交实际入库的改动（典型如 `.gitignore` 追加 `.planning/` 忽略规则）
- [ ] 按范围确认的提交方式：自动垂直切片提交（建议切片：gsd-docs、A/C 基建 + Domain Docs 各自独立 commit），或输出提交计划交用户执行

## 产物清单

- Agents.md：`<repo-root>/Agents.md`；进 git：是
- Claude.md：`<repo-root>/Claude.md`（symlink）；进 git：是
- gsd-docs：`<repo-root>/.planning/codebase/*.md`；进 git：据 `gsdDocs.ignored`
- PAGES.md：`<repo-root>/.planning/codebase/PAGES.md`（`pagesMd.applicable=true` 时维护）；进 git：据 `gsdDocs.ignored`
- CLAUDE.local.md：`<repo-root>/CLAUDE.local.md`（`ignored=true` 时挂载）；进 git：否
- 产品上下文：`<repo-root>/PRODUCT.md`；进 git：是
- Domain Docs：`setup-matt-pocock-skills` 产出；进 git：是
