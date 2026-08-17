const fs = require('fs');
const path = require('path');
const { escapeRegExp } = require('./str');
const { sortByPriority } = require('./priority');

/**
 * 查找剩余任务（使用 sed 模式）
 * @param {string} todoPath - 任务清单文件路径
 * @returns {Array} 剩余待翻译的文件路径列表
 */
function findPendingTasks(todoPath) {
  if (!fs.existsSync(todoPath)) {
    throw new Error(`任务清单不存在: ${todoPath}`);
  }

  const content = fs.readFileSync(todoPath, 'utf-8');
  const lines = content.split('\n');

  const pendingFiles = [];
  for (const line of lines) {
    const match = line.match(/^- \[ \] (.+)$/);
    if (match) {
      pendingFiles.push(match[1]);
    }
  }

  return pendingFiles;
}

/**
 * 生成 sed 命令来标记文件为已完成
 * @param {string} todoPath - 任务清单文件路径
 * @param {string} filePath - 文件路径
 * @returns {string} sed 命令
 */
function generateSedCompleteCommand(todoPath, filePath) {
  const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return `sed -i '' 's|^- \\[ \\] ${escapedPath}$|- [x] ${filePath}|' "${todoPath}"`;
}

/**
 * 生成 sed 命令来查找剩余任务（用于 grep/sed）
 * @param {string} todoPath - 任务清单文件路径
 * @returns {string} sed 命令
 */
function generateSedFindPendingCommand(todoPath) {
  return `sed -n 's/^- \\[ \\] \\(.*\\)$/\\1/p' "${todoPath}"`;
}

/**
 * 确保存在任务清单文件
 */
function ensureTodoFileExists(todoPath) {
  todoPath = path.resolve(todoPath);

  // 确保目录存在
  const todoDir = path.dirname(todoPath);
  if (!fs.existsSync(todoDir)) {
    fs.mkdirSync(todoDir, { recursive: true });
  }
  
  // 确保文件存在
  if (!fs.existsSync(todoPath)) {
    fs.writeFileSync(todoPath, '', 'utf-8');
  }
}

/**
 * 写入任务清单文件
 * @param {Array} files - 文件列表（string 或 { path, translated }）
 * @param {string} outputPath - 输出路径
 * @param {Object} config - 配置对象（可选，用于优先级排序）
 */
function writeTodoFile(files, outputPath, config = {}) {
  outputPath = path.resolve(outputPath);

  // 确保目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let items = (Array.isArray(files) ? files : [])
    .map(file => {
      if (typeof file === 'string') return { path: file, translated: false };
      if (file && typeof file === 'object') {
        const filePath = file.path || file.filePath;
        if (typeof filePath === 'string' && filePath) return { path: filePath, translated: Boolean(file.translated) };
      }
      return null;
    })
    .filter(Boolean);
  
  // 根据配置的优先级排序
  const priorityPatterns = config?.translation?.priority;
  items = sortByPriority(items, priorityPatterns);

  const translatedCount = items.filter(i => i.translated).length;
  const toTranslateCount = items.length - translatedCount;

  let content = '# 项目翻译任务清单\n\n';
  items.forEach(item => {
    content += `- [${item.translated ? 'x' : ' '}] ${item.path}\n`;
  });

  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`已生成待翻译清单: ${outputPath}`);
  console.log(`项目内涉及 ${items.length} 个文件，其中 ${translatedCount} 个文件已翻译，剩余 ${toTranslateCount} 个文件需要翻译`);
}

/**
 * 读取任务清单
 * @param {string} todoPath - 任务清单文件路径
 * @returns {Array} 已完成的文件列表
 */
function readTodoList(todoPath) {
  if (!fs.existsSync(todoPath)) {
    throw new Error(`任务清单不存在: ${todoPath}`);
  }

  const content = fs.readFileSync(todoPath, 'utf-8');
  const lines = content.split('\n');

  const completedFiles = [];
  for (const line of lines) {
    const match = line.match(/^- \[x\] (.+)$/);
    if (match) {
      completedFiles.push(match[1]);
    }
  }

  return completedFiles;
}

/**
 * 更新任务状态
 * @param {string} todoPath - 任务清单文件路径
 * @param {string} filePath - 文件路径
 * @param {string} status - 状态
 */
function updateTodoStatus(todoPath, filePath, status) {
  if (!fs.existsSync(todoPath)) {
    throw new Error(`任务清单不存在: ${todoPath}`);
  }

  const content = fs.readFileSync(todoPath, 'utf-8');
  const lines = content.split('\n');

  const pattern = new RegExp(`^- \\[(x| )\\] ${escapeRegExp(filePath)}$`);
  let updated = false;
  const newLines = lines.map(line => {
    if (pattern.test(line)) {
      updated = true;
      if (status === 'completed') {
        return `- [x] ${filePath}`;
      } else {
        return `- [ ] ${filePath}`;
      }
    }
    return line;
  });

  if (!updated) {
    throw new Error(`在任务清单中未找到文件: ${filePath}`);
  }

  fs.writeFileSync(todoPath, newLines.join('\n'), 'utf-8');
  console.log(`已更新任务清单: ${filePath} -> ${status}`);
}

/**
 * 估算文件的文本行数（用于动态分批）
 * @param {string} filePath - 文件路径
 * @returns {number} 非空行数
 */
function estimateTextLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split(/\r?\n/)
      .filter(line => line.trim().length > 0)
      .length;
  } catch (error) {
    return 0;
  }
}

/**
 * 按文件文本量动态分组
 * @param {string} todoPath - 任务清单文件路径
 * @param {number} targetLines - 每批目标行数（默认 600）
 * @returns {Array<Array<string>>} 批次数组，每个元素是文件路径数组
 */
function groupPendingTasksBySize(todoPath, targetLines = 600) {
  const pendingFiles = findPendingTasks(todoPath);
  if (pendingFiles.length === 0) return [];

  const filesWithSize = pendingFiles.map(filePath => ({
    path: filePath,
    lines: estimateTextLines(filePath)
  }));

  // 从大到小排序，便于贪心分组
  filesWithSize.sort((a, b) => b.lines - a.lines);

  const batches = [];
  const overflowRatio = 1.5;

  for (const file of filesWithSize) {
    let bestBatch = null;
    let bestDiff = Infinity;

    // 找到加入后最接近 targetLines 的批次
    for (const batch of batches) {
      const newTotal = batch.totalLines + file.lines;
      const diff = Math.abs(newTotal - targetLines);
      if (newTotal <= targetLines * overflowRatio && diff < bestDiff) {
        bestDiff = diff;
        bestBatch = batch;
      }
    }

    if (bestBatch) {
      bestBatch.files.push(file.path);
      bestBatch.totalLines += file.lines;
    } else {
      batches.push({ files: [file.path], totalLines: file.lines });
    }
  }

  return batches.map(batch => batch.files);
}

/**
 * 获取当前第一个批次
 * @param {string} todoPath - 任务清单文件路径
 * @param {number} targetLines - 每批目标行数
 * @returns {Array<string>} 文件路径数组
 */
function getPendingBatch(todoPath, targetLines = 600) {
  const batches = groupPendingTasksBySize(todoPath, targetLines);
  return batches.length > 0 ? batches[0] : [];
}

module.exports = {
  ensureTodoFileExists,
  writeTodoFile,
  readTodoList,
  updateTodoStatus,
  findPendingTasks,
  generateSedCompleteCommand,
  generateSedFindPendingCommand,
  groupPendingTasksBySize,
  getPendingBatch
};
