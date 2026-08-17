#!/usr/bin/env node

/**
 * config 命令 - 配置管理
 * 
 * 用法: tp config <subcommand> [options]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getGitRoot } = require('./lib/git');

const SUBCOMMANDS = {
  get,
  set,
  list,
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
配置管理

用法: tp config <subcommand> -w <path> [options]

子命令:
  get [key]            获取配置值
  set <key> <value>    设置配置值
  list                 列出配置

必填选项:
  -w, --working-dir <path>  指定工作目录（将自动定位到 Git 仓库根目录）

可选选项（互斥，只能使用其一）：
  -p, --project        仅使用项目配置
  -g, --global         仅使用个人全局配置
  -d, --default        仅使用默认配置

说明:
- -w 指定工作目录后，会自动使用 git rev-parse --show-toplevel 获取仓库根目录
- 不指定 -p/-g/-d 时，按优先级合并：项目 > 个人 > 默认
- 指定 -p/-g/-d 时，仅使用对应层级的配置
- set 子命令不能配合 -d 使用（默认配置只读）

示例:
  tp config list -w ./my-project
  tp config get targetLanguage -w ./my-project -g
  tp config set targetLanguage "中文" -w ./my-project
`);
}

function getConfigPath(source, workingDir) {
  switch (source) {
    case 'default':
      return path.join(__dirname, 'configs', 'setting.json');
    case 'global':
      return path.join(os.homedir(), '.tp', 'config.json');
    case 'project':
    default:
      return path.join(workingDir, '.tp', 'config.json');
  }
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfig(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

function loadConfig(source, workingDir) {
  // 如果指定了 source，只读取对应层级
  if (source) {
    const configPath = getConfigPath(source, workingDir);
    return {
      ...readConfig(configPath),
      _meta: { source }
    };
  }
  
  // 否则合并三层配置
  const defaultConfig = readConfig(getConfigPath('default', workingDir));
  const globalConfig = readConfig(getConfigPath('global', workingDir));
  const projectConfig = readConfig(getConfigPath('project', workingDir));
  
  return {
    ...defaultConfig,
    ...globalConfig,
    ...projectConfig,
    _meta: {
      project: Object.keys(projectConfig).length > 0,
      global: Object.keys(globalConfig).length > 0,
      default: Object.keys(defaultConfig).length > 0,
    }
  };
}

async function get(args, options) {
  const key = args[0];
  const config = loadConfig(options.source, options.workingDir);
  
  if (key) {
    const value = key.split('.').reduce((obj, k) => obj?.[k], config);
    console.log(value !== undefined ? value : '(未设置)');
  } else {
    const { _meta, ...rest } = config;
    console.log(JSON.stringify(rest, null, 2));
  }
}

async function set(args, options) {
  const [key, ...valueParts] = args;
  const value = valueParts.join(' ');
  
  if (!key || value === undefined) {
    throw new Error('请指定 key 和 value');
  }
  
  if (options.source === 'default') {
    throw new Error('不能修改默认配置，请使用 -p 或 -g');
  }
  
  // 默认写入项目配置，-g 时写入个人配置
  const targetSource = options.source === 'global' ? 'global' : 'project';
  const configPath = getConfigPath(targetSource, options.workingDir);
  const config = readConfig(configPath);
  
  // 支持嵌套 key
  const keys = key.split('.');
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) current[keys[i]] = {};
    current = current[keys[i]];
  }
  
  // 尝试解析为 JSON
  try {
    current[keys[keys.length - 1]] = JSON.parse(value);
  } catch {
    current[keys[keys.length - 1]] = value;
  }
  
  writeConfig(configPath, config);
  const configType = targetSource === 'global' ? '个人配置' : '项目配置';
  console.log(`${configType} 设置: ${key} = ${value}`);
}

async function list(args, options) {
  const config = loadConfig(options.source, options.workingDir);
  const { _meta, ...rest } = config;
  
  if (_meta.source) {
    console.log(`${_meta.source} 配置:`);
  } else {
    console.log('合并配置（项目 → 个人 → 默认）:');
  }
  
  console.log(JSON.stringify(rest, null, 2));
  
  if (!_meta.source) {
    console.log('\n配置来源:');
    console.log(`  项目配置: ${_meta.project ? '✓' : '✗'}`);
    console.log(`  个人配置: ${_meta.global ? '✓' : '✗'}`);
    console.log(`  默认配置: ${_meta.default ? '✓' : '✗'}`);
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
