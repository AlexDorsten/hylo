const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createRequire } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const web = path.resolve(__dirname, '../../apps/web')
const express = createRequire(path.join(web, 'package.json'))('express')

async function listen (app) {
  return await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server))
  })
}

test('marketing proxy preserves defaults and can yield root and blog routes to the application', async t => {
  const { handleStaticPages } = await import(pathToFileURL(path.join(web, 'src/server/proxy.js')))
  const original = { ...process.env }
  t.after(() => {
    for (const name of ['HYLO_MARKETING_PROXY', 'PROXY_HOST', 'DISABLE_PROXY']) {
      if (original[name] === undefined) delete process.env[name]
      else process.env[name] = original[name]
    }
  })
  const upstream = express()
  upstream.use((req, res) => res.type('html').send('<html>marketing</html>'))
  const upstreamServer = await listen(upstream)
  t.after(() => new Promise(resolve => upstreamServer.close(resolve)))
  process.env.PROXY_HOST = `http://127.0.0.1:${upstreamServer.address().port}`
  delete process.env.DISABLE_PROXY

  for (const setting of [undefined, 'true', 'false']) {
    if (setting === undefined) delete process.env.HYLO_MARKETING_PROXY
    else process.env.HYLO_MARKETING_PROXY = setting
    const app = express()
    handleStaticPages(app)
    app.use((req, res) => res.type('html').send('<html>local application</html>'))
    const server = await listen(app)
    try {
      for (const route of ['/', '/blog/example']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`)
        assert.equal(response.status, 200)
        assert.equal(await response.text(), setting === 'false' ? '<html>local application</html>' : '<html>marketing</html>')
      }
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  }
})
