#!/usr/bin/env node

/**
 * 文件扫描器 - 模块化扫描功能
 */

const fs = require('fs');
const path = require('path');
const { readGitignore, isIgnoredByGitignore } = require('./gitignore');
const { shouldExcludeFile, shouldExcludeDir, isSupportedFile } = require('./filter');
const { isFileTranslated } = require('./lang');
const { sortByPriority } = require('./priority');

class FileScanner {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 扫描项目目录
   */
  async scan(projectPath) {
    projectPath = path.resolve(projectPath);
    const files = [];

    const ignoreGitignore = this.config?.fileFilters?.ignoreGitignore || false;
    const gitignorePatterns = ignoreGitignore ? readGitignore(projectPath) : [];
    const taskTrackingFile = this.config?.taskTrackingFile || '.todo/tp-tasks.md';
    const taskTrackingFilePath = path.isAbsolute(taskTrackingFile)
      ? path.resolve(taskTrackingFile)
      : path.resolve(projectPath, taskTrackingFile);

    const scanDir = async (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (shouldExcludeDir(entry.name, this.config)) continue;
          await scanDir(fullPath);
        } else if (entry.isFile()) {
          if (path.resolve(fullPath) === taskTrackingFilePath) continue;
          if (shouldExcludeFile(entry.name, this.config)) continue;

          // 检查 .gitignore
          if (ignoreGitignore && isIgnoredByGitignore(fullPath, projectPath, gitignorePatterns)) {
            continue;
          }

          if (isSupportedFile(entry.name, this.config)) {
            const translated = await isFileTranslated(fullPath, this.config);
            files.push({ 
              path: fullPath, 
              translated,
              relativePath: path.relative(projectPath, fullPath),
            });
          }
        }
      }
    };

    await scanDir(projectPath);
    // 根据配置的优先级排序
const priorityPatterns = this.config?.translation?.priority;
return sortByPriority(files, priorityPatterns);
  }

  /**
   * 检查单个文件的翻译状态
   */
  async checkFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`文件不存在: ${filePath}`);
    }

    const translated = await isFileTranslated(filePath, this.config);
    return {
      path: filePath,
      translated,
    };
  }
}

module.exports = FileScanner;
