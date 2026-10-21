// lineupSync / journalMoved (0.15.3): a plan open in a tab follows the file
// when a Do Phase run, Update Plan or another tab writes it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineupSync, journalMoved } from '../src/client/core.js'

const box = (id, done) => ({ type: 'markdown', id, text: `- [${done ? 'x' : ' '}] step ${id}` })
const head = { type: 'markdown', id: 'h', text: '# Phase 1' }

test('the same story needs no redraw', () => {
  const s = [head, box('a'), box('b')]
  assert.deepEqual(lineupSync(s, JSON.parse(JSON.stringify(s))), { changed: false, first: -1, removed: [], added: [] })
})

test('ticks written elsewhere are found from the first ticked box', () => {
  const shown = [head, box('a'), box('b'), box('c')]
  const fresh = [head, box('a'), box('b', true), box('c', true)]
  const r = lineupSync(shown, fresh)
  assert.equal(r.changed, true)
  assert.equal(r.first, 2)
})

test('an added item, a removed item and a moved button all count', () => {
  const btn = { type: 'terminal', id: 't', text: 'BUTTON: show\nLABEL: Do Phase 1' }
  const shown = [head, box('a'), btn, box('b')]
  // the run ticks a, adds a table, moves the button after b
  const fresh = [head, box('a', true), { type: 'table', id: 'n', text: '| x |' }, box('b'), btn]
  const r = lineupSync(shown, fresh)
  assert.equal(r.first, 1)
  assert.deepEqual(r.added, ['n'])
  const gone = lineupSync([head, box('a'), box('b')], [head, box('b')])
  assert.deepEqual(gone.removed, ['a'])
  assert.equal(gone.first, 1)
})

test('a journal that grew, or whose last action changed, has moved', () => {
  const j = [{ type: 'create', date: 1 }]
  assert.equal(journalMoved({ journal: j }, { journal: j }), false)
  assert.equal(journalMoved({ journal: j }, { journal: [...j, { type: 'edit', id: 'a', date: 2 }] }), true)
  assert.equal(journalMoved({ journal: [...j, { type: 'edit', id: 'a', date: 2 }] }, { journal: [...j, { type: 'edit', id: 'a', date: 3 }] }), true)
  assert.equal(journalMoved(null, { journal: j }), true)
})
