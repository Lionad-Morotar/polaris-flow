/**
 * PAGES.md 页面入口清单探针（纯函数，只读零副作用）。
 *
 * PAGES.md 是 Agents.md 切片的内建子产物（.planning/codebase/PAGES.md），
 * 只对「有结构化入口可枚举」的项目适用：
 * - 前端入口族：文件系统路由或手动路由 SPA 的页面目录（Vue/Nuxt/Next/Remix/
 *   SvelteKit 常见布局），静态提取路由表即可概括全站页面
 * - CLI 入口族：package.json bin 字段或命令目录，子命令即"子路径"
 * 纯后端项目（只有 server/api，无上述信号）两族皆空 → applicable=false，
 * 强行生成只会得到一张空表，不如不生成。
 *
 * 存在性（exists）与适用性（applicable）解耦回报：项目重构后不再适用但
 * 文件仍在盘时，消费方能区分「待生成」与「残留待清理」。
 * 索引完整性不归本探针管——PAGES.md 在 .planning/codebase/ 下，天然被
 * preflight 的 gsdDocs.unindexed 漂移检测覆盖，勿重复探测。
 *
 * 判定全部为存在性启发式（与 pages-deploy/lint-infra 探针同风格），
 * 不读路由文件内容、不做 AST 断言。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expandWorkspacePkgs } from "./pages-deploy.mjs";

/**
 * 前端入口信号目录（相对包根）。
 * pages 一族覆盖文件系统路由框架（Nuxt 的 pages 与 app/pages、Next 的 pages、
 * Remix 的 app/routes、SvelteKit 的 src/routes）；src/views 与 src/router
 * 覆盖手动注册路由的 Vue SPA（views 是页面组件目录，router 是路由配置——
 * 后者同时吃目录形态 src/router/ 与单文件形态 src/router.ts）。
 * 注意 app/ 单独不算信号：Nuxt 4 的 app/ 是源码根而非页面目录。
 */
const FRONTEND_SIGNALS = [
  "pages",
  "app/pages",
  "app/routes",
  "src/pages",
  "src/routes",
  "src/views",
  "src/router",
  "src/router.ts",
];

/**
 * CLI 入口信号目录（相对包根）。
 * commands 一族覆盖 oclif/cac/commander 等多命令 CLI 的惯用布局；
 * bin/ 目录与 package.json bin 字段是 npm 可执行入口的两种声明。
 */
const CLI_SIGNAL_DIRS = ["bin", "commands", "src/commands", "src/cli"];

/**
 * 探测单个包目录的入口族信号。
 * @returns {{ frontend: string[], cli: string[] }} 命中的信号相对路径清单
 */
function probePkgSignals(absDir) {
  const frontend = FRONTEND_SIGNALS.filter((rel) =>
    existsSync(path.join(absDir, rel)),
  );
  const cli = CLI_SIGNAL_DIRS.filter((rel) => existsSync(path.join(absDir, rel)));

  // bin 字段：string（单命令）或 object（多命令映射）均视为 CLI 入口。
  // 单命令工具也算适用——适用性只管"有可枚举入口"，枚举出多少是生成阶段的事
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(absDir, "package.json"), "utf-8"),
    );
    const bin = pkg.bin;
    if (typeof bin === "string" || (bin && Object.keys(bin).length > 0)) {
      cli.unshift("package.json#bin");
    }
  } catch {
    // 无 package.json 或损坏：按无 bin 处理，不阻断其他信号
  }

  return { frontend, cli };
}

/**
 * 主入口：产出 pagesMd 盘点字段。
 * @param {object} ctx - { repoRoot, gsdDir }；gsdDir 为 .planning/codebase 绝对路径
 *
 * 无 ready 字段：PAGES.md 不是独立切片而是 Agents.md 切片的内建子产物，
 * 就绪收敛由 Agents.md 切片整体判定（SKILL.md 缺口清单引用 applicable/exists）。
 * 也因此不进 --skip 三态机制——skip 循环只收敛带 ready 的节点。
 */
export function probePagesMd({ repoRoot, gsdDir }) {
  const exists = existsSync(path.join(gsdDir, "PAGES.md"));

  // 适用性：根或 pnpm-workspace 任一子包有可枚举入口族。
  // 与 devHub/pagesDeploy 同一套 expandWorkspacePkgs，保证各切片对
  // "workspace 有哪些包"的认知一致
  const pkgs = [];
  const candidates = [".", ...expandWorkspacePkgs(repoRoot)];
  for (const rel of candidates) {
    const abs = rel === "." ? repoRoot : path.join(repoRoot, rel);
    const { frontend, cli } = probePkgSignals(abs);
    if (frontend.length > 0 || cli.length > 0) {
      pkgs.push({ pkg: rel, frontend, cli });
    }
  }

  if (pkgs.length === 0) {
    return { applicable: false, exists };
  }
  return { applicable: true, exists, pkgs };
}
