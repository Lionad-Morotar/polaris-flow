const fs = require('fs');
const path = require('path');

/**
 * 创建符号链接
 * @param {string} sourcePath - 源路径
 * @param {string} targetPath - 目标路径
 */
function createSymlink(sourcePath, targetPath) {
  try {
    try {
      const stats = fs.lstatSync(targetPath);
      if (stats.isSymbolicLink() || stats.isFile()) {
        fs.unlinkSync(targetPath);
      }
    } catch (e) {
    }

    fs.symlinkSync(sourcePath, targetPath);
    console.log(`已创建符号链接: ${targetPath} -> ${sourcePath}`);
  } catch (error) {
    throw new Error(`创建符号链接失败: ${error.message}`);
  }
}

module.exports = {
  createSymlink
};
