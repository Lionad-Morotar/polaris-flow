/**
 * 解析命令行参数
 * @param {Array} args - 参数数组
 * @returns {Object} 参数对象
 */
function parseArgs(args) {
  const params = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];
    params[key] = value;
  }

  return params;
}

module.exports = {
  parseArgs
};
