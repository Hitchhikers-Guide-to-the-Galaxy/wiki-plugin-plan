// 0.5.0 — STATUS, the plan item's default text. wiki-client removes an item
// whose text is saved empty, so the empty status line was one unchanged save
// from deletion; STATUS reads as the bare item did, and old empty items still
// read as the status line.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parse, face, DEFAULT_TEXT, reportTitle } from '../src/client/core.js'

test('STATUS: a command, the default text; it reads as the bare status line', () => {
  assert.equal(DEFAULT_TEXT, 'STATUS')
  const o = parse('STATUS')
  assert.equal(o.status, true)
  assert.equal(o.caption, '')
  assert.equal(o.commands, 1)
  assert.equal(face(o, { ownTitle: 'Hook Plan' }), 'status')
  assert.equal(face(parse(''), { ownTitle: 'Hook Plan' }), 'status', 'an old empty item still reads as the status line')
  assert.equal(face(parse('STATUS:'), { ownTitle: 'Hook Plan' }), 'status')
  assert.equal(face(o, { ownTitle: 'Notes' }), 'list', 'off a plan, as a bare item')
  assert.equal(face(parse('STATUS\nSKILLS fedwiki-page'), { ownTitle: 'Hook Plan' }), 'status')
  assert.deepEqual(parse('STATUS\nSKILLS a').skills, ['a'])
  assert.equal(reportTitle({ kind: 'redlink', planTitle: 'Hook Plan' }), 'Hook Plan')
})
