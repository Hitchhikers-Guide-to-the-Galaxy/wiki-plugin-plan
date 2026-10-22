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

test('the farm gate: a public site lets its signed-in owner write; 403 without the rights; through for the owner of a private site', { skip: !has }, () => {
  delete process.env.FARM_API_PUBLIC_WRITES
  delete process.env.FARM_API_PUBLIC_REFUSE
  const { refuseWrite, isPrivateSite } = createRequire(import.meta.url)(gatePath)
  const app = owner => ({ securityhandler: { isAuthorized: () => owner } })
  const req = { get: () => undefined, headers: {} }
  const scope = 'plan.update'
  const status = path.join(here, 'no-such-status')

  assert.ok(isPrivateSite('demo.localhost'))
  assert.ok(!isPrivateSite('plan.fedwiki.club'))
  assert.equal(refuseWrite({ app: app(true), req, origin: 'plan.fedwiki.club', status, scope }), null)
  assert.match(refuseWrite({ app: app(false), req, origin: 'plan.fedwiki.club', status, scope }).error, /needs the rights to edit it/)
  const anon = refuseWrite({ app: app(false), req, origin: 'demo.localhost', status, scope })
  assert.equal(anon.status, 403)
  assert.match(anon.error, /needs the rights to edit it/)
  assert.equal(refuseWrite({ app: app(true), req, origin: 'demo.localhost', status, scope }), null)
})

test('every writing Plan API operation is open to the owner of a public site unless the farm marks it refused', { skip: !has }, () => {
  const { refuseWrite } = createRequire(import.meta.url)(gatePath)
  const app = owner => ({ securityhandler: { isAuthorized: () => owner } })
  const req = { get: () => undefined, headers: {} }
  const status = path.join(here, 'no-such-status')
  const spec = JSON.parse(fs.readFileSync(path.join(here, '..', 'api', 'openapi.json'), 'utf8'))
  const writes = Object.values(spec.paths).flatMap(p => Object.values(p)).filter(o => o['x-fedwiki-writes'] === true)
  assert.ok(writes.some(o => o.operationId === 'saveRevision'), 'Revise Plan\'s save is a declared write')
  try {
    for (const { operationId } of writes) {
      const scope = `plan.${operationId}`
      delete process.env.FARM_API_PUBLIC_REFUSE
      // The Pi5 public farm's old allow-list, which left saveRevision out: it no longer restricts.
      process.env.FARM_API_PUBLIC_WRITES = 'audionote.summarise,plan.update,plan.reviseSite,plan.applyRevision'
      assert.equal(refuseWrite({ app: app(true), req, origin: 'arena.solidarity.quest', status, scope }), null, scope)
      assert.equal(refuseWrite({ app: app(false), req, origin: 'arena.solidarity.quest', status, scope }).status, 403)
      delete process.env.FARM_API_PUBLIC_WRITES
      process.env.FARM_API_PUBLIC_REFUSE = scope
      assert.match(refuseWrite({ app: app(true), req, origin: 'arena.solidarity.quest', status, scope }).error, /marked to refuse/)
      assert.equal(refuseWrite({ app: app(true), req, origin: 'revise.localhost', status, scope }), null)
    }
  } finally {
    delete process.env.FARM_API_PUBLIC_WRITES
    delete process.env.FARM_API_PUBLIC_REFUSE
  }
})

test('the operations that spend the farm\'s keys follow the farm-wide FARM_API_SPEND policy; the plain writes do not', { skip: !has }, () => {
  const { refuseWrite } = createRequire(import.meta.url)(gatePath)
  const app = { securityhandler: { isAuthorized: () => true } }
  const req = { get: () => undefined, headers: {} }
  const status = path.join(here, 'no-such-status')
  const spec = JSON.parse(fs.readFileSync(path.join(here, '..', 'api', 'openapi.json'), 'utf8'))
  const ops = Object.values(spec.paths).flatMap(p => Object.values(p)).filter(o => o['x-fedwiki-writes'] === true)
  const spending = ops.filter(o => o['x-fedwiki-spends'] === true).map(o => o.operationId).sort()
  assert.deepEqual(spending, ['applyRevision', 'chat', 'draftLinks', 'next', 'redlink', 'revise', 'reviseSite'])
  const call = (o, origin) => refuseWrite({ app, req, origin, status, scope: `plan.${o.operationId}`, spends: o['x-fedwiki-spends'] === true })
  try {
    delete process.env.FARM_API_SPEND
    for (const o of ops) {
      if (spending.includes(o.operationId)) assert.match(call(o, 'arena.solidarity.quest').error, /FARM_API_SPEND=authors/)
      else assert.equal(call(o, 'arena.solidarity.quest'), null, o.operationId)
      assert.equal(call(o, 'demo.localhost'), null)
    }
    process.env.FARM_API_SPEND = 'authors'
    for (const o of ops) assert.equal(call(o, 'arena.solidarity.quest'), null, o.operationId)
  } finally {
    delete process.env.FARM_API_SPEND
  }
})
