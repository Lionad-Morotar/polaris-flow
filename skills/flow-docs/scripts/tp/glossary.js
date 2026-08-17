#!/usr/bin/env node

/**
 * glossary 命令 - 术语表管理
 * 
 * 用法: tp glossary <subcommand> -w <path> [options]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getGitRoot } = require('./lib/git');

const SUBCOMMANDS = {
  add,
  list,
  show,
  remove,
};

function parseArgs(args) {
  const options = {
    subcommand: null,
    args: [],
    workingDir: process.cwd(),
    source: null, // 'project' | 'global' | 'default' | null
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--working-dir' || arg === '-w') {
      options.workingDir = args[++i];
    } else if (arg === '--global' || arg === '-g') {
      if (options.source) throw new Error('选项 -p/-g/-d 互斥，只能使用其一');
      options.source = 'global';
    } else if (arg === '--project' || arg === '-p') {
      if (options.source) throw new Error('选项 -p/-g/-d 互斥，只能使用其一');
      options.source = 'project';
    } else if (arg === '--default' || arg === '-d') {
      if (options.source) throw new Error('选项 -p/-g/-d 互斥，只能使用其一');
      options.source = 'default';
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
术语表管理

用法: tp glossary <subcommand> -w <path> [options]

子命令:
  add <file>           添加术语表文件
  list                 列出所有术语表
  show <name>          查看术语表内容
  remove <name>        删除术语表

必填选项:
  -w, --working-dir <path>  指定工作目录（将自动定位到 Git 仓库根目录）

可选选项（互斥，只能使用其一）：
  -p, --project        仅使用项目术语表
  -g, --global         仅使用个人全局术语表
  -d, --default        仅使用默认术语表

说明:
- -w 指定工作目录后，会自动使用 git rev-parse --show-toplevel 获取仓库根目录
- 不指定 -p/-g/-d 时，显示所有层级术语表
- 指定 -p/-g/-d 时，仅操作对应层级的术语表
- add/remove 不能配合 -d 使用（默认术语表只读）

示例:
  tp glossary list -w ./my-project
  tp glossary show agent -w ./my-project
  tp glossary add ./terms.csv -w ./my-project -g
`);
}

function getGlossaryDir(source, workingDir) {
  switch (source) {
    case 'default':
      return path.join(__dirname, 'assets', 'glossary');
    case 'global':
      return path.join(os.homedir(), '.tp', 'glossary');
    case 'project':
    default:
      return path.join(workingDir, '.tp', 'glossary');
  }
}

function ensureGlossaryDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getGlossaryFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.csv') || f.endsWith('.toml'))
    .sort();
}

/**
 * 加载合并后的术语表（三层合并）
 */
function loadMergedGlossaries(source, workingDir) {
  const defaultDir = path.join(__dirname, 'assets', 'glossary');
  const globalDir = path.join(os.homedir(), '.tp', 'glossary');
  const projectDir = path.join(workingDir, '.tp', 'glossary');
  
  const result = {
    default: [],
    global: [],
    project: [],
    merged: {},
    _meta: {
      default: fs.existsSync(defaultDir),
      global: fs.existsSync(globalDir),
      project: fs.existsSync(projectDir),
    }
  };
  
  // 按优先级从低到高加载
  if (fs.existsSync(defaultDir)) {
    result.default = getGlossaryFiles(defaultDir).map(f => ({
      name: f.replace(/\.(csv|toml)$/i, ''),
      file: f,
      path: path.join(defaultDir, f),
      source: 'default'
    }));
  }
  
  if (fs.existsSync(globalDir)) {
    result.global = getGlossaryFiles(globalDir).map(f => ({
      name: f.replace(/\.(csv|toml)$/i, ''),
      file: f,
      path: path.join(globalDir, f),
      source: 'global'
    }));
  }
  
  if (fs.existsSync(projectDir)) {
    result.project = getGlossaryFiles(projectDir).map(f => ({
      name: f.replace(/\.(csv|toml)$/i, ''),
      file: f,
      path: path.join(projectDir, f),
      source: 'project'
    }));
  }
  
  // 构建合并索引（高优先级覆盖低优先级同名文件）
  [...result.default, ...result.global, ...result.project].forEach(g => {
    result.merged[g.name] = g;
  });
  
  return result;
}

/**
 * 添加术语表
 */
async function add(args, options) {
  const filePath = args[0];
  if (!filePath) {
    throw new Error('请指定术语表文件路径');
  }
  
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  
  const ext = path.extname(filePath).toLowerCase();
  if (!['.csv', '.toml'].includes(ext)) {
    throw new Error('只支持 CSV 或 TOML 格式');
  }
  
  if (options.source === 'default') {
    throw new Error('不能修改默认术语表，请使用 -p 或 -g');
  }
  
  // 默认写入项目术语表，-g 时写入个人术语表
  const targetSource = options.source === 'global' ? 'global' : 'project';
  const glossaryDir = getGlossaryDir(targetSource, options.workingDir);
  ensureGlossaryDir(glossaryDir);
  
  const fileName = path.basename(filePath);
  const destPath = path.join(glossaryDir, fileName);
  
  fs.copyFileSync(filePath, destPath);
  
  const sourceType = targetSource === 'global' ? '个人术语表' : '项目术语表';
  console.log(`添加术语表到 ${sourceType}: ${destPath}`);
}

/**
 * 列出术语表
 */
async function list(args, options) {
  const glossaries = loadMergedGlossaries(options.source, options.workingDir);
  
  // 如果指定了 source，仅显示对应层级
  if (options.source) {
    console.log(`${options.source} 术语表:`);
    const files = glossaries[options.source];
    if (files.length > 0) {
      files.forEach(g => console.log(`  - ${g.file}`));
    } else {
      console.log('  (无)');
    }
    return;
  }
  
  // 显示所有层级
  console.log('默认术语表:');
  if (glossaries.default.length > 0) {
    glossaries.default.forEach(g => console.log(`  - ${g.file}`));
  } else {
    console.log('  (无)');
  }
  
  console.log('\n个人术语表:');
  if (glossaries.global.length > 0) {
    glossaries.global.forEach(g => console.log(`  - ${g.file}`));
  } else {
    console.log('  (无)');
  }
  
  console.log('\n项目术语表:');
  if (glossaries.project.length > 0) {
    glossaries.project.forEach(g => console.log(`  - ${g.file}`));
  } else {
    console.log('  (无)');
  }
  
  console.log('\n实际生效的术语表（按优先级合并）:');
  const mergedNames = Object.keys(glossaries.merged);
  if (mergedNames.length > 0) {
    mergedNames.forEach(name => {
      const g = glossaries.merged[name];
      console.log(`  - ${name} (${g.source})`);
    });
  } else {
    console.log('  (无)');
  }
}

/**
 * 查看术语表
 */
async function show(args, options) {
  const name = args[0];
  if (!name) {
    throw new Error('请指定术语表名称');
  }
  
  // 如果指定了 source，直接从对应层级查找
  if (options.source) {
    const glossaryDir = getGlossaryDir(options.source, options.workingDir);
    const exts = ['.toml', '.csv'];
    let filePath = null;
    
    for (const ext of exts) {
      const tryPath = path.join(glossaryDir, name + ext);
      if (fs.existsSync(tryPath)) {
        filePath = tryPath;
        break;
      }
    }
    
    if (!filePath) {
      throw new Error(`${options.source} 术语表中不存在: ${name}`);
    }
    
    console.log(`来源: ${options.source} (${filePath})\n`);
    console.log(fs.readFileSync(filePath, 'utf8'));
    return;
  }
  
  // 按优先级查找
  const glossaries = loadMergedGlossaries(options.source, options.workingDir);
  const glossary = glossaries.merged[name];
  
  if (!glossary) {
    throw new Error(`术语表不存在: ${name}`);
  }
  
  console.log(`来源: ${glossary.source} (${glossary.path})\n`);
  console.log(fs.readFileSync(glossary.path, 'utf8'));
}

/**
 * 删除术语表
 */
async function remove(args, options) {
  const name = args[0];
  if (!name) {
    throw new Error('请指定术语表名称');
  }
  
  if (options.source === 'default') {
    throw new Error('不能删除默认术语表，请使用 -p 或 -g');
  }
  
  // 默认删除项目术语表，-g 时删除个人术语表
  const targetSource = options.source === 'global' ? 'global' : 'project';
  const glossaryDir = getGlossaryDir(targetSource, options.workingDir);
  
  const exts = ['.toml', '.csv'];
  let filePath = null;
  
  for (const ext of exts) {
    const tryPath = path.join(glossaryDir, name + ext);
    if (fs.existsSync(tryPath)) {
      filePath = tryPath;
      break;
    }
  }
  
  if (!filePath) {
    const sourceType = targetSource === 'global' ? '个人术语表' : '项目术语表';
    throw new Error(`${sourceType}中不存在: ${name}`);
  }
  
  fs.unlinkSync(filePath);
  const sourceType = targetSource === 'global' ? '个人术语表' : '项目术语表';
  console.log(`从 ${sourceType} 删除: ${filePath}`);
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
