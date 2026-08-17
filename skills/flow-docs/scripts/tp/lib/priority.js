const path = require('path');

/**
 * 检查字符串是否匹配 glob 模式
 * @param {string} str - 要检查的字符串
 * @param {string} pattern - glob 模式（如 "*.md", "docs/**"）
 * @returns {boolean}
 */
function matchGlob(str, pattern) {
  // 将 glob 模式转为正则表达式
  let regexPattern = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')  // 临时替换 **
    .replace(/\*/g, '[^/]*')           // * 匹配任意非斜杠字符
    .replace(/\?/g, '.')               // ? 匹配单个字符
    .replace(/\{\{GLOBSTAR\}\}/g, '.*'); // ** 匹配任意字符包括斜杠
  
  // 处理目录结尾的斜杠（如 "docs/" 应该匹配 "docs" 目录下的内容）
  if (pattern.endsWith('/')) {
    regexPattern = regexPattern + '.*';
  }
  
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(str);
}

/**
 * 计算文件的优先级分数
 * @param {string} filePath - 文件路径
 * @param {Array<string>} priorityPatterns - 优先级模式数组
 * @returns {number} - 分数（越高越优先）
 */
function calculatePriorityScore(filePath, priorityPatterns = []) {
  if (!Array.isArray(priorityPatterns) || priorityPatterns.length === 0) {
    return 0;
  }

  const fileName = path.basename(filePath);
  const normalizedPath = filePath.replace(/\\/g, '/');
  
  let score = 0;
  
  for (let i = 0; i < priorityPatterns.length; i++) {
    const pattern = priorityPatterns[i];
    const patternPriority = priorityPatterns.length - i; // 越靠前的模式优先级越高
    
    // 检查文件名是否匹配
    if (matchGlob(fileName, pattern)) {
      score += patternPriority * 100;
    }
    
    // 检查相对路径是否匹配
    if (matchGlob(normalizedPath, pattern)) {
      score += patternPriority * 100;
    }
    
    // 检查路径中是否包含该目录模式（如 "docs/" 匹配 "docs/guide.md"）
    if (pattern.endsWith('/')) {
      const dirPattern = pattern.slice(0, -1);
      if (normalizedPath.includes('/' + dirPattern + '/') || normalizedPath.startsWith(dirPattern + '/')) {
        score += patternPriority * 50;
      }
    }
  }
  
  return score;
}

/**
 * 根据优先级配置排序文件列表
 * @param {Array} files - 文件列表（对象数组，每个对象包含 path 属性）
 * @param {Array<string>} priorityPatterns - 优先级模式数组
 * @returns {Array} - 排序后的文件列表
 */
function sortByPriority(files, priorityPatterns = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return files;
  }
  
  // 如果没有优先级配置，按字母顺序排序
  if (!Array.isArray(priorityPatterns) || priorityPatterns.length === 0) {
    return [...files].sort((a, b) => {
      const pathA = a.path || a;
      const pathB = b.path || b;
      return pathA.localeCompare(pathB);
    });
  }
  
  return [...files].sort((a, b) => {
    const pathA = a.path || a;
    const pathB = b.path || b;
    
    const scoreA = calculatePriorityScore(pathA, priorityPatterns);
    const scoreB = calculatePriorityScore(pathB, priorityPatterns);
    
    // 分数高的排在前面
    if (scoreA !== scoreB) {
      return scoreB - scoreA;
    }
    
    // 分数相同则按字母顺序
    return pathA.localeCompare(pathB);
  });
}

module.exports = {
  matchGlob,
  calculatePriorityScore,
  sortByPriority
};
