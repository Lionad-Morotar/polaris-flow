#!/usr/bin/env node
/**
 * flow-dx 环境盘点（只读，零副作用）。
 *
 * 一次执行输出固定格式 JSON（契约见 references/preflight-contract.md），驱动
 * SKILL.md Workflow 的缺口判断与范围确认，并充当幂等性裁判：切片执行完毕
 * 后重跑本脚本，对应字段应收敛为就绪态。
 *
 * 用法：
 *   node preflight.mjs                              # 默认 cwd
 *   node preflight.mjs <目标目录>
 *   node preflight.mjs --skip devHub,lintInfra      # 主动跳过切片（ready 收敛为 'skip'）
 *   node preflight.mjs --skip devHub <目标目录>
 * 退出码：0 = 盘点完成；1 = 致命错误（目标不在 git 仓库内，JSON 含 error 字段）
 *
 * 三态 ready：true（就绪）/ false（有缺口）/ 'skip'（被 --skip 主动跳过，不要求收敛）。
 * 不预设文档入库策略：gsdDocs.ignored 由 git check-ignore 实测（项目 + 全局 ignore
 * 规则综合），agents-md.md 据此选择挂载到 CLAUDE.md（入库）或 CLAUDE.local.md（不入库）。
 */

import { execSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { probeLintInfra } from "./probes/lint-infra.mjs";
import { probePagesMd } from "./probes/pages-md.mjs";
import {
  expandWorkspacePkgs,
  isNuxtPkg,
  probePagesDeploy,
} from "./probes/pages-deploy.mjs";

const HOME = homedir();

// argv 解析：--skip <csv> 可选（逗号分隔切片名），首个非 flag 参数为目标目录。
// 零依赖手写解析——盘点脚本必须任何环境可跑，不引入 minimist 等
const argv = process.argv.slice(2);
const skipSet = new Set();
let targetArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--skip") {
    const val = argv[i + 1];
    if (val && !val.startsWith("-")) {
      val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => skipSet.add(s));
      i++;
    }
  } else if (!a.startsWith("-") && targetArg === null) {
    targetArg = a;
  }
}
const targetDir = path.resolve(targetArg ?? process.cwd());

// 条件技能；learn-codebase 是插件技能，不在 ~/.claude/skills 下，需要额外的搜索根。
// 探测结果（skills.<name>.available）是下游判断技能可用性的唯一依据——
// 执行方禁止再 Read 技能文件做存在性确认，那是本脚本已一次性完成的廉价检测
const CONDITIONAL_SKILLS = [
  "gsd-map-codebase",
  "flow-docs",
  "impeccable",
  "setup-matt-pocock-skills",
  "learn-codebase",
];

const result = {
  version: 1,
  repoRoot: null,
  git: null, // 项目归属与工作分支探测（见 probeGit）
  stack: null,
  agentsMd: null,
  claudeMd: null,
  claudeLocalMd: null, // CC 官方本地 memory 层；gsdDocs.ignored=true 时作为挂载目标
  gsdDocs: null,
  productMd: null,
  gitignoreDocsAgents: null,
  pagesMd: null, // PAGES.md 页面入口清单适用性（Agents.md 切片内建子产物，无 ready）
  devHub: null,
  lintInfra: null,
  pagesDeploy: null,
  skills: {},
  skipped: [...skipSet], // 被 --skip 主动跳过的切片；对应 ready 收敛为 'skip'
};

// ── 工具函数 ────────────────────────────────────────────────────────────────

/** 同步执行命令，失败返回 null（盘点语义：失败是数据，不是异常） */
function tryExec(cmd, cwd) {
  try {
    return execSync(cmd, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

/**
 * 盘点单个 md 文件：存在性、symlink 状态、git 追踪状态。
 * 用 readdir 按名匹配而非 existsSync——macOS 默认大小写不敏感，
 * existsSync("agents.md") 会误配 AGENTS.md，掩盖真实文件名
 */
function probeMdFile(repoRoot, canonicalName, rootEntries) {
  const fileName =
    rootEntries.find((e) => e.toLowerCase() === canonicalName.toLowerCase()) ??
    null;
  if (!fileName) {
    return {
      exists: false,
      fileName: null,
      path: null,
      isSymlink: false,
      linkTarget: null,
      gitTracked: false,
    };
  }
  const absPath = path.join(repoRoot, fileName);
  const isSymlink = lstatSync(absPath).isSymbolicLink();
  return {
    exists: true,
    fileName,
    path: absPath,
    isSymlink,
    linkTarget: isSymlink ? readlinkSync(absPath) : null,
    gitTracked:
      tryExec(`git ls-files --error-unmatch -- ${JSON.stringify(fileName)}`, repoRoot) !==
      null,
  };
}

/**
 * 定位技能 SKILL.md：先查 ~/.claude/skills/<name>，
 * 未命中再在 plugins 的 marketplaces/cache 下有界深搜（插件技能如
 * learn-codebase 只存在于这些位置，且 cache 有多版本，命中任一即可用）
 */
function findSkill(name) {
  const flat = path.join(HOME, ".claude", "skills", name, "SKILL.md");
  if (existsSync(flat)) return flat;

  const roots = [
    path.join(HOME, ".claude", "plugins", "marketplaces"),
    path.join(HOME, ".claude", "plugins", "cache"),
  ];
  for (const root of roots) {
    const hit = walkForSkill(root, name, 5);
    if (hit) return hit;
  }
  return null;
}

function walkForSkill(dir, name, depth) {
  if (depth < 0 || !existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null; // 无权限等边界：跳过该分支
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === name) {
      const candidate = path.join(full, "SKILL.md");
      if (existsSync(candidate)) return candidate;
    }
    const hit = walkForSkill(full, name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** 返回首个存在的候选相对路径（相对于 repoRoot），都不存在返回 null */
function firstExisting(repoRoot, candidates) {
  for (const rel of candidates) {
    if (existsSync(path.join(repoRoot, rel))) return rel;
  }
  return null;
}

/**
 * 项目归属与工作分支探测（只读，不切分支——动作由 SKILL.md Workflow 步 0 执行）。
 *
 * 非本人项目（典型：clone 下来的开源仓库）不把改动落默认分支，而是落 dev 工作
 * 分支：dev 存在即用（上游推进后 merge 默认分支进 dev），缺失则由 Workflow
 * `checkout -b` 创建。归属判定是廉价启发式，三项任一命中即视为本人项目：
 *   1. 无远端（纯本地仓库视为本人项目）
 *   2. origin owner 大小写不敏感命中本地身份（user.name / user.email / email 本地段）
 *   3. 近 50 个 first-parent 提交的作者/提交者身份占比 ≥ 50%
 * fresh clone 的他人仓库三项皆不命中 → owned=false。user.name 常是显示名
 * （如「仿生狮子」）而非 GitHub 登录名，所以 owner 匹配要同时试 email 本地段；
 * 作者占比兜底覆盖「自己的仓库但显示名与登录名都不同」的场景。
 */
function probeGit(repoRoot) {
  const branch = tryExec(`git rev-parse --abbrev-ref HEAD`, repoRoot);
  const remoteUrl = tryExec(`git remote get-url origin`, repoRoot);
  let remote = null;
  if (remoteUrl) {
    // 同时吃 https（host/owner/repo(.git)）与 ssh（git@host:owner/repo(.git)）形态
    const m = remoteUrl.match(/(?:^|[:/])([^/:]+)\/([^/]+?)(?:\.git)?\/*$/);
    if (m) {
      const host = remoteUrl.includes("@")
        ? (remoteUrl.split("@")[1] ?? "").split(":")[0] || null
        : remoteUrl.split("/")[2] ?? null;
      remote = { host, owner: m[1], repo: m[2], url: remoteUrl };
    }
  }

  const name = tryExec(`git config user.name`, repoRoot);
  const email = tryExec(`git config user.email`, repoRoot);
  const identityTokens = new Set();
  for (const token of [name, email, email?.split("@")[0]]) {
    if (token) identityTokens.add(token.trim().toLowerCase());
  }
  const ownerMatch =
    remote !== null && identityTokens.has(remote.owner.toLowerCase());

  let authorShare = null;
  const logText = tryExec(
    `git log -n 50 --first-parent --format=%an%x09%ae%x09%ce`,
    repoRoot,
  );
  if (logText !== null) {
    const rows = logText.split("\n").filter(Boolean);
    let hits = 0;
    for (const row of rows) {
      if (row.split("\t").some((t) => identityTokens.has(t.trim().toLowerCase())))
        hits++;
    }
    authorShare = rows.length > 0 ? hits / rows.length : null;
  }

  const owned =
    remote === null || ownerMatch || (authorShare ?? 0) >= 0.5;

  // 默认分支：优先 origin/HEAD 实际指向，退回 main/master 本地存在性
  const originHead = tryExec(
    `git symbolic-ref --short refs/remotes/origin/HEAD`,
    repoRoot,
  );
  const defaultBranch =
    originHead?.replace(/^origin\//, "") ??
    (tryExec(`git rev-parse --verify --quiet main`, repoRoot) !== null
      ? "main"
      : tryExec(`git rev-parse --verify --quiet master`, repoRoot) !== null
        ? "master"
        : null);

  const devExists =
    tryExec(`git rev-parse --verify --quiet refs/heads/dev`, repoRoot) !== null;
  const onDefault = defaultBranch !== null && branch === defaultBranch;
  // dev 严格落后默认分支时可快进集成上游（用户习惯：dev 吸收远端 main 改动）
  let devBehindDefault = false;
  if (devExists && defaultBranch !== null) {
    devBehindDefault =
      tryExec(
        `git merge-base --is-ancestor dev refs/heads/${defaultBranch}`,
        repoRoot,
      ) !== null &&
      tryExec(`git rev-parse refs/heads/dev`, repoRoot) !==
        tryExec(`git rev-parse refs/heads/${defaultBranch}`, repoRoot);
  }

  return {
    branch,
    defaultBranch,
    onDefault,
    remote,
    identity: { name, email },
    ownerMatch,
    authorShare,
    owned,
    workBranch: {
      name: "dev",
      exists: devExists,
      current: branch === "dev",
      behindDefault: devBehindDefault,
    },
  };
}

// ── 盘点主流程 ──────────────────────────────────────────────────────────────

const repoRoot = tryExec("git rev-parse --show-toplevel", targetDir);
if (!repoRoot) {
  console.log(
    JSON.stringify({ version: 1, error: `not a git repository: ${targetDir}` }, null, 2),
  );
  process.exit(1);
}
result.repoRoot = repoRoot;
result.git = probeGit(repoRoot);

const rootEntries = readdirSync(repoRoot);

// 技术栈：Dev Hub 切片仅对 Nuxt 项目适用，适用性检测是幂等跳过的前提
const nuxtConfigName = firstExisting(repoRoot, [
  "nuxt.config.ts",
  "nuxt.config.js",
  "nuxt.config.mjs",
]);
let pkg = null;
const pkgPath = path.join(repoRoot, "package.json");
if (existsSync(pkgPath)) {
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    pkg = null; // package.json 损坏：按非 Nuxt 处理，不阻断盘点
  }
}
const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
const isNuxt = nuxtConfigName !== null || "nuxt" in deps;
result.stack = { isNuxt, nuxtConfig: nuxtConfigName };

// A/C 文件
result.agentsMd = probeMdFile(repoRoot, "Agents.md", rootEntries);
result.claudeMd = probeMdFile(repoRoot, "Claude.md", rootEntries);
// CLAUDE.local.md：CC 官方本地 memory 层（与 CLAUDE.md 一同加载，个人不入库）。
// gsdDocs.ignored=true 时，文档引用应挂这里而非 CLAUDE.md，避免团队共享文件出现死链
result.claudeLocalMd = probeMdFile(repoRoot, "CLAUDE.local.md", rootEntries);

// gsd-docs：目录下存在 ≥1 个 .md 才视为"已生成"，决定走生成还是更新路径
const gsdDir = path.join(repoRoot, ".planning", "codebase");
const gsdFiles = existsSync(gsdDir)
  ? readdirSync(gsdDir).filter((f) => f.endsWith(".md")).sort()
  : [];
// 不预设入库策略：git check-ignore 实测 .planning/ 是否被项目或全局 ignore 命中。
// check-ignore 只匹配规则不要求文件存在，盘点期即可判定。agents-md.md 据此选挂载目标。
const gsdIgnored =
  tryExec(`git check-ignore .planning/codebase/STACK.md`, repoRoot) !== null;
result.gsdDocs = {
  exists: gsdFiles.length > 0,
  dir: gsdDir,
  files: gsdFiles,
  ignored: gsdIgnored,
  unindexed: [], // 见下方漂移检测：在盘但未进挂载索引的文档
};

// 索引漂移检测：.planning/codebase/ 下实际存在、却没被挂载索引以 `.planning/codebase/<name>.md`
// 形式引用的文档。防手工补登的文档与索引脱节（本项目 TESTING.md/IDENTITY.md 曾因此在盘
// 未进 CLAUDE.md 清单、索引计数过期）。挂载目标与 agents-md.md Step 3 同一规则：
// ignored=false → CLAUDE.md（团队共享），ignored=true → CLAUDE.local.md（个人本地）。
// readFileSync 跟随 symlink，A/C 谁是真实文件都能读到索引内容；无索引文件时无从漂移，留 []。
const gsdMountProbe = gsdIgnored ? result.claudeLocalMd : result.claudeMd;
if (gsdFiles.length > 0 && gsdMountProbe?.exists && gsdMountProbe.path) {
  const indexText = readFileSync(gsdMountProbe.path, "utf-8");
  const referenced = new Set(
    [...indexText.matchAll(/\.planning\/codebase\/([A-Za-z0-9-]+\.md)/g)].map((m) => m[1]),
  );
  result.gsdDocs.unindexed = gsdFiles.filter((f) => !referenced.has(f));
}

// 产品上下文：impeccable（init 命令）仅在缺失时才应列为可选项
const productPath = path.join(repoRoot, "PRODUCT.md");
result.productMd = { exists: existsSync(productPath), path: productPath };

// docs/agents/ 入库隐患：setup-matt-pocock-skills 的 domain.md 须团队共享，
// 若被 .gitignore 忽略（常见于项目把 docs/ 整目录排除）则是隐型缺口——
// 落地后提交阶段才发现会被迫中断补 .gitignore 例外。git check-ignore 只匹配
// 规则不要求文件存在，盘点期即可判定，把问题前置到范围确认阶段
result.gitignoreDocsAgents = {
  docsIgnored: tryExec(`git check-ignore docs`, repoRoot) !== null,
  agentsSafe: tryExec(`git check-ignore docs/agents/domain.md`, repoRoot) === null,
};

// PAGES.md 页面入口清单适用性：Agents.md 切片的内建子产物，仅对有结构化
// 入口可枚举的项目适用（前端页面族或 CLI 命令族），纯后端不适用。
// 无 ready 字段——就绪收敛由 Agents.md 切片整体判定，--skip 三态机制不触及
result.pagesMd = probePagesMd({ repoRoot, gsdDir });

// Dev Hub 就绪信号。探测基准是 Nuxt 站点包：monorepo 下站点常是 playground/
// demo 子包而非根（与 pagesDeploy 同一套站点定位函数）；Nuxt 模块包不算站点——
// 其 deps 含 nuxt 只是 module-builder 的构建期同伴，旧的 isNuxt 根判定会把
// 模块库误报为 applicable。内容类检查是正则启发式：只判断"提到过"，不做 AST 断言
const devHubSitePkgs = [];
if (isNuxtPkg(repoRoot)) devHubSitePkgs.push(".");
for (const rel of expandWorkspacePkgs(repoRoot)) {
  if (isNuxtPkg(path.join(repoRoot, rel))) devHubSitePkgs.push(rel);
}
if (devHubSitePkgs.length === 0) {
  result.devHub = { applicable: false };
} else {
  // 多站点场景取首个为探测基准，与 pagesDeploy.sitePkg 同策略
  const sitePkg = devHubSitePkgs[0];
  const siteRoot = path.join(repoRoot, sitePkg);
  const siteConfigName = firstExisting(siteRoot, [
    "nuxt.config.ts",
    "nuxt.config.js",
    "nuxt.config.mjs",
  ]);
  const configText = siteConfigName
    ? readFileSync(path.join(siteRoot, siteConfigName), "utf-8")
    : "";
  const mentionsDev = /["'`]\/dev/.test(configText) || /\/dev\/\*\*/.test(configText);

  // build/generate 脚本只要存在，就必须前置 NODE_ENV=production。
  // 闸查站点包 scripts——那是实际执行 nuxt build 的位置（monorepo 根脚本只是递归转发）
  let sitePkgJson = null;
  const sitePkgJsonPath = path.join(siteRoot, "package.json");
  if (existsSync(sitePkgJsonPath)) {
    try {
      sitePkgJson = JSON.parse(readFileSync(sitePkgJsonPath, "utf-8"));
    } catch {
      sitePkgJson = null; // package.json 损坏：按无闸处理
    }
  }
  const guardScripts = ["build", "generate"].filter(
    (s) => sitePkgJson?.scripts?.[s],
  );
  const nodeEnvGuard =
    guardScripts.length > 0 &&
    guardScripts.every((s) =>
      sitePkgJson.scripts[s].includes("NODE_ENV=production"),
    );

  // 全局中间件存在时才需要 /dev 放行；无需放行记 null（N/A），不拖累 ready
  const middlewareDirs = [
    path.join(siteRoot, "app", "middleware"),
    path.join(siteRoot, "middleware"),
  ].filter((d) => existsSync(d));
  const middlewareFiles = middlewareDirs.flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.includes(".global."))
      .map((f) => path.join(d, f)),
  );
  // dev 检测的合法写法有多种：原生 import.meta.dev、Vite 旧式 import.meta.env.DEV、
  // 项目封装的 isDev()/isDevelopment()、Node 的 process.env。只认 import.meta.dev 会漏判
  // 封装场景（如本项目用 ~/utils/env 的 isDev()）。配合 /dev 路由放行双信号降低误判。
  const devCheck =
    /(import\.meta\.dev|import\.meta\.env\.DEV|\bisDev\w*\s*\(|process\.env\.DEV\b|process\.env\.NODE_ENV\s*[=!]==?\s*['"]development)/;
  const devRoute = /["'`]\/dev|startsWith\s*\(\s*['"]\/dev/;
  let authBypass = null;
  if (middlewareFiles.length > 0) {
    authBypass = middlewareFiles.some((p) => {
      const text = readFileSync(p, "utf-8");
      return devCheck.test(text) && devRoute.test(text);
    });
  }

  const devIndex = firstExisting(siteRoot, [
    "pages/dev/index.vue",
    "app/pages/dev/index.vue",
  ]);
  const hubTs = firstExisting(siteRoot, [
    "pages/dev/hub.ts",
    "app/pages/dev/hub.ts",
  ]);
  const isolationHook = /pages:extend/.test(configText) && mentionsDev;
  const ssrFalse =
    (/routeRules/.test(configText) && mentionsDev && /ssr\s*:\s*false/.test(configText)) ||
    /^\s*ssr\s*:\s*false/m.test(configText);

  result.devHub = {
    applicable: true,
    sitePkgs: devHubSitePkgs,
    sitePkg,
    devIndex: devIndex !== null,
    hubTs: hubTs !== null,
    isolationHook,
    nodeEnvGuard,
    ssrFalse,
    authBypass,
    globalMiddleware: middlewareFiles.map((p) => path.relative(repoRoot, p)),
    ready:
      devIndex !== null &&
      hubTs !== null &&
      isolationHook &&
      nodeEnvGuard &&
      ssrFalse &&
      authBypass !== false,
  };
}

// Lint 基建切片：Tailwind 类排序体系与 monorepo/Nuxt 集成陷阱
result.lintInfra = probeLintInfra({
  repoRoot,
  deps,
  isNuxt,
  nuxtConfigName,
  rootEntries,
});

// GitHub Pages 部署切片：站点包定位、子路径 baseURL 改造与部署 workflow 三信号；
// tryExec 注入供探针做 remote/gh api 查询（网络失败按未知处理，不进 ready）
result.pagesDeploy = probePagesDeploy({ repoRoot, isNuxt, tryExec });

// 条件技能可用性
for (const skill of CONDITIONAL_SKILLS) {
  const skillPath = findSkill(skill);
  result.skills[skill] = { available: skillPath !== null, path: skillPath };
}

// 三态 ready：被 --skip 主动跳过的切片，ready 改为 'skip'。
// 验证阶段（SKILL.md Step 6）据此跳过收敛检查——skip 是用户主动决策，非缺口。
for (const slice of [...skipSet]) {
  const node = result[slice];
  if (node && typeof node === "object" && "ready" in node) {
    node.ready = "skip";
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(0);
