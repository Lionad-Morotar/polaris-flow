const config = require('./config');
const gitignore = require('./gitignore');
const filter = require('./filter');
const todo = require('./todo');
const git = require('./git');
const valid = require('./valid');
const file = require('./file');
const parse = require('./parse');
const lang = require('./lang');
const scanner = require('./scanner');
const priority = require('./priority');

module.exports = {
  ...config,
  ...gitignore,
  ...filter,
  ...todo,
  ...git,
  ...valid,
  ...file,
  ...parse,
  ...lang,
  scanner,
  ...priority,
};
