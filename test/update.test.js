// Phase 3 — Update Plan: the pure tick, the markdown render against the
// Python it ports, the WIP protocol and the handler on a throwaway farm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { tickAnswered, planMarkdown, questionsOf } from '../src/client/core.js'

const PLAN_MD = path.join(os.homedir(), '.claude/skills/fedwiki-plan/scripts/plan-md.py')
const FARM = path.join(os.homedir(), 'Music/Guides/Private')
const PTP = path.join(FARM, 'plan.localhost/pages/plan-tool-plan')

// Each test that touches the WIP marker gets its own state directory; the
// real ~/.wiki-hosting is never written by the tests.
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-test-'))
process.env.WIKI_WIP_DIR = scratch()
const { claim, release, holderLine } = await import('../api/wip.js')
const { update } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const toy = () => ({
  title: 'Toy Plan',
  story: [
    md('a', 'Opening.'),
    { type: 'plan', id: 'p', text: '' },
    md('h1', '# Phase 1\n> x.'),
    md('c1', '- [ ] [[Is it a phase question?]] not in Open Questions, never ticked'),
    md('h2', '# Open Questions\n> Each a red link.'),
    md('q1', '- [ ] [[Is it answered?]] has a page'),
    md('q2', '- [ ] [[Is it open?]] has none'),
    md('q3', '- [x] [[Was it ticked?]] already ticked'),
    md('q4', '- [ ] [[Is one here?]] two in one item\n- [ ] [[Is two here?]] both answered'),
    md('h3', '# See\n\n- [[Toy Tool]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: [] } }],
})

test('tickAnswered: ticks answered question lines, one journal edit per item', () => {
  const page = toy()
  const known = new Set(['is-it-answered', 'was-it-ticked', 'is-one-here', 'is-two-here', 'is-it-a-phase-question'])
  const { page: out, ticked, unanswered } = tickAnswered(page, known, undefined, () => 42)
  assert.deepEqual(ticked.map(t => [t.id, t.title]), [
    ['q1', 'Is it answered?'],
    ['q4', 'Is one here?'],
    ['q4', 'Is two here?'],
  ])
  assert.equal(out.story.find(i => i.id === 'q1').text, '- [x] [[Is it answered?]] has a page')
  assert.equal(out.story.find(i => i.id === 'q4').text, '- [x] [[Is one here?]] two in one item\n- [x] [[Is two here?]] both answered')
  assert.equal(out.story.find(i => i.id === 'c1').text, page.story[3].text) // a phase checkpoint is not a question
  assert.deepEqual(out.journal.slice(1), [
    { type: 'edit', id: 'q1', item: { type: 'markdown', id: 'q1', text: '- [x] [[Is it answered?]] has a page' }, date: 42 },
    { type: 'edit', id: 'q4', item: { type: 'markdown', id: 'q4', text: '- [x] [[Is one here?]] two in one item\n- [x] [[Is two here?]] both answered' }, date: 42 },
  ])
  assert.ok(out.journal.slice(1).every(e => !('site' in e)))
  assert.deepEqual(unanswered, [{ title: 'Is it open?', slug: 'is-it-open' }])
  assert.equal(page.story[5].text, '- [ ] [[Is it answered?]] has a page') // the input is untouched
  assert.equal(page.journal.length, 1)
  // Nothing answered: nothing changes.
  const none = tickAnswered(page, new Set())
  assert.equal(none.ticked.length, 0)
  assert.equal(none.page.journal.length, 1)
})

// ---------- the render, against the Python ----------

const python = file => execFileSync('python3', [PLAN_MD, file, '--stdout'], { encoding: 'utf8' })

test('planMarkdown equals plan-md.py byte for byte on the Plan Tool Plan', { skip: !fs.existsSync(PLAN_MD) || !fs.existsSync(PTP) }, () => {
  const js = planMarkdown(JSON.parse(fs.readFileSync(PTP, 'utf8')))
  assert.equal(js, python(PTP))
})

test('planMarkdown equals plan-md.py on every plan page of plan.localhost', { skip: !fs.existsSync(PLAN_MD) || !fs.existsSync(PTP) }, () => {
  const dir = path.dirname(PTP)
  const slugs = fs.readdirSync(dir).filter(s => /-(plan|roadmap)$/.test(s))
  // One Python for all of them: plan-md.py's own render(), loaded as a module.
  const py = `import importlib.util,json,sys,os
spec=importlib.util.spec_from_file_location('planmd',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
print(json.dumps({s:m.render(json.load(open(os.path.join(sys.argv[2],s),encoding='utf-8'))) for s in sys.argv[3:]}))`
  const want = JSON.parse(execFileSync('python3', ['-I', '-c', py, PLAN_MD, dir, ...slugs], { encoding: 'utf8', maxBuffer: 64 << 20 }))
  for (const slug of slugs) assert.equal(planMarkdown(JSON.parse(fs.readFileSync(path.join(dir, slug), 'utf8'))), want[slug], slug)
  assert.ok(slugs.length > 10, `only ${slugs.length} plans compared`)
  console.log(`# rendered ${slugs.length} plan pages identically`)
})

test('planMarkdown: every item kind, the checkpoint run, provenance, blank runs', () => {
  const page = {
    title: 'Kinds Plan',
    story: [
      md('1', 'Intro.  \n\n\n'),
      md('2', '- [ ] one'),
      md('3', '- [x] two'),
      { type: 'paragraph', id: '4', text: '* [X] three' },
      md('5', ''),
      { type: 'code', id: '6', text: 'x = 1\n' },
      { type: 'terminal', id: '7', text: 'ls' },
      { type: 'timeline', id: '8', text: 'section A' },
      { type: 'mermaid', id: '9', text: '' },
      { type: 'assets', id: '10', text: 'kinds-plan' },
      { type: 'image', id: '11', url: '/assets/x/a.png', caption: 'cap' },
      { type: 'image', id: '12', text: 'alt', url: '/b.png' },
      { type: 'html', id: '13', text: '<b>x</b>' },
    ],
    journal: [{ type: 'create', provenance: 'from x.md', date: 1 }],
  }
  const tmp = path.join(scratch(), 'kinds-plan')
  fs.writeFileSync(tmp, JSON.stringify(page))
  const js = planMarkdown(page)
  if (fs.existsSync(PLAN_MD)) assert.equal(js, python(tmp))
  assert.match(js, /- \[ \] one\n- \[x\] two\n\* \[X\] three\n/)
  assert.match(js, /```\nx = 1\n```/)
  assert.match(js, /```bash\nls\n```/)
  assert.ok(!js.includes('kinds-plan\n'))
  assert.match(js, /\*\[html item\]\*/)
  assert.match(js, /---\n\n\*from x\.md\*\n$/)
})

// ---------- the WIP protocol ----------

test('wip: claim, a second claim refused with the holder named, release by token', () => {
  process.env.WIKI_WIP_DIR = scratch()
  const dir = process.env.WIKI_WIP_DIR
  const c = claim({ session: 'test one', scope: 's' })
  assert.match(c.token, /^[0-9a-f]{32}$/)
  const marker = JSON.parse(fs.readFileSync(path.join(dir, 'AGENT-WIP.json'), 'utf8'))
  assert.deepEqual(Object.keys(marker), ['status', 'since', 'heartbeat', 'session', 'token', 'scope', 'hold_off', 'contact'])
  assert.equal(marker.status, 'IN_PROGRESS')
  assert.match(marker.since, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  assert.ok(fs.existsSync(path.join(dir, 'AGENT-WIP.lock', 'owner.json')))
  assert.throws(() => claim({ session: 'test two' }), e => e.status === 409 && /held by test one/.test(e.message) && /fresh/.test(e.message))
  assert.throws(() => release('0'.repeat(32)), /wrong WIP token/)
  release(c.token)
  assert.ok(!fs.existsSync(path.join(dir, 'AGENT-WIP.lock')))
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'AGENT-WIP.json'), 'utf8')).status, 'DONE')
})

test('wip: a stale claim is taken over; a legacy claim is honoured', () => {
  process.env.WIKI_WIP_DIR = scratch()
  const dir = process.env.WIKI_WIP_DIR
  fs.mkdirSync(path.join(dir, 'AGENT-WIP.lock'))
  fs.writeFileSync(path.join(dir, 'AGENT-WIP.lock', 'owner.json'), JSON.stringify({ token: 'old', session: 'gone', since: '2026-01-01T00:00:00Z', heartbeat: '2026-01-01T00:00:00Z' }))
  assert.match(holderLine(), /STALE/)
  const c = claim({ session: 'new' })
  assert.match(c.took, /held by gone/)
  release(c.token)

  fs.writeFileSync(path.join(dir, 'AGENT-WIP.json'), JSON.stringify({ status: 'IN_PROGRESS', session: 'legacy', since: '2026-10-10T00:00:00Z' }))
  assert.throws(() => claim({ session: 'x' }), e => e.status === 409 && /legacy/.test(e.message))
  assert.ok(!fs.existsSync(path.join(dir, 'AGENT-WIP.lock')))
})

// ---------- the handler, on a throwaway farm ----------

const farm = () => {
  const root = scratch()
  for (const s of ['plan.test.localhost', 'other.localhost']) {
    fs.mkdirSync(path.join(root, s, 'pages'), { recursive: true })
    fs.mkdirSync(path.join(root, s, 'status'), { recursive: true })
  }
  const site = path.join(root, 'plan.test.localhost')
  fs.writeFileSync(path.join(site, 'pages', 'toy-plan'), JSON.stringify(toy(), null, 2))
  fs.writeFileSync(path.join(site, 'pages', 'is-it-answered'), '{}')
  fs.writeFileSync(path.join(root, 'other.localhost', 'pages', 'is-one-here'), '{}')
  fs.writeFileSync(path.join(site, 'pages', 'not-a-plan'), JSON.stringify({ title: 'Plan Index', story: [] }))
  fs.writeFileSync(path.join(site, 'status', 'sitemap.json'), '[]')
  fs.writeFileSync(path.join(site, 'status', 'site-index.json'), '{}')
  return { root, site, args: { origin: 'plan.test.localhost', status: path.join(site, 'status'), farmRoot: root } }
}

test('update: ticks across the farm, writes the page, resets the index, renders the asset, releases', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const { site, args } = farm()
  const r = await update({ slug: 'toy-plan', ...args })
  assert.deepEqual(r.ticked.map(t => [t.title, t.foundOn]), [
    ['Is it answered?', 'plan.test.localhost'],
    ['Is one here?', 'other.localhost'],
  ])
  assert.deepEqual(r.unanswered.map(q => q.title), ['Is it open?', 'Was it ticked?', 'Is two here?']) // a tick is not an answer
  assert.deepEqual(r.page, { written: true, journalEdits: 2 })
  assert.equal(r.index.reset, true)
  assert.ok(!fs.existsSync(path.join(site, 'status', 'sitemap.json')))
  assert.ok(!fs.existsSync(path.join(site, 'status', 'site-index.json')))
  const page = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'toy-plan'), 'utf8'))
  assert.equal(page.journal.length, 3)
  assert.deepEqual(page.journal.slice(1).map(e => [e.type, e.id]), [['edit', 'q1'], ['edit', 'q4']])
  assert.equal(page.story.find(i => i.id === 'q4').text, '- [x] [[Is one here?]] two in one item\n- [ ] [[Is two here?]] both answered')
  const asset = fs.readFileSync(path.join(site, 'assets', 'toy-plan', 'toy-plan.md'), 'utf8')
  assert.equal(asset, planMarkdown(page))
  assert.equal(r.asset.path, '/assets/toy-plan/toy-plan.md')
  assert.ok(r.wip.claimed && r.wip.released)
  assert.ok(!fs.existsSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.lock')))
  assert.deepEqual(fs.readdirSync(path.join(site, 'status', 'farm-tmp')), []) // no temp file left

  // Again: nothing more to tick, the page is not written, the asset is unchanged.
  fs.writeFileSync(path.join(site, 'status', 'sitemap.json'), '[]')
  const again = await update({ slug: 'toy-plan', ...args })
  assert.equal(again.ticked.length, 0)
  assert.equal(again.page.written, false)
  assert.equal(again.index.reset, false)
  assert.ok(fs.existsSync(path.join(site, 'status', 'sitemap.json')))
  assert.equal(again.asset.changed, false)
})

test('update: 409 while the marker is held live, nothing written; 400 and 404', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const { site, args } = farm()
  const before = fs.readFileSync(path.join(site, 'pages', 'toy-plan'), 'utf8')
  const held = claim({ session: 'phase 3 test' })
  await assert.rejects(update({ slug: 'toy-plan', ...args }), e => e.status === 409 && /held by phase 3 test/.test(e.message))
  assert.equal(fs.readFileSync(path.join(site, 'pages', 'toy-plan'), 'utf8'), before)
  assert.ok(!fs.existsSync(path.join(site, 'assets')))
  release(held.token)
  await assert.rejects(update({ slug: 'not-a-plan', ...args }), e => e.status === 400)
  await assert.rejects(update({ slug: 'no-such-plan', ...args }), e => e.status === 404)
  await assert.rejects(update({ slug: '../x', ...args }), e => e.status === 400)
  assert.equal(questionsOf(JSON.parse(before)).length, 5) // only the Open Questions section
})
