#!/usr/bin/env node

/**
 * batch 命令 - 按文件大小动态分组，输出第一批待翻译文件
 *
 * 用法: tp batch -w <项目路径> [--target-lines 600]
 */

const { getGitRoot } = require('./lib/git');
const { groupPendingTasksBySize } = require('./lib/todo');
const fs = require('fs');
const path = require('path');

function parseArgs(args) {
  const options = {
    workingDir: process.cwd(),
    targetLines: 600,
    showAll: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--working-dir' || arg === '-w') {
      options.workingDir = args[++i];
    } else if (arg === '--target-lines') {
      options.targetLines = parseInt(args[++i], 10) || 600;
    } else if (arg === '--all') {
      options.showAll = true;
    }
  }

  return options;
}

function showHelp() {
  console.log(`
动态分批

用法: tp batch [options]

选项:
  -w, --working-dir    指定工作目录
  --target-lines       每批目标行数（默认 600）
  --all                输出所有批次，批次之间用空行分隔

示例:
  tp batch -w ./my-project
  tp batch -w ./my-project --target-lines 400
  tp batch -w ./my-project --all
`);
}

async function command(args) {
  const options = parseArgs(args);

  // 自动定位到 Git 仓库根目录
  const gitRoot = getGitRoot(options.workingDir);
  if (gitRoot) {
    options.workingDir = gitRoot;
  }

  const todoPath = path.join(options.workingDir, '.todo', 'tp-tasks.md');
  if (!fs.existsSync(todoPath)) {
    console.log('任务清单不存在');
    return;
  }

  const batches = groupPendingTasksBySize(todoPath, options.targetLines);

  if (batches.length === 0) {
    console.log('没有待翻译的任务');
    return;
  }

  if (options.showAll) {
    // 输出所有批次，批次之间用空行分隔
    batches.forEach((batch, index) => {
      if (index > 0) console.log('');
      batch.forEach(filePath => console.log(filePath));
    });
  } else {
    // 只输出第一批
    batches[0].forEach(filePath => console.log(filePath));
  }
}

module.exports = command;

if (require.main === module) {
  command(process.argv.slice(2)).catch(error => {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  });
}
