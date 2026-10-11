// The write gate is the farm's, not this plugin's: wiki-plugin-farm's
// refuseWrite runs before update is called. This checks that gate as the Plan
// API's scope meets it, so checkpoint 4 has a test as well as the catalogue.
// Skipped when wiki-plugin-farm is not checked out beside this plugin.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const gatePath = path.join(here, '..', '..', 'wiki-plugin-farm', 'server', 'gate.js')
const has = fs.existsSync(gatePath)

test('the farm gate: 403 on a public site, 403 without the rights, through for the owner of a private site', { skip: !has }, () => {
  delete process.env.FARM_API_PUBLIC_WRITES
  const { refuseWrite, isPrivateSite } = createRequire(import.meta.url)(gatePath)
  const app = owner => ({ securityhandler: { isAuthorized: () => owner } })
  const req = { get: () => undefined, headers: {} }
  const scope = 'plan.update'
  const status = path.join(here, 'no-such-status')

  assert.ok(isPrivateSite('demo.localhost'))
  assert.ok(!isPrivateSite('plan.fedwiki.club'))
  const pub = refuseWrite({ app: app(true), req, origin: 'plan.fedwiki.club', status, scope })
  assert.equal(pub.status, 403)
  assert.match(pub.error, /plan\.fedwiki\.club is not a private site/)
  const anon = refuseWrite({ app: app(false), req, origin: 'demo.localhost', status, scope })
  assert.equal(anon.status, 403)
  assert.match(anon.error, /needs the rights to edit it/)
  assert.equal(refuseWrite({ app: app(true), req, origin: 'demo.localhost', status, scope }), null)
})
