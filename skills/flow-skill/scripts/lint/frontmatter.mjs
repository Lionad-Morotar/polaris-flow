/**
 * SKILL.md frontmatter 的轻量行级解析器。
 *
 * 不引入全量 YAML 依赖的原因：lint 只需要字段级信息——键名、标量值、
 * 以及「标量 vs 序列 vs 映射」「是否带引号」两个分类维度。后者是
 * 「布尔字段必须为无引号裸 true/false」规则的判定依据（带引号的 "true"
 * 在 YAML 里是字符串而非布尔，VSCode 同样判错）。行级解析即可覆盖这些需求，
 * 零依赖保证 lint.mjs 在任何环境即拷即跑。
 * 代价是不支持锚点、多行流式集合等冷门语法，遇到时按保守分类处理，
 * 由规则层报错而非静默吞掉。
 */

const ATTR_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(?:[ \t]+(.*))?$/;
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*\s*$/;
const DOUBLE_QUOTED_RE = /^"([^"]*)"/;
const SINGLE_QUOTED_RE = /^'([^']*)'/;

/**
 * 解析 frontmatter，返回属性表与结构错误。
 * 返回值：
 *   attrs        Map<key, { value: {type, value, format}, line }> —— line 为 1 起始行号
 *   body         string —— frontmatter 之后的正文（供链接存在性检查）
 *   bodyStartLine number —— body 首行在原文件中的 1 起始行号（无 frontmatter 时为 1）
 *   structureError string|null —— frontmatter 缺失或未闭合时为对应说明
 */
export function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  const attrs = new Map();

  if (lines[0]?.trim() !== "---") {
    return { attrs, body: text, bodyStartLine: 1, structureError: "缺少 frontmatter（首行应为 ---）" };
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex < 0) {
    return { attrs, body: "", bodyStartLine: 1, structureError: "frontmatter 未闭合（缺少结尾 ---）" };
  }

  // 先按键分组：键行 + 其后的缩进续行（块标量、嵌套块或多行折叠值）
  let current = null;
  for (let i = 1; i < closeIndex; i++) {
    const line = lines[i];
    const match = ATTR_LINE_RE.exec(line);
    if (match && !/^\s/.test(line)) {
      current = { key: match[1], rawFirst: match[2] ?? "", block: [], line: i + 1 };
      attrs.set(match[1], current);
    } else if (current && /^\s+\S/.test(line)) {
      current.block.push(line);
    }
    // 空行与顶格的无法识别行直接跳过：行级解析不追求 YAML 全覆盖，
    // 顶层键错位这类破坏会在规则层以「字段缺失」形式暴露
  }

  const parsed = new Map();
  for (const [key, attr] of attrs) {
    parsed.set(key, { value: classifyValue(attr.rawFirst, attr.block), line: attr.line });
  }

  return { attrs: parsed, body: lines.slice(closeIndex + 1).join("\n"), structureError: null };
}

/**
 * 把首行原始值 + 续行块分类为 { type, value, format }。
 * type: scalar | sequence | map；format: none | single | double（仅 scalar 有意义，
 * 用于区分裸布尔 true 与字符串 "true"）。
 */
function classifyValue(rawFirst, block) {
  const raw = rawFirst.trim();

  // 值为空：内容在后续缩进块里（嵌套 map、序列或多行折叠标量）
  if (raw === "") {
    const contentLines = block.map((l) => l.trim()).filter(Boolean);
    if (contentLines.length === 0) {
      return { type: "scalar", value: "", format: "none" };
    }
    if (contentLines[0].startsWith("- ")) {
      return { type: "sequence", value: contentLines, format: "none" };
    }
    if (/^[A-Za-z0-9_-]+\s*:/.test(contentLines[0])) {
      return { type: "map", value: contentLines, format: "none" };
    }
    return { type: "scalar", value: contentLines.join(" "), format: "none" };
  }

  // 块标量（| 保留换行 / > 折叠）一律是字符串
  if (BLOCK_SCALAR_RE.test(raw)) {
    const contentLines = block.map((l) => l.trim()).filter(Boolean);
    return { type: "scalar", value: contentLines.join("\n"), format: "none" };
  }

  // 流式集合：argument-hint 以 [ 开头的经典踩坑形态，YAML 视为序列而非字符串
  if (raw.startsWith("[")) {
    return { type: "sequence", value: raw, format: "none" };
  }
  if (raw.startsWith("{")) {
    return { type: "map", value: raw, format: "none" };
  }

  const dq = DOUBLE_QUOTED_RE.exec(raw);
  if (dq) {
    return { type: "scalar", value: dq[1], format: "double" };
  }
  const sq = SINGLE_QUOTED_RE.exec(raw);
  if (sq) {
    return { type: "scalar", value: sq[1], format: "single" };
  }

  // 普通标量：剥离行尾注释（# 前必须有空格，避免误伤 C# 之类内容）
  const noComment = raw.replace(/\s+#.*$/, "");
  return { type: "scalar", value: noComment.trim(), format: "none" };
}

/** 从正文中提取相对路径 Markdown 链接（跳过 URL、锚点、mailto 与模板占位） */
export function extractRelativeLinks(body) {
  const links = [];
  const LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = LINK_RE.exec(body)) !== null) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http(s):、mailto: 等带 scheme 的跳过
    if (target.startsWith("#") || target.startsWith("/")) continue;
    if (target.includes("{")) continue; // RFC 6570 式模板占位无法静态判定
    if (target.includes("*")) continue; // 通配目录指代（如 references/x.com/*.md）非具体文件
    links.push(target.split("#")[0]);
  }
  return links.filter(Boolean);
}
