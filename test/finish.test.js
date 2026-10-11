// Phase 5 — Finish Plan's rules and handler, and Check Plan Index's
// comparison of the board with the live plans.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { finishRefusal, writeConclusion, demoCandidate, boardEntries, compareIndex, summarise, planMarkdown, planState } from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-finish-'))
process.env.WIKI_WIP_DIR = scratch()
const { claim, release } = await import('../api/wip.js')
const { finish } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const done = () => ({
  title: 'Done Plan',
  story: [
    md('a', 'Opening, with a link to [[Done Demo]] in passing.'),
    { type: 'plan', id: 'p', text: '' },
    md('h1', '# Phase 1\n> First.'),
    md('c1', '- [x] one'),
    md('h2', '# Phase 2\n> Second.'),
    md('c2', '- [x] two'),
    md('oq', '# Open Questions\n> Red links.'),
    md('q1', '- [ ] [[Is it still open?]] an open question does not block finishing'),
    md('ah', '# Assets'),
    { type: 'assets', id: 'as', text: 'done-plan' },
    md('see', '# See\n\n- [[Plan Index]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Done Plan', story: [] } }],
})
let n = 0
const ids = () => `n${++n}`

test('finishRefusal: every phase checkpoint ticked, a conclusion and a demo title', () => {
  const page = done()
  assert.equal(finishRefusal(page, { conclusion: 'It worked.', demo: 'Done Demo' }), null)
  assert.match(finishRefusal(page, { conclusion: ' ', demo: 'Done Demo' }), /conclusion is required/)
  assert.match(finishRefusal(page, { conclusion: 'x', demo: '' }), /demo page title is required/)
  assert.match(finishRefusal(page, { conclusion: 'x', demo: '[[Done Demo]]' }), /not a link/)
  const open = done()
  open.story[5].text = '- [ ] two'
  assert.match(finishRefusal(open, { conclusion: 'x', demo: 'Done Demo' }), /1 of 2 checkpoints of Done Plan are still unticked \(Phase 2: two\)/)
  assert.match(finishRefusal({ title: 'Empty Plan', story: [md('x', 'prose')] }, { conclusion: 'x', demo: 'D' }), /no checkpoints/)
  assert.equal(demoCandidate(page), 'Done Demo')
})

test('writeConclusion: above See, below Assets, one item per paragraph, the demo line, See link, journaled', () => {
  n = 0
  const page = done()
  const r = writeConclusion(page, { conclusion: 'First paragraph.\n\nSecond paragraph.\n', demo: 'Done Demo', id: ids, now: () => 7 })
  const story = r.page.story
  const at = story.findIndex(i => i.text === '# Conclusion')
  assert.equal(story[at - 1].id, 'as') // below the Assets
  assert.deepEqual(story.slice(at, at + 4).map(i => i.text), ['# Conclusion', 'First paragraph.', 'Second paragraph.', 'The demo is [[Done Demo]].'])
  assert.equal(story[at + 4].id, 'see') // immediately above See
  assert.equal(story[at + 4].text, '# See\n\n- [[Plan Index]]\n- [[Done Demo]]')
  assert.deepEqual(r.actions.map(a => [a.type, a.id, a.after]), [
    ['add', 'n1', 'as'],
    ['add', 'n2', 'n1'],
    ['add', 'n3', 'n2'],
    ['add', 'n4', 'n3'],
    ['edit', 'see', undefined],
  ])
  assert.ok(r.actions.every(a => a.date === 7 && !('site' in a)))
  assert.deepEqual(r.page.journal.slice(1), r.actions)
  assert.deepEqual(r.conclusion, { replaced: false, ids: ['n1', 'n2', 'n3', 'n4'], items: 4 })
  assert.equal(r.see.added, true)
  assert.equal(page.story.length, 11) // the input is untouched
  assert.equal(page.journal.length, 1)

  // Again, shorter: the body is replaced item by item, the surplus removed, See not doubled.
  const again = writeConclusion(r.page, { conclusion: 'Only one now.', demo: 'Done Demo', id: ids, now: () => 8 })
  const s2 = again.page.story
  const c2 = s2.findIndex(i => i.text === '# Conclusion')
  assert.deepEqual(s2.slice(c2, c2 + 3).map(i => i.text), ['# Conclusion', 'Only one now.', 'The demo is [[Done Demo]].'])
  assert.equal(s2[c2 + 3].id, 'see')
  assert.deepEqual(again.actions.map(a => [a.type, a.id]), [['edit', 'n2'], ['edit', 'n3'], ['remove', 'n4']])
  assert.equal(again.conclusion.replaced, true)
  assert.equal(again.see.added, false)
  assert.equal(s2.filter(i => i.text === '# Conclusion').length, 1)
})

test('writeConclusion: no See section makes one; a See heading with no list gets a link item', () => {
  n = 0
  const bare = done()
  bare.story = bare.story.filter(i => i.id !== 'see')
  const r = writeConclusion(bare, { conclusion: 'Done.', demo: 'Done Demo', id: ids, now: () => 1 })
  assert.deepEqual(r.page.story.slice(-4).map(i => i.text), ['# Conclusion', 'Done.', 'The demo is [[Done Demo]].', '# See\n\n- [[Done Demo]]'])
  const head = done()
  head.story[10] = md('see', '# See')
  const r2 = writeConclusion(head, { conclusion: 'Done.', demo: 'Done Demo', id: ids, now: () => 1 })
  assert.deepEqual(r2.page.story.slice(-2).map(i => [i.id, i.text]), [['see', '# See'], ['n8', '- [[Done Demo]]']])
  assert.deepEqual(r2.actions.at(-1), { type: 'add', id: 'n8', item: { type: 'markdown', id: 'n8', text: '- [[Done Demo]]' }, after: 'see', date: 1 })
})

// ---------- Check Plan Index ----------

const board = {
  title: 'Plan Index',
  story: [
    md('i', 'Every plan on this site as its own item.'),
    { type: 'code', id: 'k', text: '3 plans' },
    md('h', '# In flight'),
    md('1', '- [ ] [[Moving Plan]] · 2/5 · 4 Sep'),
    md('2', '- [ ] [[Still Plan]] · 3/4 · 4 Sep'),
    md('3', '- [ ] [[Gone Plan]] · no checkpoints · 1 Aug'),
    md('4', '- [ ] [[Finishing Plan]] · 4/5 · 4 Sep'),
    md('5', '- [x] [[Was Done Plan]] · 2/2 · 4 Sep'),
    { type: 'reference', id: 'r', site: 'dns.example.localhost', slug: 'dns-plan', title: 'DNS Plan', text: 'dns.example.localhost · 7/39 · 21 Aug' },
  ],
}
const backlog = { title: 'Backlog Plans', story: [md('b', '## Parked'), md('b1', '- [ ] [[Parked Plan]] · 0/9 · 30 Jul')] }

test('boardEntries reads plan-index.py lines and reference items', () => {
  const b = boardEntries(board, backlog)
  assert.deepEqual(b.plans.map(p => [p.title, p.done, p.total, p.box, p.board]), [
    ['Moving Plan', 2, 5, false, 'Plan Index'],
    ['Still Plan', 3, 4, false, 'Plan Index'],
    ['Gone Plan', 0, 0, false, 'Plan Index'],
    ['Finishing Plan', 4, 5, false, 'Plan Index'],
    ['Was Done Plan', 2, 2, true, 'Plan Index'],
    ['Parked Plan', 0, 9, false, 'Backlog Plans'],
  ])
  assert.deepEqual(b.refs, [{ site: 'dns.example.localhost', slug: 'dns-plan', title: 'DNS Plan', done: 7, total: 39 }])
})

test('compareIndex: missing, gone, moved from and to, newly complete, by the board rule', () => {
  const row = (title, all, extra = {}) => ({ title, slug: title.toLowerCase().replace(/ /g, '-'), read: true, done: 0, total: 0, all, ...extra })
  const live = [
    row('Moving Plan', { done: 4, total: 6 }),
    row('Still Plan', { done: 3, total: 4 }),
    row('Finishing Plan', { done: 5, total: 5 }),
    row('Was Done Plan', { done: 2, total: 2 }),
    row('Parked Plan', { done: 0, total: 9 }),
    row('New Plan', { done: 0, total: 3 }),
    row('Broken Plan', null, { read: false }),
  ]
  const r = compareIndex(boardEntries(board, backlog), live)
  assert.deepEqual(r.missing.map(m => [m.title, m.to]), [['New Plan', '0/3'], ['Broken Plan', null]])
  assert.deepEqual(r.gone.map(g => [g.title, g.from]), [['Gone Plan', 'no checkpoints']])
  assert.deepEqual(r.moved.map(m => [m.title, m.from, m.to]), [['Moving Plan', '2/5', '4/6'], ['Finishing Plan', '4/5', '5/5']])
  assert.deepEqual(r.complete.map(c => c.title), ['Finishing Plan'])
  assert.equal(r.unchanged, 3)
  assert.equal(r.listed, 6)
  assert.equal(r.elsewhere, 1)

  // The rows come from summarise, whose `all` is the board's count: Open
  // Questions lines included, which the list's own done/total leaves out.
  const page = { title: 'Q Plan', story: [md('h', '# Phase 1'), md('c', '- [x] a'), md('o', '# Open Questions'), md('q', '- [ ] [[Why?]]')], journal: [] }
  const s = summarise({ title: 'Q Plan', slug: 'q-plan', date: 1 }, page)
  assert.deepEqual([s.done, s.total, s.all], [1, 1, { done: 1, total: 2 }])
})

// ---------- the handler, on a throwaway farm ----------

const farm = () => {
  const root = scratch()
  for (const s of ['plan.test.localhost', 'other.localhost']) {
    fs.mkdirSync(path.join(root, s, 'pages'), { recursive: true })
    fs.mkdirSync(path.join(root, s, 'status'), { recursive: true })
  }
  const site = path.join(root, 'plan.test.localhost')
  fs.writeFileSync(path.join(site, 'pages', 'done-plan'), JSON.stringify(done(), null, 2))
  const open = done()
  open.title = 'Open Plan'
  open.story[3].text = '- [ ] one'
  fs.writeFileSync(path.join(site, 'pages', 'open-plan'), JSON.stringify(open, null, 2))
  fs.writeFileSync(path.join(root, 'other.localhost', 'pages', 'done-demo'), '{}')
  fs.writeFileSync(path.join(site, 'status', 'sitemap.json'), '[]')
  fs.writeFileSync(path.join(site, 'status', 'site-index.json'), '{}')
  return { site, args: { origin: 'plan.test.localhost', status: path.join(site, 'status'), farmRoot: root } }
}

test('finish: 400 on an unticked checkpoint, a missing demo, no conclusion; nothing written', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const { site, args } = farm()
  const before = fs.readFileSync(path.join(site, 'pages', 'open-plan'), 'utf8')
  await assert.rejects(finish({ slug: 'open-plan', conclusion: 'x', demo: 'Done Demo', ...args }), e => e.status === 400 && /1 of 2 checkpoints of Open Plan are still unticked \(Phase 1: one\)/.test(e.message))
  assert.equal(fs.readFileSync(path.join(site, 'pages', 'open-plan'), 'utf8'), before)
  await assert.rejects(finish({ slug: 'done-plan', conclusion: 'x', demo: 'No Such Demo', ...args }), e => e.status === 400 && /no page "No Such Demo" on plan\.test\.localhost or a sibling site/.test(e.message))
  await assert.rejects(finish({ slug: 'done-plan', conclusion: '', demo: 'Done Demo', ...args }), e => e.status === 400)
  await assert.rejects(finish({ slug: 'no-plan', conclusion: 'x', demo: 'Done Demo', ...args }), e => e.status === 404)
  assert.ok(!fs.existsSync(path.join(site, 'assets')))
  assert.ok(fs.existsSync(path.join(site, 'status', 'sitemap.json')))
  assert.ok(!fs.existsSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json'))) // refused before any claim
})

test('finish: writes the Conclusion and the See link, journals, renders the asset, resets the index, releases', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const { site, args } = farm()
  const r = await finish({ slug: 'done-plan', conclusion: 'It shipped.\n\nIt was shown.', demo: 'Done Demo', ...args })
  assert.deepEqual(r.demo, { title: 'Done Demo', slug: 'done-demo', foundOn: 'other.localhost' })
  assert.deepEqual(r.page, { written: true, journalEntries: 5 })
  assert.equal(r.index.reset, true)
  assert.ok(!fs.existsSync(path.join(site, 'status', 'sitemap.json')))
  const page = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'done-plan'), 'utf8'))
  const texts = page.story.map(i => i.text)
  const at = texts.indexOf('# Conclusion')
  assert.deepEqual(texts.slice(at, at + 5), ['# Conclusion', 'It shipped.', 'It was shown.', 'The demo is [[Done Demo]].', '# See\n\n- [[Plan Index]]\n- [[Done Demo]]'])
  assert.deepEqual(page.journal.slice(1).map(e => e.type), ['add', 'add', 'add', 'add', 'edit'])
  assert.equal(fs.readFileSync(path.join(site, 'assets', 'done-plan', 'done-plan.md'), 'utf8'), planMarkdown(page))
  assert.ok(r.wip.claimed && r.wip.released)
  // The Conclusion's demo line satisfies the no-Demo lint, and is the form's next guess.
  const named = { ...page, story: page.story.map(i => ({ ...i, text: String(i.text || '').replace('[[Done Demo]] in passing', 'nothing') })) }
  named.story = named.story.map(i => (i.id === 'see' ? { ...i, text: '# See\n\n- [[Plan Index]]' } : i))
  const renamed = JSON.parse(JSON.stringify(named).replaceAll('Done Demo', 'Done Result'))
  assert.equal(planState(renamed).lints.length, 0)
  assert.equal(demoCandidate(renamed), 'Done Result')
  const marker = JSON.parse(fs.readFileSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json'), 'utf8'))
  assert.equal(marker.status, 'DONE')
  assert.ok(!fs.existsSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.lock')))

  // A live claim by someone else: 409, nothing written.
  const held = claim({ session: 'phase 5 test' })
  const now = fs.readFileSync(path.join(site, 'pages', 'done-plan'), 'utf8')
  await assert.rejects(finish({ slug: 'done-plan', conclusion: 'Again.', demo: 'Done Demo', ...args }), e => e.status === 409 && /held by phase 5 test/.test(e.message))
  assert.equal(fs.readFileSync(path.join(site, 'pages', 'done-plan'), 'utf8'), now)
  release(held.token)
})
