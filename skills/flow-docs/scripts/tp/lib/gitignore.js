const fs = require('fs');
const path = require('path');

function readGitignore(projectPath) {
  const gitignorePath = path.join(projectPath, '.gitignore');

  if (!fs.existsSync(gitignorePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    const lines = content.split('\n').map(line => line.trim());

    return lines.filter(line => line && !line.startsWith('#'));
  } catch (error) {
    console.warn(`警告: 无法读取 .gitignore 文件: ${error.message}`);
    return [];
  }
}

/**
 * 判断文件是否被 .gitignore 忽略
 * @param {string} filePath - 文件路径
 * @param {string} projectPath - 项目路径
 * @param {Array} gitignorePatterns - 忽略规则列表
 * @returns {boolean} 是否被忽略
 */
function isIgnoredByGitignore(filePath, projectPath, gitignorePatterns) {
  const relativePath = path.relative(projectPath, filePath);

  for (const pattern of gitignorePatterns) {
    if (relativePath.startsWith(pattern) || relativePath.includes(pattern)) {
      return true;
    }

    if (pattern.endsWith('/')) {
      const dirPattern = pattern.slice(0, -1);
      const relativeDir = path.dirname(relativePath);
      if (relativeDir === dirPattern || relativeDir.startsWith(dirPattern + '/')) {
        return true;
      }
    }

    if (pattern.includes('*')) {
      const regexPattern = pattern
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      const regex = new RegExp(regexPattern);
      if (regex.test(relativePath) || regex.test(path.basename(relativePath))) {
        return true;
      }
    }
  }

  return false;
}

module.exports = {
  readGitignore,
  isIgnoredByGitignore
};
