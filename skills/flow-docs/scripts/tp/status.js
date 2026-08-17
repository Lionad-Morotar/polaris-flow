#!/usr/bin/env node

/**
 * status 命令 - 翻译状态跟踪
 *
 * 用法: tp status <subcommand> [options]
 */

const { getGitRoot } = require('./lib/git');
const {
  recordStatus,
  getCompletedIds,
  getFailedIds,
  getCompletedFiles,
  getFailedFiles,
  clearStatusFile
} = require('./lib/status');

const SUBCOMMANDS = {
  record,
  completed,
  failed,
  clear,
};

function parseArgs(args) {
  const options = {
    subcommand: null,
    args: [],
    workingDir: process.cwd(),
    type: 'file',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--working-dir' || arg === '-w') {
      options.workingDir = args[++i];
    } else if (arg === '--type') {
      options.type = args[++i];
    } else if (!options.subcommand && !arg.startsWith('-')) {
      options.subcommand = arg;
    } else {
      options.args.push(arg);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
翻译状态管理

用法: tp status <subcommand> [options]

子命令:
  record <id>           记录翻译状态（文件或 commit）
  completed            列出已完成的条目
  failed               列出失败的条目
  clear                清空状态文件

选项:
  -w, --working-dir    指定工作目录
  --type               条目类型：file（默认）或 commit
  --status             record 子命令使用：completed 或 failed
  --word-count         record 子命令使用：源语言字数
  --glossary-hits      record 子命令使用：术语表命中数

示例:
  tp status record README.md --status completed --word-count 1200 -w ./project
  tp status record abc1234 --status completed --type commit -w ./project
  tp status completed -w ./project
  tp status completed --type commit -w ./project
  tp status failed -w ./project
  tp status clear -w ./project
`);
}

function getProjectPath(options) {
  const gitRoot = getGitRoot(options.workingDir);
  return gitRoot || options.workingDir;
}

function parseStatus(rest) {
  let status = 'completed';
  const eqStatusIndex = rest.findIndex(arg => arg.startsWith('--status='));
  if (eqStatusIndex !== -1) {
    status = rest[eqStatusIndex].slice('--status='.length);
  } else {
    const statusIndex = rest.indexOf('--status');
    if (statusIndex !== -1 && rest[statusIndex + 1]) {
      status = rest[statusIndex + 1];
    }
  }
  return status;
}

function parseIntOption(rest, name) {
  const eqIndex = rest.findIndex(arg => arg.startsWith(`${name}=`));
  if (eqIndex !== -1) {
    return parseInt(rest[eqIndex].slice(`${name}=`.length), 10) || undefined;
  }
  const index = rest.indexOf(name);
  if (index !== -1 && rest[index + 1]) {
    return parseInt(rest[index + 1], 10) || undefined;
  }
  return undefined;
}

async function record(args, options) {
  const [id, ...rest] = args;

  if (!id) {
    throw new Error('请指定条目 id');
  }

  const status = parseStatus(rest);

  if (!['completed', 'failed'].includes(status)) {
    throw new Error('状态必须是 completed 或 failed');
  }

  const meta = {};
  const wordCount = parseIntOption(rest, '--word-count');
  if (wordCount !== undefined) meta.wordCount = wordCount;

  const glossaryHits = parseIntOption(rest, '--glossary-hits');
  if (glossaryHits !== undefined) meta.glossaryHits = glossaryHits;

  const projectPath = getProjectPath(options);
  recordStatus(projectPath, id, status, options.type, meta);

  const typeLabel = options.type === 'commit' ? 'commit' : '文件';
  console.log(`✓ 已记录状态: ${typeLabel} ${id} -> ${status}`);
}

async function completed(_args, options) {
  const projectPath = getProjectPath(options);

  let ids;
  if (options.type === 'commit') {
    ids = getCompletedIds(projectPath, 'commit');
  } else {
    ids = getCompletedFiles(projectPath);
  }

  if (ids.length === 0) {
    console.log('没有已完成的条目');
    return;
  }

  ids.forEach(id => console.log(id));
}

async function failed(_args, options) {
  const projectPath = getProjectPath(options);

  let ids;
  if (options.type === 'commit') {
    ids = getFailedIds(projectPath, 'commit');
  } else {
    ids = getFailedFiles(projectPath);
  }

  if (ids.length === 0) {
    console.log('没有失败的条目');
    return;
  }

  ids.forEach(id => console.log(id));
}

async function clear(_args, options) {
  const projectPath = getProjectPath(options);
  clearStatusFile(projectPath);
  console.log('✓ 已清空翻译状态文件');
}

async function command(args) {
  const options = parseArgs(args);

  if (!options.subcommand) {
    console.error('错误: 请指定子命令');
    showHelp();
    process.exit(1);
  }

  // 自动定位到 Git 仓库根目录
  const gitRoot = getGitRoot(options.workingDir);
  if (gitRoot) {
    options.workingDir = gitRoot;
  }

  const handler = SUBCOMMANDS[options.subcommand];
  if (!handler) {
    console.error(`错误: 未知子命令 "${options.subcommand}"`);
    showHelp();
    process.exit(1);
  }

  return await handler(options.args, options);
}

module.exports = command;

if (require.main === module) {
  command(process.argv.slice(2)).catch(error => {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  });
}
