/**
 * dead-links:SKILL.md 的 markdown 链接必须指向仓内跟踪文件。
 *
 * SKILL.md 是开源分发面的一部分,markdown 链接指向本地独有文件
 * (references/ 下的本地积累,被 .gitignore 排除)对外部用户既是死链,
 * 又把本机目录结构与内容摘要泄漏进公开文档。形态纪律:本地文件一律
 * 用代码跨度提及,markdown 链接只准指向跟踪文件——本检查把该纪律
 * 变成推送前的硬闸,与 forbidden-paths(防文件入库)互补:后者挡文件,
 * 本检查挡「对文件的引用」。
 */

import { execFileSync } from "node:child_process";

// 只处理 references/ 相对链接;http(s) 与仓内其他相对路径不在本策略范围
function extractRefTargets(content) {
  const targets = [];
  const re = /\]\((references\/[^)\s]+)\)/g;
  let m;
  while ((m = re.exec(content)) !== null) targets.push(m[1]);
  return targets;
}

/**
 * 检查指定提交的树中,被触及的 SKILL.md 是否有 markdown 链接指向未跟踪文件。
 * 以推送提交的树为准(而非工作区),与工作区里本地文件是否存在无关。
 *
 * @param {string} repoDir 仓库根目录
 * @param {string} sha 被推送的提交(取其树作准)
 * @param {string[]} skillMdPaths 该范围内触及的 SKILL.md 路径
 * @returns {{file: string, target: string}[]} 死链命中清单
 */
export function checkDeadLinks(repoDir, sha, skillMdPaths) {
  const hits = [];
  for (const file of skillMdPaths) {
    let content;
    try {
      content = execFileSync("git", ["show", `${sha}:${file}`], { cwd: repoDir, encoding: "utf8" });
    } catch {
      continue; // 该提交里文件被删除或改名,无从校验
    }
    const dir = file.slice(0, file.lastIndexOf("/"));
    for (const raw of extractRefTargets(content)) {
      const target = raw.split("#")[0];
      if (!target) continue;
      // 通配链接(references/x/*.md)校验通配符之前的目录部分
      const probe = target.includes("*") ? target.slice(0, target.indexOf("*")).replace(/\/+$/, "") : target;
      try {
        execFileSync("git", ["cat-file", "-e", `${sha}:${dir}/${probe}`], { cwd: repoDir, stdio: "ignore" });
      } catch {
        hits.push({ file, target: raw });
      }
    }
  }
  return hits;
}
