#!/usr/bin/env node
/**
 * flow-mem 知识库检索脚本，以 --mode 分流四种检索、--kb 分流两个知识库：
 *
 * - frameworks：列出框架知识库现有框架。目录名即 package.json 的 pkg name，版本目录保留
 *   @version 后缀；human 字段为名称以「、」连接的字符串，bases 字段为剥离版本后缀
 *   并去重后的基础包名（vue-router@5.2.0 → vue-router，供与 deps 交叉比对）。
 * - decisions：列出决策知识库现有任务类型（decisions 根下一级目录），供按任务类型
 *   检索用户既往偏好与决策时定范围。
 * - h4：检索 `#### ` 标题（知识点索引层，信噪比最高的首选检索），返回知识文件绝对路径、
 *   行号与标题。
 * - fulltext：逐行检索正文（h4 命中不足时的兜底），返回绝对路径、行号与匹配行片段。
 *
 * --kb <framework|decisions>（默认 framework）切换 h4 / fulltext 的扫描库；frameworks 与
 * decisions 两个列目录模式各自锚定对应库根，不受 --kb 影响。
 *
 * --format <json|line>（默认 json）切换输出形态：json 为 pretty JSON 汇总（结果每条约 7 行）；
 * line 为一行一条紧凑清单（首行汇总 ok/root/query/hits，随后逐项一行），供管道 head 截断
 * 审阅——pretty JSON 下 head -100 仅见十余条，line 形态同量行数可见近百条标题。
 *
 * 检索范围为知识库根（脚本所在技能目录的 references/<framework|decisions>/），可用 --root
 * 覆写（测试用途）；代码围栏（``` / ~~~ 围栏）内的行不参与匹配，避免代码中的 #### 与关键词误命中。
 * h4 / fulltext 缺 --query 时报错退出。所有模式输出 JSON 汇总，结果含知识文件绝对路径。
 *
 * 多词 query 按空白分词做 OR 匹配：results 按命中词数降序，同词数时整串命中（exact）在前，
 * 每项附 matched（命中词数）与 exact 字段，顶层附 terms。整串 includes 对堆词 query 必然
 * 零命中、预搜索静默失效（实证：「npm pack global install bin shebang」整串无处可中），
 * 分词是对此的护栏。单词 query 输出与排序维持原样，调用方精选短关键词仍是信噪比最高的用法。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- 参数解析 ----

const argv = process.argv.slice(2);
function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

const mode = argValue("--mode") ?? "frameworks";
if (!["frameworks", "decisions", "h4", "fulltext"].includes(mode)) {
  console.log(
    JSON.stringify(
      { ok: false, mode, errors: [`未知 --mode: ${mode}（支持 frameworks | decisions | h4 | fulltext）`] },
      null,
      2,
    ),
  );
  process.exit(1);
}

const kb = argValue("--kb") ?? "framework";
if (!["framework", "decisions"].includes(kb)) {
  console.log(
    JSON.stringify(
      { ok: false, mode, kb, errors: [`未知 --kb: ${kb}（支持 framework | decisions）`] },
      null,
      2,
    ),
  );
  process.exit(1);
}

const format = argValue("--format") ?? "json";
if (!["json", "line"].includes(format)) {
  console.log(
    JSON.stringify(
      { ok: false, format, errors: [`未知 --format: ${format}（支持 json | line）`] },
      null,
      2,
    ),
  );
  process.exit(1);
}

function finish(result) {
  if (format === "line") return finishLine(result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

// --format line：一行一条的紧凑清单。pretty JSON 每条约 7 行，管道 head 截断只会见到
// 头部寥寥几条，调用方据此下「无相关命中」结论会漏掉被截断遮蔽的条目；line 形态让
// 同量行数（如 head -100）覆盖近百条标题，截断代价从「看不见」降级为「看不全」。
function finishLine(result) {
  if (!result.ok) {
    for (const err of result.errors ?? []) console.log(`error\t${err}`);
    process.exit(1);
  }
  const summary = ["ok", `mode=${result.mode}`, `root=${result.root}`];
  if (result.query) summary.push(`query=${JSON.stringify(result.query)}`);
  if (result.terms) summary.push(`terms=${result.terms.join(",")}`);
  if (result.total != null) summary.push(`hits=${result.count}/${result.total}`);
  else if (result.count != null) summary.push(`count=${result.count}`);
  if (result.truncated) summary.push(`truncated limit=${result.limit}`);
  console.log(summary.join(" "));
  for (const name of result.frameworks ?? result.decisionTypes ?? []) console.log(name);
  for (const r of result.results ?? []) {
    const extra = r.matched != null ? `\tmatched=${r.matched}${r.exact ? " exact" : ""}` : "";
    console.log(`${r.file}:${r.line}\t${r.heading ?? r.text}${extra}`);
  }
  if (result.note) console.log(`note\t${result.note}`);
  process.exit(0);
}

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 列目录模式各自锚定本库根；h4 / fulltext 由 --kb 选择扫描库
const kbDir =
  mode === "frameworks" ? "framework" : mode === "decisions" ? "decisions" : kb;
const root = path.resolve(argValue("--root") ?? path.join(SKILL_ROOT, "references", kbDir));

if (!existsSync(root)) {
  finish({
    ok: false,
    mode,
    root,
    errors: [`知识库根目录不存在: ${root}（知识库尚未建立，先用 --learn 学习）`],
  });
}

// ---- 遍历与扫描 ----

// 递归收集 .md 文件（含 @scope 两级目录）；返回绝对路径
function walkMd(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

// 现有框架目录：@scope 展开为 @scope/name，版本目录保留后缀；仅目录，根 index.md 不计
function listFrameworks() {
  const names = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      for (const child of readdirSync(path.join(root, entry.name), { withFileTypes: true })) {
        if (child.isDirectory()) names.push(`${entry.name}/${child.name}`);
      }
    } else {
      names.push(entry.name);
    }
  }
  return names.sort();
}

// term 首/尾为单词字符（字母数字下划线）时，该侧要求词边界：机械拆出的短词若只做
// 子串匹配会跨包误命中（npm ⊂ pnpm、pack ⊂ nitropack）；CJK 字符非单词字符，
// 中文词自然退化为 includes 语义。仅用于多词分词路径。
function boundaryRegex(s) {
  const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp((/^\w/.test(s) ? "(?<!\\w)" : "") + esc + (/\w$/.test(s) ? "(?!\\w)" : ""), "i");
}

// 单文件扫描：跳过代码围栏内的行；h4 模式只认恰好四个 # 的标题（##### 不匹配）。
// terms 多于一个词时进入分词语义：任一词命中即算命中，附 matched 与 exact 供全局排序；
// 单词时退化为原来的整串 includes，命中结构不附加字段（输出与旧版逐字节一致）。
function scanFile(file, terms) {
  const hits = [];
  const lines = readFileSync(file, "utf-8").split("\n");
  const qs = terms.map((t) => t.toLowerCase());
  const multi = qs.length > 1;
  // 单词路径维持 includes 子串语义：调用方精选词的子串是特性（reactivity 命中 shallowReactivity）
  const matchers = multi ? terms.map(boundaryRegex) : null;
  const phraseMatcher = multi ? boundaryRegex(qs.join(" ")) : null;
  let fenced = false;
  lines.forEach((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    // h4 只对标题文本匹配，fulltext 对整行匹配
    const target = mode === "h4" ? line.match(/^####\s+(.+?)\s*$/)?.[1] : line;
    if (target == null) return;
    const matchedCount = multi
      ? matchers.filter((re) => re.test(target)).length
      : target.toLowerCase().includes(qs[0])
        ? 1
        : 0;
    if (matchedCount === 0) return;
    const hit =
      mode === "h4"
        ? { file, line: idx + 1, heading: target }
        : { file, line: idx + 1, text: target.trim().slice(0, 160) };
    if (multi) {
      hit.matched = matchedCount;
      hit.exact = phraseMatcher.test(target);
    }
    hits.push(hit);
  });
  return hits;
}

// ---- 分流执行 ----

if (mode === "frameworks") {
  const frameworks = listFrameworks();
  const bases = [...new Set(frameworks.map((n) => n.replace(/@[0-9][^@]*$/, "")))];
  finish({
    ok: true,
    mode,
    root,
    count: frameworks.length,
    frameworks,
    bases,
    human: frameworks.join("、"),
    ...(frameworks.length === 0 ? { note: "知识库为空，暂无框架目录" } : {}),
  });
}

// decisions 库只有 <task-type>/<topic>/<ctx>.md 三层，列一级目录即任务类型清单
if (mode === "decisions") {
  const types = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  finish({
    ok: true,
    mode,
    root,
    count: types.length,
    decisionTypes: types,
    human: types.join("、"),
    ...(types.length === 0 ? { note: "决策知识库为空，暂无任务类型目录" } : {}),
  });
}

const query = argValue("--query");
if (!query) {
  finish({ ok: false, mode, root, errors: ["--mode h4 / fulltext 需要 --query <关键词>"] });
}

const limit = Number(argValue("--limit") ?? 50);
const terms = query.trim().split(/\s+/).filter(Boolean);
const results = walkMd(root).flatMap((file) => scanFile(file, terms));
// 分词语义下全局排序：命中词数降序，同词数整串命中在前；V8 sort 稳定，
// 其余同分维持文件遍历序。单词 query 不排序，结果序与旧版一致。
if (terms.length > 1) {
  results.sort((a, b) => b.matched - a.matched || Number(b.exact) - Number(a.exact));
}
const total = results.length;
finish({
  ok: true,
  mode,
  root,
  query,
  ...(terms.length > 1 ? { terms } : {}),
  count: Math.min(total, limit),
  total,
  ...(total > limit ? { truncated: true, limit } : {}),
  results: results.slice(0, limit),
});
