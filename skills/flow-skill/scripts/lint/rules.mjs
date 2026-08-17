/**
 * skill 类型 frontmatter 校验规则。
 *
 * 规则逐条移植自 VSCode 内置校验器 promptValidator.ts（validateSkillAttributes /
 * validateName / validateDescription / validateArgumentHint / validateUserInvocable /
 * validateDisableModelInvocation / checkForInvalidArguments / validateBody），
 * 剔除依赖 GitHub Copilot 设置的「context: fork 需开 skillTool」一条——该规则
 * 面向 Copilot 运行时，对 Claude Code 技能无意义。
 * 移植规则之外另含一条本地仓库约定规则（no-tables，见正文校验段）。
 * 级别映射：error 阻断（退出码 1）、warning 提醒（--strict 时阻断）、info 仅记录
 * （对应 VSCode 的 Hint + Unnecessary 灰显，未知字段在 agent 生态里通常只是
 * 别家扩展，不值得告警）。
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { extractRelativeLinks } from "./frontmatter.mjs";

// 与 VSCode 的 skill 白名单一致（promptValidator.ts allAttributeNames[skill]）
export const KNOWN_ATTRIBUTES = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "argument-hint",
  "user-invocable",
  "disable-model-invocation",
  "context",
];

// 与 VSCode 的 VALID_SKILL_NAME_REGEX 一致
const SKILL_NAME_RE = /^[a-z0-9-]+$/;

function isBareBoolean(value) {
  return (
    value.type === "scalar" &&
    (value.value === "true" || value.value === "false") &&
    value.format === "none"
  );
}

function bareBooleanOf(attrs, key) {
  const attr = attrs.get(key);
  if (!attr || !isBareBoolean(attr.value)) return undefined;
  return attr.value.value === "true";
}

/**
 * 校验单个 SKILL.md。
 * 输入：skillFile 绝对路径、parseFrontmatter 的产出。
 * 产出：findings[]，元素 { severity: error|warning|info, line, rule, message }。
 */
export function lintSkill(skillFile, { attrs, body, bodyStartLine = 1, structureError }) {
  const findings = [];
  const push = (severity, line, rule, message) => findings.push({ severity, line, rule, message });

  if (structureError) {
    // VSCode 在 header 缺失时静默跳过 skill 校验，但那是把 YAML 诊断交给了别的管线；
    // 本 linter 是唯一管线，frontmatter 坏了必须显式报错
    push("error", 1, "frontmatter-structure", structureError);
    return findings;
  }

  const nameAttr = attrs.get("name");
  const descAttr = attrs.get("description");
  const hintAttr = attrs.get("argument-hint");

  // ---- name ----
  if (!nameAttr) {
    push("warning", 1, "name-missing", "缺少 name 字段");
  } else {
    if (nameAttr.value.type !== "scalar") {
      push("error", nameAttr.line, "name-not-string", "name 必须是字符串");
    } else {
      const skillName = nameAttr.value.value.trim();
      if (skillName.length === 0) {
        push("error", nameAttr.line, "name-empty", "name 不能为空");
      } else {
        if (!SKILL_NAME_RE.test(skillName)) {
          push(
            "error",
            nameAttr.line,
            "name-invalid-chars",
            `name 只能包含小写字母、数字和连字符: ${skillName}`,
          );
        }
        const folderName = path.basename(path.dirname(skillFile));
        if (folderName && skillName !== folderName) {
          push(
            "warning",
            nameAttr.line,
            "name-folder-mismatch",
            `name「${skillName}」应与所在文件夹名「${folderName}」一致`,
          );
        }
      }
    }
  }

  // ---- description ----
  if (!descAttr) {
    push("warning", 1, "description-missing", "缺少 description 字段");
    // description 缺失时，模型完全靠 description 决定何时加载技能，
    // 此时若显式声明「仅用户调用」或「允许模型调用」都自相矛盾，VSCode 判 error
    if (bareBooleanOf(attrs, "user-invocable") === false) {
      push(
        "error",
        attrs.get("user-invocable").line,
        "user-invocable-requires-description",
        "user-invocable 为 false 时必须提供 description（模型要靠它决定何时加载技能）",
      );
    }
    if (bareBooleanOf(attrs, "disable-model-invocation") === false) {
      push(
        "error",
        attrs.get("disable-model-invocation").line,
        "model-invocation-requires-description",
        "启用模型调用（disable-model-invocation: false）时必须提供 description",
      );
    }
  } else {
    if (descAttr.value.type !== "scalar") {
      push("error", descAttr.line, "description-not-string", "description 必须是字符串");
    } else if (descAttr.value.value.trim().length === 0) {
      push("error", descAttr.line, "description-empty", "description 不能为空");
    }
  }

  // ---- argument-hint ----
  // 值以 [ 开头会被 YAML 解析成 flow sequence 而非字符串，是真实踩过的坑：
  // 修法是给整值加引号，而不是在值前面塞占位词
  if (hintAttr) {
    if (hintAttr.value.type !== "scalar") {
      push(
        "error",
        hintAttr.line,
        "argument-hint-not-string",
        "argument-hint 必须是字符串（值以 [ 或 { 开头会被 YAML 解析成集合，应加引号）",
      );
    } else if (hintAttr.value.value.trim().length === 0) {
      push("warning", hintAttr.line, "argument-hint-empty", "argument-hint 不应为空");
    }
  }

  // ---- 布尔字段：必须是无引号裸 true/false ----
  // 带引号的 "true" 在 YAML 里是字符串，运行时读取会得到 truthy 字符串而非布尔，
  // 与本意的差别潜伏到行为分支才暴露，所以连引号形式也判错
  for (const key of ["user-invocable", "disable-model-invocation"]) {
    const attr = attrs.get(key);
    if (attr && !isBareBoolean(attr.value)) {
      push(
        "error",
        attr.line,
        `${key}-not-boolean`,
        `${key} 必须是无引号的 true 或 false`,
      );
    }
  }

  // ---- metadata.version：存在时必须是 alpha 或合法 semver ----
  // 该字段是 state.json 打标与 resume 漂移判定的机器契约（由 bump.mjs 维护），
  // 手写出的畸形版本会让版本比较静默失效，所以判 error 而非 warning；
  // alpha 是新技能打磨期的合法形态；semver 含 prerelease/build 后缀
  // （0.1.0-alpha.0、1.0.0-beta.1+build 等，版本化约定见 create-skill.md）
  const metaAttr = attrs.get("metadata");
  if (metaAttr && metaAttr.value.type === "map" && Array.isArray(metaAttr.value.value)) {
    for (const line of metaAttr.value.value) {
      const m = /^version\s*:\s*"?([^"\s]+)"?\s*$/.exec(line);
      if (m && m[1] !== "alpha" && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(m[1])) {
        push("error", metaAttr.line, "metadata-version-invalid", `metadata.version 必须是 alpha 或 semver（x.y.z，可含 prerelease 后缀），当前: ${m[1]}`);
      }
    }
  }

  // ---- 未知字段 ----
  // agent 生态字段各家不一（Claude Code 的 allowed-tools、Copilot 的 mcp-servers 等），
  // 跨 runtime 共享技能时白名单外字段是常态，只记 info 不告警
  for (const [key, attr] of attrs) {
    if (!KNOWN_ATTRIBUTES.includes(key)) {
      push(
        "info",
        attr.line,
        "unknown-attribute",
        `字段 ${key} 不在 skill 标准白名单内（支持: ${KNOWN_ATTRIBUTES.join(", ")}）`,
      );
    }
  }

  // ---- 正文相对链接存在性 ----
  // 渐进披露的文件只有被正文提及才会被 agent 加载，断链等于死引用；
  // skill 目录下 .body-link-ignore（每行一个路径前缀）声明的本地积累目录
  // （gitignored 的 references/ 等）对仓库读者天然不存在，跳过存在性检查
  const skillDir = path.dirname(skillFile);
  const ignoreFile = path.join(skillDir, ".body-link-ignore");
  const ignoredPrefixes = existsSync(ignoreFile)
    ? readFileSync(ignoreFile, "utf-8").split("\n").map((l) => l.trim()).filter(Boolean)
    : [];
  for (const link of extractRelativeLinks(body)) {
    if (ignoredPrefixes.some((p) => link === p || link.startsWith(p.endsWith("/") ? p : `${p}/`))) continue;
    if (!existsSync(path.resolve(skillDir, link))) {
      push("warning", 1, "broken-body-link", `正文引用的文件不存在: ${link}`);
    }
  }

  // ---- 正文表格：禁用（本仓文档约定，非 VSCode 移植规则）----
  // 参数/字段/对比/路由一律用列表承载；代码围栏内的表格是示例内容不算违规。
  // 锚点取表格分隔行（GFM 表格的充分特征），误报面几乎为零
  const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
  const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
  const bodyLines = body.split("\n");
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const ch = fence[1][0];
      // 关闭围栏须同字符、不短于开启长度且整行仅由围栏字符组成（带 info string 的开栏不关闭）
      if (inFence && ch === fenceChar && fence[1].length >= fenceLen && line.trim() === fence[1]) {
        inFence = false;
      } else if (!inFence) {
        inFence = true;
        fenceChar = ch;
        fenceLen = fence[1].length;
      }
      continue;
    }
    if (!inFence && TABLE_SEP_RE.test(line)) {
      push("warning", bodyStartLine + i, "no-tables", "文档约定禁用表格，参数/字段/对比等请改用列表");
    }
  }

  return findings;
}
