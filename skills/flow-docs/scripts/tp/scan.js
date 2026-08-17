#!/usr/bin/env node

/**
 * scan 命令 - 扫描项目生成任务清单
 * 
 * 用法: tp scan <path> [options]
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, writeTodoFile } = require('./lib');
const scanner = require('./lib/scanner');

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const options = {
    path: null,
    format: 'markdown',  // markdown | json
    output: null,        // 自定义输出路径
    verbose: false,
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--format' || arg === '-f') {
      options.format = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (!arg.startsWith('-') && !options.path) {
      options.path = arg;
    }
  }
  
  return options;
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(`
扫描项目，生成待翻译文件清单

用法: tp scan <path> [options]

参数:
  <path>                项目路径

选项:
  -f, --format <type>   输出格式: markdown (默认) | json
  -o, --output <path>   自定义输出路径
  -v, --verbose         显示详细信息
  -h, --help           显示帮助

示例:
  tp scan ./my-project
  tp scan ./my-project --format=json
  tp scan ./my-project --output=./custom-tasks.md
`);
}

/**
 * 执行扫描
 */
async function scan(options) {
  const projectPath = path.resolve(options.path);
  
  // 检查路径是否存在
  if (!fs.existsSync(projectPath)) {
    throw new Error(`项目路径不存在: ${projectPath}`);
  }
  
  // 加载配置
  const config = loadConfig(projectPath);
  if (options.verbose) {
    console.log(`配置来源: ${config._source || 'default'}`);
  }
  
  // 创建扫描器
  const fileScanner = new scanner(config);
  
  // 执行扫描
  if (options.verbose) {
    console.log(`正在扫描: ${projectPath}`);
  }
  
  const files = await fileScanner.scan(projectPath);
  
  // 统计
  const stats = {
    total: files.length,
    translated: files.filter(f => f.translated).length,
    pending: files.filter(f => !f.translated).length,
  };
  stats.percentage = stats.total > 0 
    ? Math.round((stats.translated / stats.total) * 100) 
    : 0;
  
  // 确定输出路径
  const outputPath = options.output || path.join(
    projectPath, 
    config.taskTrackingFile || '.todo/tp-tasks.md'
  );
  
  // 输出结果
  if (options.format === 'json') {
    console.log(JSON.stringify({ stats, files }, null, 2));
  } else {
    // 生成任务清单
    writeTodoFile(files, outputPath, config);
    
    console.log(`
扫描完成:
  总文件数: ${stats.total}
  已翻译: ${stats.translated}
  待翻译: ${stats.pending}
  翻译率: ${stats.percentage}%
  任务清单: ${outputPath}
`);
  }
  
  return { stats, files, outputPath };
}

/**
 * 命令入口
 */
async function command(args) {
  const options = parseArgs(args);
  
  if (!options.path) {
    console.error('错误: 请指定项目路径');
    showHelp();
    process.exit(1);
  }
  
  return await scan(options);
}

/**
 * 扫描项目（供程序调用）
 */
async function scanProject(projectPath, config) {
  const resolvedPath = path.resolve(projectPath);
  
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`项目路径不存在: ${resolvedPath}`);
  }
  
  const fileScanner = new scanner(config);
  const files = await fileScanner.scan(resolvedPath);
  
  return files.map(f => ({
    path: f.path,
    translated: f.translated
  }));
}

module.exports = { command, scan, scanProject };
module.exports.default = command;

// 直接运行
if (require.main === module) {
  command(process.argv.slice(2)).catch(error => {
    console.error(`错误: ${error.message}`);
    process.exit(1);
  });
}
