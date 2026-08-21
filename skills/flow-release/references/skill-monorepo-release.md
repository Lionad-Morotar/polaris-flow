# Skill Monorepo 发版（per-directory 独立版本 shape）

多个技能共用一个仓库、各自独立版本号的发版流程。SKILL.md Step 2–6 按本文件分流；Step 0/1（preflight、分支检查）不变。

## Shape 契约

符合以下全部特征才算本 shape，缺任一即退化为普通目标：

- 一仓多技能：`skills/<name>/SKILL.md` 存在多个，目录名即技能名
- 版本三落点（单一入口维护，禁止手工分头改）：
  - `skills/<name>/SKILL.md` frontmatter 的 `metadata.version`——机器契约（preflight、状态打标、漂移判定读它）
  - `skills/<name>/CHANGELOG.md`——人读，顶部条目版本必须与 frontmatter 一致
  - git tag `<skill>@<version>`（annotated）——精确 diff 的回溯锚点，不用 `v<x.y.z>` 仓级 tag
- bump 单入口：脚本一次完成「frontmatter 改版 + CHANGELOG prepend + commit + tag」，发现顺序：根 package.json `scripts.bump` → `skills/flow-skill/scripts/bump.mjs`
- 分发无 registry：安装方 `npx skills add <owner>/<repo>`（或指向子目录）从 GitHub 拉取，推送 commit 与 tag 即完成发布
- 版本级别约定服从仓库自身规范（flow 仓：默认 patch，minor/major 由维护者显式指定，不定义机械分级）

## 发布单位与目标推断

发布单位是单个技能，不是仓库：各技能版本互不影响，一次调用可发多个技能，逐个 bump、各成提交与 tag。

无显式参数，按以下优先级推断目标技能：

1. 用户话语点名（如「发布 flow-dev」）→ 直接采用，多个名字即多个目标
2. 否则推断候选集：对每个技能执行 `git log <skill>@<最新tag>..HEAD --oneline -- skills/<skill>/`，非空即候选（最新 tag 取 `git tag -l '<skill>@*' --sort=-v:refname | head -1`）
3. 单候选直接选定并在输出中声明；多候选列出清单（技能、最新 tag、未发布 commit 数）供选择；无候选输出「没有可发布的技能变更」并停止
4. 无 tag 的技能（未基线化）不进候选集——它是首发，需显式点名后按「首发」一节处理

## 版本规划（对应 Step 2）

- 每个目标技能独立定级：读其 frontmatter 当前版本，按仓库约定定 patch/minor/major，或用户显式给 x.y.z
- 下一版本不得大于当前版本的跳级由 bump 脚本守门（显式版本必须大于当前），无需人工复核

## Changelog（对应 Step 3）

该 shape 无 `## [Unreleased]` 区块——条目在发版时从 git 历史提炼，且条目本身就是 bump 的输入：

1. `git log <skill>@<旧版本>..HEAD --oneline -- skills/<skill>/`，提炼面向价值的行为变更条目；正交合并、[internal] 标记等原则同 [changelog-format](./changelog-format.md)
2. 向用户展示条目并确认（Step 3 的确认门禁不变，只是时序变为「确认 → bump 一次落盘」，而非「先写 Unreleased 再搬迁」）
3. 条目措辞即 CHANGELOG 最终文本，bump 原样 prepend，不再二次编辑

## 升级、提交与 tag（对应 Step 4/5，合并为一步）

确认后逐技能执行：

```bash
node skills/flow-skill/scripts/bump.mjs <skill> <patch|minor|major|x.y.z> "<条目1>" ["<条目2>"...]
# 或发现到根 package.json scripts.bump 时：pnpm bump <skill> ...
```

bump 一次完成：frontmatter 改版 → CHANGELOG prepend → `chore(<skill>): v<x.y.z>` 提交（仅含该技能两文件，目录有其他脏文件会被拒绝）→ annotated tag `<skill>@<x.y.z>`。

推送沿用 Step 5 的分支语义（path tag 不改变分支策略）：stable 推发版分支 `git push origin main --tags`；prerelease 形态的技能版本（如 `0.2.0-alpha.1`）按 1.4 节在当前分支打 tag 推送。

## 首发（无 tag 技能）

无 `<skill>@*` tag 的技能视为未基线化：bump 不接受级别自增，必须显式版本——`bump.mjs <skill> 0.1.0 "<首条现状条目>"`。无 npm 首发准备（first-publish.md 不适用），tag 推送即上架。

## --post 校验（对应 Step 7）

preflight `--post` 对本 shape 逐技能校验（无 registry 项）：

- `<skill>@<frontmatter 当前版本>` tag 本地存在（fail 级）且已推远程
- frontmatter 版本与 CHANGELOG.md 顶部 `## [<version>]` 一致

## 与 claude-skill 目标的边界

`claude-skill` 是单技能仓（仓库根即 SKILL.md，版本载体为 package.json）；本 shape 是多技能共仓（版本载体为各技能 frontmatter）。preflight 以「`skills/*/SKILL.md` 且含 metadata.version」优先判定为本 shape；单技能仓仍走 claude-skill 路径。
