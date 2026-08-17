#!/usr/bin/env node

/**
 * Project Translator CLI
 * 统一命令行入口
 * 
 * 模块化设计：CLI 负责参数解析和命令分发，
 * 实际功能由 commands/ 目录下的独立模块实现
 */

const path = require('path');

// 命令模块映射
const commands = {
  scan: () => require('./scan'),
  glossary: () => require('./glossary'),
  todo: () => require('./todo'),
  batch: () => require('./batch'),
  diff: () => require('./diff'),
  status: () => require('./status'),
  config: () => require('./config'),
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command || command === '--help' || command === '-h') {
    showHelp();
    return;
  }
  
  if (command === '--version' || command === '-v') {
    showVersion();
    return;
  }
  
  const commandLoader = commands[command];
  if (!commandLoader) {
    console.error(`错误: 未知命令 "${command}"`);
    console.error(`运行 "tp --help" 查看可用命令`);
    process.exit(1);
  }
  
  try {
    const loaded = commandLoader();
    // 支持默认导出和命名导出
    const handler = typeof loaded === 'function' ? loaded : (loaded.command || loaded.default || loaded);
    if (typeof handler !== 'function') {
      throw new Error(`命令模块未导出有效的处理函数`);
    }
    await handler(args.slice(1));
  } catch (error) {
    console.error(`错误: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
Project Translator (tp) - 项目翻译助手

用法: tp <command> [options]

命令:
  scan <path>          扫描项目，生成任务清单
  glossary <subcmd>    术语表管理
  todo <subcmd>        任务清单管理
  batch [options]      按文件大小动态分组
  diff <subcmd>        上游差异任务清单管理
  status <subcmd>      翻译状态跟踪
  config <subcmd>      配置管理

选项:
  -h, --help           显示帮助
  -v, --version        显示版本
  --debug              显示调试信息

示例:
  tp scan ./my-project
  tp glossary add ./terms.csv
  tp batch -w ./my-project --target-lines 600
  tp status record README.md --status completed -w ./my-project

详细信息:
  参阅 SKILL.md
`);
}

function showVersion() {
  const pkg = require('./package.json');
  console.log(`tp version ${pkg.version}`);
}

main();
