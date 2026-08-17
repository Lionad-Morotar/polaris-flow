#!/usr/bin/env node

/**
 * diff 命令 - 上游差异任务清单管理
 *
 * 用法: tp diff <subcommand> [options]
 */

const fs = require('fs');
const path = require('path');
const { getGitRoot, getCurrentTag, getTagSourceCommit, getMergeBatches } = require('./lib/git');
const { findPendingCommits, updateDiffTaskStatus, writeDiffTaskFile } = require('./lib/diff-task');

const SUBCOMMANDS = {
  init,
  pending,
  next,
  update,
  clear,
};

function parseArgs(args) {
  const options = {
    subcommand: null,
    args: [],
    workingDir: process.cwd(),
    upstream: 'upstream/main',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--working-dir' || arg === '-w') {
      options.workingDir = args[++i];
    } else if (arg === '--upstream') {
      options.upstream = args[++i];
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
上游对齐批次清单管理

用法: tp diff <subcommand> [options]

子命令:
  init              根据 upstream 生成对齐批次清单（tag 优先，无 tag 回退逐 commit）
  pending           列出未完成的批次
  next              输出下一个待对齐批次的 ref（tag 名或 commit hash）
  update <ref>      更新批次状态（ref 为 tag 名或 commit hash）
  clear             删除批次清单

选项:
  -w, --working-dir    指定工作目录
  --upstream           上游分支（默认 upstream/main）

示例:
  tp diff init -w ./my-project
  tp diff pending -w ./my-project
  tp diff next -w ./my-project
  tp diff update v0.8.2 --status=completed -w ./my-project
  tp diff clear -w ./my-project
`);
}

function getProjectPath(options) {
  const gitRoot = getGitRoot(options.workingDir);
  return gitRoot || options.workingDir;
}

function getSourceCommit(projectPath) {
  const { execSync } = require('child_process');
  const tag = getCurrentTag(projectPath);
  if (tag) {
    const shortHash = getTagSourceCommit(tag);
    if (shortHash) {
      // tag 里存的是短 hash，补全为完整 hash 以便与 targetCommit 严格比较
      try {
        return execSync(`git rev-parse ${shortHash}`, {
          cwd: projectPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
      } catch (error) {
        return null;
      }
    }
    // tag 不是 v-<hash> 格式：直接解引用 tag 到 commit
    try {
      return execSync(`git rev-parse ${tag}^{commit}`, {
        cwd: projectPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
    } catch (error) {
      return null;
    }
  }

  // 没有 tag 时默认使用 origin/main
  try {
    return execSync('git rev-parse origin/main', {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    return null;
  }
}

async function init(_args, options) {
  const projectPath = getProjectPath(options);

  const sourceCommit = getSourceCommit(projectPath);
  if (!sourceCommit) {
    throw new Error('无法确定 source commit，请确保存在 tag 或 origin/main');
  }

  let targetCommit;
  try {
    const { execSync } = require('child_process');
    targetCommit = execSync(`git rev-parse ${options.upstream}^{commit}`, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch (error) {
    throw new Error(`无法解析上游分支: ${options.upstream}`);
  }

  if (sourceCommit === targetCommit) {
    console.log('当前项目的翻译已经是最新的啦！');
    return;
  }

  const batches = getMergeBatches(projectPath, sourceCommit, targetCommit);

  if (batches.length === 0) {
    console.log('当前项目的翻译已经是最新的啦！');
    return;
  }

  const diffTaskPath = path.join(projectPath, '.todo', 'tp-diff-task.md');
  writeDiffTaskFile(batches, diffTaskPath);
  console.log(`已生成对齐批次清单: ${diffTaskPath}`);
  console.log(`共 ${batches.length} 个批次（基点 ${sourceCommit.slice(0, 7)} → 目标 ${targetCommit.slice(0, 7)}）`);
  const tagCount = batches.filter(b => !/^[a-f0-9]+$/i.test(b.ref)).length;
  if (tagCount > 0) {
    console.log(`其中 ${tagCount} 个以 release tag 为边界，其余为 commit 回退批次`);
  } else {
    console.log(`区间内无 release tag，已回退为逐 commit 批次`);
  }
}

async function pending(_args, options) {
  const projectPath = getProjectPath(options);
  const diffTaskPath = path.join(projectPath, '.todo', 'tp-diff-task.md');

  if (!fs.existsSync(diffTaskPath)) {
    console.log('对齐批次清单不存在');
    return;
  }

  const batches = findPendingCommits(diffTaskPath);

  if (batches.length === 0) {
    console.log('没有待处理的对齐批次');
    return;
  }

  console.log(`剩余 ${batches.length} 个待处理批次：`);
  batches.forEach((batch, index) => {
    console.log(`${index + 1}. ${batch.ref} ${batch.subject}`);
  });
}

async function next(_args, options) {
  const projectPath = getProjectPath(options);
  const diffTaskPath = path.join(projectPath, '.todo', 'tp-diff-task.md');

  if (!fs.existsSync(diffTaskPath)) {
    console.log('对齐批次清单不存在');
    return;
  }

  const batches = findPendingCommits(diffTaskPath);

  if (batches.length === 0) {
    console.log('没有待处理的对齐批次');
    return;
  }

  console.log(batches[0].ref);
}

async function update(args, options) {
  const [ref, ...rest] = args;

  if (!ref) {
    throw new Error('请指定批次 ref（tag 名或 commit hash）');
  }

  let status = 'done';
  const eqIndex = rest.findIndex(arg => arg.startsWith('--status='));
  if (eqIndex !== -1) {
    status = rest[eqIndex].slice('--status='.length);
  } else {
    const statusIndex = rest.indexOf('--status');
    if (statusIndex !== -1 && rest[statusIndex + 1]) {
      status = rest[statusIndex + 1];
    }
  }

  const normalizedStatus = status === 'completed' ? 'completed' : 'done';

  const projectPath = getProjectPath(options);
  const diffTaskPath = path.join(projectPath, '.todo', 'tp-diff-task.md');

  if (!fs.existsSync(diffTaskPath)) {
    throw new Error('对齐批次清单不存在');
  }

  updateDiffTaskStatus(diffTaskPath, ref, normalizedStatus);
  console.log(`✓ 已更新批次清单: ${ref} -> ${normalizedStatus}`);
}

async function clear(_args, options) {
  const projectPath = getProjectPath(options);
  const diffTaskPath = path.join(projectPath, '.todo', 'tp-diff-task.md');

  if (fs.existsSync(diffTaskPath)) {
    fs.unlinkSync(diffTaskPath);
    console.log('已清空差异清单');
  } else {
    console.log('差异清单不存在');
  }
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
