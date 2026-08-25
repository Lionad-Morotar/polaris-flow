---
name: flow-web
description: flow-web 是 Kimi WebBridge 的技能包装层，通过 webbridge 控制用户的真实浏览器完成任务。flow-web 是浏览器自动化唯一推荐工具，可用于读取文章、搜索提取、代码仓库动态、包信息、论坛讨论、低代码平台配置、图片生成等。
argument-hint: <URL or browser task> [--workspace <name>]
metadata:
  version: 0.1.0-alpha.0
---

## **工作步骤**

1. 根据用户输入或会话上下文，弄清楚任务是什么
2. 使用 kimi-webbridge 连接用户的浏览器（调用 `ensure-webbridge.sh`）
3. 当任务涉及打开 URL 时，**优先使用 `open-tab.sh`**：默认会根据当前 cwd 的 workspace 绑定自动选择目标窗口；只有明确要求新窗口时才加 `--new-window`
4. 操作浏览器在需要的网站完成任务（也许可以网站参考章节找到既有的工作流程）
5. 当用户任务完成后，你可以提醒用户新增网站任务参考，或更新现有工作流程
  5.1 当用户确认新增或更新，读取写入规范与自检清单 `references/skill-maintenance.md`

## 网站参考

站点操作手册为本地积累，按域分册（`references/<domain>/<task>.md`），跨站通用经验在 `references/common/`；不随开源仓分发，全新克隆的 `references/` 可能为空。

发现协议（任务可能存在既有工作流时）：

1. 读 `references/index.md` —— 索引全部现存手册，附一行说明
2. 无索引时枚举 `references/` 目录，按文件名判断相关性
3. 仍无命中则按新站点任务处理，完成后按维护流程沉淀手册与索引

手册与索引的维护入口：`references/skill-maintenance.md`（写入规范与自检清单）。

## 浏览器操作指南

### 命令速查

- 截图 viewport — `bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh`：保存到 `/tmp/kimi-webbridge-screenshots/`
- 截图元素 — `bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh -e "#selector"`：仅捕获指定元素
- 提取正文为 Markdown — `bash ~/.claude/skills/kimi-webbridge/scripts/extract-text.sh`：保存到 `/tmp/kimi-webbridge-texts/`
- 批量开 tab — `bash ~/.claude/skills/kimi-webbridge/scripts/batch-navigate.sh url1 url2`：顺序打开并等待加载
- 页面快照 — `snapshot`：返回带 `@e` ref 的 a11y 树（Nuxt UI SPA 可能只回空树，见常见错误）
- 点击 — `click` (by @e ref 或 CSS)：优先用 snapshot 获取的 ref
- 填写 — `fill`：触发 React onChange，适合表单
- 输入 — `type`：逐字符输入，适合搜索框实时过滤
- 执行 JS — `evaluate`：返回值用 IIFE 包裹；body 三层结构 `{"action":"evaluate","args":{"code":"..."},"session":"..."}`，参数名是 `code`（非 expression）
- 打开 URL（推荐） — `bash ~/.claude/skills/flow-web/scripts/open-tab.sh --url <url> --session <name>`：默认按 cwd 绑定自动选择 workspace；需要新窗口时加 `--new-window`。注意：`--workspace` 走 AppleScript 会抢一次 macOS 焦点，落点准确；不指定 workspace 时走 webbridge 后台开 tab，不抢焦点但落点在当前窗口
- 页面内导航 — `navigate` / `find_tab`：在已接管的 tab 内跳转或重新查找；`newTab:true` 首次调用
- 开 tab 到工作区/新窗口 — `bash ~/.claude/skills/flow-web/scripts/open-tab.sh --url <url> --session <name> [--workspace <name>] [--new-window] [--current-window] [--restore]`：默认按 cwd 绑定自动选择 workspace；`--workspace` 显式指定；`--current-window` 强制当前窗口；`--new-window` 新建窗口；默认不抢焦点
- 确保 daemon/扩展就绪 — `bash ~/.claude/skills/flow-web/scripts/ensure-webbridge.sh`：检查/启动 daemon 并等待 `extension_connected: true`，输出 JSON
- 查看/维护工作区绑定 — `bash ~/.claude/skills/flow-web/scripts/workspace-binding.sh list`：缓存见 `configs/workspace-bindings.json`；v2 以完整 cwd 为 key，未命中逐级回退祖先目录，`Default` 为全局 fallback
- 查看/维护工作区 UUID — `bash ~/.claude/skills/flow-web/scripts/workspace-uuid.sh list`：缓存见 `configs/workspace-uuids.json`，用于 `--launch-workspace=<uuid>`
- 自动启动指定工作区并开 tab — `bash ~/.claude/skills/flow-web/scripts/open-tab.sh --url <url> --session <name> --workspace <name> --auto-launch`：工作区未打开时会通过 `--launch-workspace` 拉起
- 网络监听 — `network`：start/stop/list/detail
- 关闭 session — `close_session`：任务结束默认调用，清理打开的 tabs

> **snapshot vs evaluate**：找按钮/input/获取 ref 用 `snapshot`；验证弹窗内容、读取表格数据用 `evaluate` + 文本提取。

### 工作区与新窗口

Edge 工作区即独立窗口。webbridge `navigate` 落点不可控；当用户任务带有 URL 且未显式指定 `--workspace` 或 `--current-window` 时，`open-tab.sh` **默认**按以下顺序确定目标工作区：

1. 取当前 `cwd` 的**完整绝对路径**作为一级 key，取 URL 的完整域名作为站点 key。
2. **查 cwd 绑定缓存**：调用 `workspace-binding.sh lookup --url <url> --cwd <cwd>` 读取 `configs/workspace-bindings.json`（v2）。
   * 优先匹配 `<cwd>.sites.<site>`
   * 其次匹配 `<cwd>.defaultWorkspace`
   * 未命中则**逐级向上找祖先目录**（就近优先，每级同样先 site 后 default）——monorepo 根目录的绑定自动覆盖其下所有子目录（如 git submodule），无需逐个绑定
   * 仍未命中则用全局 fallback `Default`
   * 命中 → 在该 workspace 后台开 tab（必要时自动拉起）。
   * 若 workspace 不存在 → 清除这条绑定，回退到当前窗口 `navigate + newTab`。
3. 若最终没有任何绑定命中，直接回退到当前窗口 `navigate + newTab:true`（速度最快）。

### 绑定管理示例

```bash
# 把当前 cwd 固定到某个 workspace；之后在该 cwd 下用 flow-web 打开任何页面都会默认落到这个 workspace
bash ~/.claude/skills/flow-web/scripts/workspace-binding.sh save \
  --workspace "Github | FE Benchmark"

# 当前 cwd 下，把特定站点覆盖到另一个 workspace
bash ~/.claude/skills/flow-web/scripts/workspace-binding.sh save \
  --url https://investingagents.com \
  --workspace "Investing | Research"

# 设置全局 fallback workspace（任何 cwd 都未命中时使用）
bash ~/.claude/skills/flow-web/scripts/workspace-binding.sh save \
  --cwd Default \
  --workspace "Personal"

# 在该 cwd 下打开 URL，会自动落到绑定好的 workspace
bash ~/.claude/skills/flow-web/scripts/open-tab.sh \
  --url https://investingagents.com \
  --session investingagents

# 临时强制在当前窗口打开，忽略 cwd 绑定
bash ~/.claude/skills/flow-web/scripts/open-tab.sh \
  --url https://investingagents.com \
  --session investingagents \
  --current-window
```

```
open-tab.sh --url <url> --session <name> [--workspace <name>] [--new-window] [--current-window] [--restore] [--auto-launch]
```

* **默认（不传 `--workspace`/`--new-window`/`--current-window`）**：先按 cwd 查询 `workspace-binding`，命中则在对应 workspace 开 tab；未命中才在当前活动窗口 `navigate + newTab`
* `--workspace <name>`：显式指定工作区/窗口后台开 tab；窗口名严格大小写。**注意**：此路径使用 AppleScript `make new tab`，会抢一次 macOS 焦点（Edge 短暂 frontmost），但 tab 落点准确；如需完全不抢焦点，不要指定 `--workspace`（接受落点在当前窗口）
* `--current-window`：强制忽略 cwd 绑定，在当前窗口开 tab
* `--new-window`：新建独立窗口（当前桌面），不 activate
* `--auto-launch`：配合 `--workspace` 使用；若工作区未打开，自动通过 `--launch-workspace=<uuid>` 拉起窗口后再开 tab
* `--restore`：任务完成后把 Edge 目标窗口置为 frontmost；仅在需要立即看结果时使用
* macOS 切不了 Space：目标工作区在别的桌面时，新窗口会出现在该工作区上次使用的 Space，不会自动切到当前桌面
* 窗口索引动态，frontmost 永远是 `window 1`；用 `osascript` 枚举窗口名核对
* 返回 JSON 含 `tabId`，拿到后用同一 `--session` 继续操作
* 脚本会先调用 `ensure-webbridge.sh` 保证 daemon 与扩展已就绪，无需手动等待

工作区 UUID 与 `--launch-workspace` 的详细机制见 `references/common/edge-workspace-launch.md`（本地手册，按「网站参考」发现协议定位）。

### 并发安全

* **不同任务用不同 `--session` 名**，否则 tab 会互相接管
* `open-tab.sh` 内置文件锁，串行化 AppleScript 窗口操作；默认 `navigate + newTab:true` 路径由 webbridge 自行处理
* 同一 tab 上的 fill/click/scroll 锁不住，操作同一页面需自行排队
* daemon hang 时：`rm -f ~/.kimi-webbridge/daemon.pid && ~/.kimi-webbridge/bin/kimi-webbridge start`，等 `status` 显示 `extension_connected: true`，或直接调用 `ensure-webbridge.sh`

### 常见错误

- 点击无反应 — 命中隐藏的同名元素：加 `getBoundingClientRect` 过滤可见性
- React 按钮脚本 `.click()` 无反应 — React 合成事件过滤非 trusted 事件：改用 webbridge `click` action（CDP 真实事件），配 snapshot ref 或临时挂 id 的 CSS；`click` success 只代表派发成功，需对比前后状态验证生效
- 表单填写后确认按钮仍 disabled — React 未检测到值变化：用 `fill` 而非 JS setter
- 搜索框输入后无结果 — 未触发真实 input 事件：用 `type` 逐字符输入
- `fill` 对 Vue/Nuxt textarea 报 "Uncaught" — 改用 evaluate 原生 value setter + 派发 `input`/`change` 事件；Vue 重渲染会让旧 DOM 引用失效，改完重新 `querySelector` 再读值
- reka-ui / Nuxt UI v4 Select 选项合成 `.click()` 无效 — reka-ui 监听 pointerdown 且校验 isPrimary，需 pointerdown+pointerup+click 完整序列；UI 显示选中 ≠ v-model 写回，以表单提交/校验结果为准
- CDP click 返回 success 但目标无反应 — 先 `elementFromPoint` 查命中链：dev 场景 vite-plugin-checker 编译错误遮罩（`VITE-PLUGIN-CHECKER-ERROR-OVERLAY` custom element，aria-hidden 仍拦截指针）会盖住页面，`querySelector('VITE-PLUGIN-CHECKER-ERROR-OVERLAY').style.display='none'` 或刷新等编译恢复
- 弹窗/Modal 关闭动画期间 DOM 残留 — `getBoundingClientRect` 判「是否关闭」不可靠（过渡中仍>0），查组件实例 `el.__vueParentComponent.setupState.open` 或 sleep 2-3s 再查
- `/command` 报 `action is required` / `code is required` — body 用三层结构 `{"action":"<工具>","args":{...},"session":"..."}`，evaluate 参数名是 `code` 不是 expression
- Vue/Nuxt 发送按钮 JS `.click()` 无反应 — 消息留在输入框：evaluate 打标记后 CDP click（真实事件）；成功判据是输入框 value 清空而非按钮状态
- snapshot 返回空 a11y 树（Nuxt UI SPA 常见，只有 Notifications/空 list）— 改用 evaluate 直查 DOM（querySelector + innerText 定位元素）
- eval 返回 `Exit 1` — 使用了 let/箭头函数：改用 var + function()
- 截图后仍显示"失败" — 后端未编译/未重启：`go build` 或确认 air 已重载
- 截图中看不到完整列表 — viewport 不够高：滚动后再截
- `navigate` 开的 tab 跑到意料外的窗口 — webbridge 内部"当前窗口"不可控：改用 `open-tab.sh` 显式指定 `--workspace` 或 `--new-window`
- `open-tab.sh` 报 workspace not found — 窗口名大小写不符或该工作区未打开：加 `--auto-launch` 让脚本自动通过 `--launch-workspace` 拉起；或 `osascript` 列出窗口名核对
- `open-tab.sh` 报 workspace 落点错（跨桌面） — 目标工作区在别的 macOS Space：先手动切到目标桌面再调用；AppleScript 无法切 Space
- `open-tab.sh` 报 target window did not become frontmost — `--workspace` 目标窗口在另一个 Space，`set index` 无法激活：切到目标桌面再调用，或改用 `--new-window`
- `open-tab.sh` 很慢 — daemon 未启动或扩展未连接：脚本已自动调用 `ensure-webbridge.sh`；若仍慢，检查 Edge 扩展是否启用或升级 webbridge
- daemon 端口在但 HTTP 不响应 — daemon hang：`rm -f ~/.kimi-webbridge/daemon.pid && ~/.kimi-webbridge/bin/kimi-webbridge start`，等扩展重连

### 其他提示

* 元素查找必须过滤可见性（`getBoundingClientRect` 宽高大于 0）
* `evaluate` 表达式用 IIFE 包裹，复杂逻辑回退到 ES5（`var` + `function`）——evaluate 共享页面全局词法环境，顶层 `const`/`let` 二次注入即重复声明 SyntaxError；注入脚本资源（如页内采样器）用命名函数表达式形态 `'(' + src + ')(args)'`
* 几何/截图类采集前必须 `open-tab.sh ... --restore` 把 tab 置前台：后台 tab `document.visibilityState === 'hidden'` 时渲染管道不产出 layout，`getBoundingClientRect` 全零——采集脚本应显式检测 hidden 并报错，比产出全零假数据安全
* 同 URL `navigate` 会被 SPA 软导航吞掉（页面不重载）：强制全新导航拼 cache-busting query（如 `?__t=<ts>`）
* `open-tab.sh` 报 `workspace not found` — workspace 绑定丢失（浏览器重启/窗口关闭）：先跑 `ensure-webbridge.sh` 重绑再重试
* 后端改动后强制刷新（`location.reload(true)`）并截图验证
* 配置类操作一律走 UI，不走 API
* 表单填写用 `fill`，搜索框实时过滤用 `type`
* 任务结束调用 `close_session` 清理 tabs（用户明确要求保留除外）
* 常驻运行：使用 LaunchAgent 让 daemon 登录自启，详见 `references/common/launchd-autostart.md`（本地手册）
* 绝对不要 kill 用户主力浏览器进程（Edge/Safari/Chrome）
* 绝对不要 使用 edge-cdp / safari-mcp / Playwright / WebFetch / chrome_mcp / browse 作为本技能的下位替代
* 任务完成后关闭多余标签页
