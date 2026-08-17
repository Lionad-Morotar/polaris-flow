const path = require('path');

/**
 * 判断文件是否应被排除
 * @param {string} filename - 文件名
 * @param {Object} config - 配置对象
 * @returns {boolean} 是否应排除
 */
function shouldExcludeFile(filename, config) {
  const excludeFiles = config?.fileFilters?.excludeFiles || [];
  return excludeFiles.includes(filename);
}

function shouldExcludeDir(dirname, config) {
  const excludeDirs = config?.fileFilters?.excludeDirs || [];
  return excludeDirs.includes(dirname);
}

/**
 * 判断文件类型是否支持
 * @param {string} filename - 文件名
 * @param {Object} config - 配置对象
 * @returns {boolean} 是否支持
 */
function isSupportedFile(filename, config) {
  const supportedExtensions = config?.fileFilters?.supportedExtensions || ['.md', '.js', '.py'];
  const ext = path.extname(filename).toLowerCase();
  return supportedExtensions.includes(ext);
}

module.exports = {
  shouldExcludeFile,
  shouldExcludeDir,
  isSupportedFile
};
