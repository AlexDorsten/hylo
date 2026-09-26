const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const backendRequire = createRequire(path.resolve(__dirname, '../../../apps/backend/package.json'))
const babel = backendRequire('@babel/core')

module.exports = function loadBackend (relative, { mocks = {}, globals = {}, env = {} } = {}) {
  const filename = path.resolve(__dirname, '../../../apps/backend', relative)
  const localRequire = createRequire(filename)
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, presets: [[backendRequire.resolve('@babel/preset-env'), { targets: { node: '24' } }]]
  }).code
  const result = { exports: {} }
  vm.runInNewContext(code, {
    module: result,
    exports: result.exports,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
    process: { env },
    URLSearchParams,
    ...globals
  }, { filename })
  return result.exports
}
