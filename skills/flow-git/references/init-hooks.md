# 安装 git hooks 执行手册（init 模式）

由 SKILL.md Workflow Step 5 调起。按子参数把规范 hooks 安装到当前项目：

- `hooks`：commit 阶段——pre-commit（受保护分支禁止直提 + lint-staged 暂存检查）与 commit-msg（commitlint 提交信息规范）
- `push`：push 阶段——pre-push（质量门禁 lint → test → typecheck）与 .gitattributes（LF 行尾保护）
- `all`（省略参数同）：两阶段全装

pre-push 含全量 typecheck 是刻意的强门禁，代价是拖慢推送（Windows 更明显）；急用 `HUSKY=0 git push`（husky 内置开关）整体绕过，事后仍应补跑。

## 安装内容

### 1. `.husky/pre-commit`

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

set -e

branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"

case "$branch" in
  release|release/*|test|test/*)
    # 只允许通过 `git merge` 产生的 merge commit。
    # 在 merge commit 的提交阶段，MERGE_HEAD 会存在；而 squash merge 不是 merge commit，应禁止。
    if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
      if [ -f "$(git rev-parse --git-path SQUASH_MSG)" ]; then
        echo "禁止在 $branch 分支进行 squash merge 提交。"
        echo "该分支只允许普通 merge 产生的 merge commit（建议使用默认 merge 或 --no-ff）。"
        exit 1
      fi

      exit 0
    fi

    echo "禁止在 $branch 分支直接 commit。"
    echo "该分支只允许把其他分支的代码 merge 过来（产生 merge commit）。"
    echo "请切到功能分支提交后，再合并到 $branch。"
    exit 1
    ;;
esac

pnpm exec lint-staged
```

两道闸：

- 分支保护：`release`、`release/*`、`test`、`test/*` 禁止直接 commit，只允许 merge commit（以 `MERGE_HEAD` 存在与否区分 merge 提交与直接提交）；squash merge 不写 `MERGE_HEAD`，走到外层"禁止直接 commit"即被拦截，内层 `SQUASH_MSG` 判断是防御性保留
- lint-staged：其余分支对暂存的 `*.{js,jsx,ts,tsx,vue}` 跑 `eslint --fix --cache`，自动修复并重新暂存，报错则提交失败

### 2. `.husky/commit-msg`

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

pnpm exec commitlint --edit "$1"
```

### 3. `commitlint.config.cjs`

```js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [message => message.startsWith('Merge ')],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build', // changes to build system or external dependencies
        'chore', // other changes that don't modify src or test files
        'ci', // changes to our CI configuration files and scripts
        'docs', // documentation only changes
        'feat', // a new feature
        'fix', // a bug fix
        'perf', // a code change that improves performance
        'refactor', // a code change that neither fixes a bug nor adds a feature
        'revert', // reverts a previous commit
        'style', // changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
        'test', // adding missing tests or correcting existing tests
        'wip', // work in progress
        'release', // release commit
        'cosm', // changes related to cosmetic updates
        'stash' // commit a feat not ready to be tested or reviewed
      ]
    ]
  }
}
```

要点：基于 `@commitlint/config-conventional`，type 白名单在常规十项外扩展 `wip`、`release`、`cosm`、`stash`；`Merge ` 开头的消息豁免（merge commit 默认消息不合 conventional 格式）。

### 4. `package.json` 片段

```json
{
  "scripts": {
    "prepare": "(git config --unset core.hooksPath || true) && husky install || true"
  },
  "lint-staged": {
    "*.{js,jsx,ts,tsx,vue}": [
      "eslint --fix --cache"
    ]
  },
  "devDependencies": {
    "@commitlint/cli": "^19.8.1",
    "@commitlint/config-conventional": "^19.8.1",
    "husky": "^8.0.3",
    "lint-staged": "^16.1.6"
  }
}
```

`prepare` 里先 `--unset core.hooksPath`：避免仓库曾被其他工具（如 husky v4、pre-commit 框架）改过 hooksPath 导致 `.husky/` 不生效。

### 5. `.husky/pre-push`

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# 推送质量门禁：lint / test / typecheck 任一失败即阻止 push
# 紧急逃生门：HUSKY=0 git push（husky 内置开关，跳过全部 hook）
# 按耗时升序串行 fail-fast：typecheck 最贵放最后，避免前置失败白等
set -e

pnpm lint
pnpm test
pnpm typecheck
```

要点：串行 fail-fast 按耗时升序排（lint 最快、typecheck 最贵）；`pnpm test` 必须是非 watch 模式（`vitest` → `vitest run`），否则 hook 挂住——写入前先核对目标项目 scripts。

### 6. `.gitattributes`

```
.husky/** text eol=lf
*.sh text eol=lf
```

不可省。Windows 成员 `core.autocrlf=true` 时 hook 被检出 CRLF，Git Bash 的 sh 把 `\r` 视作内容：`case` 分支名失配导致分支保护静默放行（fail-open，比报错更危险）、`set -e` 直接报错。仓库侧钉死 LF，不依赖成员本地配置。

## 执行步骤

1. 确认在 git 仓库内且有 `package.json`（纯非 Node 项目则停下报告，这套实现依赖 pnpm exec）
2. 子参数分派：`hooks` → commit 阶段（步骤 3-6、9a-9b）；`push` → push 阶段（步骤 3-4、7-8、9c）；`all`（省略同）→ 全部
3. 安装依赖：`pnpm add -D husky@^8 lint-staged`（commit 阶段追加 `@commitlint/cli @commitlint/config-conventional`）
4. 合并 `package.json`：`prepare` script；commit 阶段再合并 `lint-staged` 配置。已存在则报告差异，不覆盖
5. `pnpm exec husky install`，写入 `.husky/pre-commit` 与 `.husky/commit-msg`（内容如上），`chmod +x`
6. 写入 `commitlint.config.cjs`，已存在则报告差异，不覆盖
7. 写入 `.husky/pre-push`（内容如上），`chmod +x`；写入前核对 scripts：`lint`/`test`/`typecheck` 缺一即报告并按实际调整；`test` 为 watch 模式必须改 run 模式
8. `.gitattributes`：不存在则新建；已存在则查重后追加 `.husky/** text eol=lf` 与 `*.sh text eol=lf` 两条
9. 验证：
   a. 提交信息规范：`echo "随便一句" | pnpm exec commitlint` 应报错，`echo "fix: 测试" | pnpm exec commitlint` 应通过
   b. 分支保护：shell 模拟 case 逻辑（普通分支放行 / 受保护分支拦截 / detached 放行），不做真实空提交
   c. pre-push：`sh -n .husky/pre-push` 语法通过；`git config core.hooksPath` 已指向 `.husky/_`

幂等要求：所有文件写入前先检查存在性，冲突一律报告由用户决策，禁止静默覆盖。

## 定制点（按目标项目调整）

- 分支名单：`case` 语句里的 `release|release/*|test|test/*`，按项目分支模型增删
- 质量门禁命令与顺序：默认 `pnpm lint` → `pnpm test` → `pnpm typecheck`，按目标项目 scripts 调整（如无 `typecheck` 可换 `tsc --noEmit` 或 `nuxt typecheck`）；保持耗时升序 fail-fast
- lint-staged glob 与命令：按技术栈调整（如 Python 项目换 `ruff check --fix`）
- commitlint type-enum：`wip`、`cosm`、`stash` 是 lionad 风格扩展，可按团队习惯裁剪
- 包管理器：脚本内 `pnpm exec`，npm 项目换 `npx --no-install`

## 注意

- 脚本按 husky v8 写法（source `_/husky.sh`、`husky install`）。若装 husky v9+：hook 里去掉 source 行，`prepare` 改为 `husky`（v9 的 install 子命令已改名且弃用 husky.sh 包装）
- hooks 可被 `--no-verify` 绕过，这是刻意留的紧急后门，不是缺陷
- `.gitattributes` 的 LF 规则随 hook 安装一并落盘：CRLF 导致的问题是 fail-open（保护静默失效）而非报错，Windows 成员必踩；已在仓库钉死则与成员本地 `core.autocrlf` 无关
- pre-push 与 `flow-git --push` 分工：hook 是固化进仓库的强制门禁（全团队共享，agent 与人都受拦），`--push` 是 agent 驱动的「修复后推送」流程；被 hook 拦住时人工修复或 `HUSKY=0` 紧急绕过
