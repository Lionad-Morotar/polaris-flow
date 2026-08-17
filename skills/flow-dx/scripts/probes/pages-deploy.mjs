/**
 * GitHub Pages 部署切片盘点探针（纯函数，只读零副作用；gh api 查询失败按未知处理）。
 *
 * 检查项对应实战踩过的坑：
 * - 站点包可能不在根（库的 playground/demo 子包才是站点）→ applicable 必须扫 workspace；
 *   站点形态覆盖 Nuxt 与 Vite SPA（vite.config + index.html 双存在，排除以 Vite 为
 *   构建工具的库包——use-scrollbar 实战：playground 是纯 Vite SPA，Nuxt-only 判定漏报）
 * - Nuxt 模块包（@nuxt/module-builder）依赖同样含 nuxt → 不剔除会抢占 sitePkg 首位，
 *   真正的站点包被挤掉、baseUrl/buildScript 检查打到模块包上误判未就绪
 * - head 绝对路径资源在 /<repo>/ 子路径托管下 404 → baseURL 处理是核心就绪信号
 * - Pages 开关是 GitHub 端状态（gh api 可查）→ 只作信息项，不进 ready——
 *   网络态参与幂等裁判会让离线重跑误判未就绪
 *
 * 判定全部为存在性/正则启发式（与 preflight.mjs 同风格），不做 AST 断言。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Nuxt 配置文件候选名 */
const NUXT_CONFIG_NAMES = ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"];

/** Vite 配置文件候选名 */
const VITE_CONFIG_NAMES = ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.mts"];

function readText(absPath) {
  try {
    return readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }
}

function readPkg(absDir) {
  const text = readText(path.join(absDir, "package.json"));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Nuxt 模块包(非站点):依赖含 nuxt 只是 module-builder 的构建期同伴 */
function isNuxtModulePkg(absDir) {
  const pkg = readPkg(absDir);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if ("@nuxt/module-builder" in deps) return true;
  return Object.values(pkg?.scripts ?? {}).some((cmd) => cmd.includes("nuxt-module-build"));
}

/** 判断目录是否 Nuxt 站点包:nuxt.config 存在或 package.json 依赖含 nuxt(模块包除外)。
 *  devHub 探针复用同一判定定位站点包，勿改私有 */
export function isNuxtPkg(absDir) {
  if (isNuxtModulePkg(absDir)) return false;
  if (NUXT_CONFIG_NAMES.some((n) => existsSync(path.join(absDir, n)))) return true;
  const pkg = readPkg(absDir);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  return "nuxt" in deps;
}

/** 判断目录是否 Vite SPA 站点包:vite.config 与 index.html 入口双存在。
 *  以 Vite 为构建工具的库包(packages/* 常见)有 vite.config 但无 index.html,
 *  双存在条件恰好把库包排除在外;Nuxt 包优先由 isNuxtPkg 命中,不重复归类 */
function isViteSitePkg(absDir) {
  if (!VITE_CONFIG_NAMES.some((n) => existsSync(path.join(absDir, n)))) return false;
  return existsSync(path.join(absDir, "index.html"));
}

/**
 * 展开 pnpm-workspace.yaml 的 packages 为候选包目录（相对路径）。
 * 两种形态都要支持：单包条目（'playground'）与单星目录 glob（'packages/*'）——
 * 库的 playground 子包常以前者声明。preflight（devHub）与 lint-infra 探针
 * 共用本函数，保证三处对"workspace 有哪些包"的认知一致。
 */
export function expandWorkspacePkgs(repoRoot) {
  const text = readText(path.join(repoRoot, "pnpm-workspace.yaml"));
  if (!text) return [];
  const pkgs = [];
  for (const m of text.matchAll(/^\s*-\s*["']?([^"'\n]+?)["']?\s*$/gm)) {
    const entry = m[1];
    if (entry.endsWith("/*")) {
      const parent = path.join(repoRoot, entry.slice(0, -2));
      let subdirs = [];
      try {
        subdirs = readdirSync(parent, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        continue; // glob 父目录不存在：跳过该条目
      }
      for (const sub of subdirs) pkgs.push(path.join(entry.slice(0, -2), sub));
    } else {
      pkgs.push(entry);
    }
  }
  return pkgs.filter((rel) => existsSync(path.join(repoRoot, rel, "package.json")));
}

/** 从 remote URL 解析 GitHub owner/repo（兼容 ssh 与 https 形态），非 GitHub 返回 null */
function parseGithubSlug(url) {
  const m = url?.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\s*$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * 主入口：产出 pagesDeploy 盘点字段。
 * @param {object} ctx - { repoRoot, isNuxt, tryExec }；tryExec 由 preflight 注入（cmd, cwd) => stdout|null
 */
export function probePagesDeploy({ repoRoot, isNuxt, tryExec }) {
  // ── applicable：GitHub remote + 根或 workspace 任一 Nuxt 包 ────────────────
  const remoteUrl = tryExec("git remote get-url origin", repoRoot);
  const slug = parseGithubSlug(remoteUrl);
  if (!slug) {
    return { applicable: false };
  }

  const sitePkgs = [];
  if (isNuxt || isViteSitePkg(repoRoot)) sitePkgs.push(".");
  for (const rel of expandWorkspacePkgs(repoRoot)) {
    const abs = path.join(repoRoot, rel);
    if (isNuxtPkg(abs) || isViteSitePkg(abs)) sitePkgs.push(rel);
  }
  if (sitePkgs.length === 0) {
    return { applicable: false };
  }

  const sitePkg = sitePkgs[0];
  const siteRoot = path.join(repoRoot, sitePkg);

  // ── 就绪信号一：workflow 引用 actions/deploy-pages ─────────────────────────
  const workflowsDir = path.join(repoRoot, ".github", "workflows");
  let workflow = false;
  try {
    workflow = readdirSync(workflowsDir)
      .filter((f) => /\.ya?ml$/.test(f))
      .some((f) => readText(path.join(workflowsDir, f))?.includes("actions/deploy-pages"));
  } catch {
    workflow = false; // 无 .github/workflows 目录
  }

  // ── 就绪信号二：站点包 config 处理 base 前缀（子路径托管的核心改造）─────────
  // Nuxt 检 nuxt.config 的 baseURL；Vite 检 vite.config 的 base——
  // 正则启发式只判断"提到过"，与 lint-infra 同风格
  const siteConfigName = [...NUXT_CONFIG_NAMES, ...VITE_CONFIG_NAMES].find((n) =>
    existsSync(path.join(siteRoot, n)),
  );
  const siteConfigText = siteConfigName
    ? (readText(path.join(siteRoot, siteConfigName)) ?? "")
    : "";
  const baseUrl = /NUXT_APP_BASE_URL|VITE_APP_BASE_URL|baseURL|base\s*:/.test(siteConfigText);

  // ── 就绪信号三：站点包 scripts 含 Pages 构建命令 ───────────────────────────
  // Nuxt 为 github_pages preset；Vite 无 preset 机制，约定 build:pages script
  const sitePkgJson = readPkg(siteRoot);
  const scripts = sitePkgJson?.scripts ?? {};
  const buildScript =
    Object.values(scripts).some((cmd) => cmd.includes("github_pages")) ||
    "build:pages" in scripts;

  // ── 信息项：GitHub 端 Pages 开关（网络查询，失败为 null，不进 ready）────────
  let ghPagesEnabled = null;
  const buildType = tryExec(
    `gh api repos/${slug.owner}/${slug.repo}/pages --jq .build_type`,
    repoRoot,
  );
  if (buildType !== null) {
    ghPagesEnabled = buildType === "workflow";
  }

  return {
    applicable: true,
    sitePkgs,
    sitePkg,
    workflow,
    baseUrl,
    buildScript,
    ghPagesEnabled,
    ready: workflow && baseUrl && buildScript,
  };
}
