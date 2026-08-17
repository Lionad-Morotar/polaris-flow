/**
 * 上游差异任务清单工具
 *
 * 与 tools/lib/todo.js 对称，用于管理 .todo/tp-diff-task.md
 */

const fs = require('fs');
const path = require('path');
const { escapeRegExp } = require('./str');

/**
 * 查找未完成的批次任务
 *
 * 清单行格式：`- [ ] <ref> <subject>`，ref 可以是 commit hash（回退粒度）
 * 或 tag 名（优先粒度）。正则放宽以同时支持两者。
 *
 * @param {string} diffTaskPath - 差异清单文件路径
 * @returns {Array<{ref: string, subject: string}>} 未完成的批次列表
 */
function findPendingCommits(diffTaskPath) {
  if (!fs.existsSync(diffTaskPath)) {
    throw new Error(`差异清单不存在: ${diffTaskPath}`);
  }

  const content = fs.readFileSync(diffTaskPath, 'utf-8');
  const lines = content.split('\n');
  const pendingCommits = [];

  for (const line of lines) {
    // ref 允许：十六进制 hash（commit）或 git ref 名（tag/分支，含字母数字._/-）
    const match = line.match(/^- \[ \] (\S+) (.*)$/);
    if (match) {
      pendingCommits.push({ ref: match[1], subject: match[2] });
    }
  }

  return pendingCommits;
}

/**
 * 生成 sed 命令来查找未完成的批次
 * @param {string} diffTaskPath - 差异清单文件路径
 * @returns {string} sed 命令
 */
function generateSedFindPendingCommand(diffTaskPath) {
  return `sed -n 's/^- \\[ \\] \\(\\S*\\) \\(.*\\)$/\\1 \\2/p' "${diffTaskPath}"`;
}

/**
 * 更新 commit 任务状态
 * @param {string} diffTaskPath - 差异清单文件路径
 * @param {string} commitId - commit id
 * @param {string} status - 状态
 */
function updateDiffTaskStatus(diffTaskPath, commitId, status) {
  if (!fs.existsSync(diffTaskPath)) {
    throw new Error(`差异清单不存在: ${diffTaskPath}`);
  }

  const content = fs.readFileSync(diffTaskPath, 'utf-8');
  const lines = content.split('\n');

  const pattern = new RegExp(`^- \\[(x| )\\] ${escapeRegExp(commitId)} `);
  let updated = false;
  const newLines = lines.map(line => {
    if (pattern.test(line)) {
      updated = true;
      if (status === 'completed') {
        return line.replace(/^- \[ \] /, '- [x] ');
      } else {
        return line.replace(/^- \[x\] /, '- [ ] ');
      }
    }
    return line;
  });

  if (!updated) {
    throw new Error(`在差异清单中未找到 commit: ${commitId}`);
  }

  fs.writeFileSync(diffTaskPath, newLines.join('\n'), 'utf-8');
}

/**
 * 写入差异清单文件
 *
 * 每行一个「批次」：基点→HEAD 之间按 tag 切分的对齐单元。ref 为该批次
 * 的 merge 目标（tag 名优先；无 tag 区间回退为 commit hash）。
 *
 * @param {Array<{ref: string, subject: string}>} batches - 批次列表
 * @param {string} outputPath - 输出路径
 */
function writeDiffTaskFile(batches, outputPath) {
  outputPath = path.resolve(outputPath);
  const outputDir = path.dirname(outputPath);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let content = '# 上游差异任务清单\n\n';
  for (const batch of batches) {
    const ref = batch.ref || batch.hash;
    content += `- [ ] ${ref} ${batch.subject}\n`;
  }

  fs.writeFileSync(outputPath, content, 'utf-8');
}

/**
 * 确保差异清单文件存在
 * @param {string} diffTaskPath - 差异清单文件路径
 */
function ensureDiffTaskFileExists(diffTaskPath) {
  diffTaskPath = path.resolve(diffTaskPath);
  const diffTaskDir = path.dirname(diffTaskPath);

  if (!fs.existsSync(diffTaskDir)) {
    fs.mkdirSync(diffTaskDir, { recursive: true });
  }

  if (!fs.existsSync(diffTaskPath)) {
    fs.writeFileSync(diffTaskPath, '# 上游差异任务清单\n\n', 'utf-8');
  }
}

module.exports = {
  findPendingCommits,
  generateSedFindPendingCommand,
  updateDiffTaskStatus,
  writeDiffTaskFile,
  ensureDiffTaskFileExists
};
