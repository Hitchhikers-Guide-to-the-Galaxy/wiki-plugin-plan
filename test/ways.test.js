// 0.15.0 — the four ways to revise a plan: from the answers, from the owner's
// direction, to catch up with the work done, and to tidy its format. What the
// door is asked, what the farm refuses, what the ghost's first line says and
// what the journal keeps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { reviseItems, revisedStory, writeRevision, lastRevision, REVISE_WAYS, reviseHowText, face, parse, storyAt } from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ways-'))
process.env.WIKI_WIP_DIR = scratch()
const { buildContent, reviseAsk, REVISE_MODES } = await import('../api/prompt.js')
const { reviseHow } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const toy = () => ({
  title: 'Toy Plan',
  story: [
    md('a', 'Opening, linking [[Toy Tool]].'),
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [x] Write the page'),
    md('c2', '- [ ] Build the thing'),
    md('h3', '# Open Questions\n> Each a red link.'),
    md('q1', '- [x] [[Is it answered?]] has a page'),
    md('h4', '# See\n\n- [[Toy Tool]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: [] } }],
})

const farm = () => {
  const root = scratch()
  const site = path.join(root, 'toy.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  const put = (slug, page) => fs.writeFileSync(path.join(site, 'pages', slug), JSON.stringify(page))
  put('toy-plan', toy())
  put('is-it-answered', { title: 'Is it answered?', story: [md('x', 'Yes: build it in the farm.')], journal: [] })
  put('toy-tool', { title: 'Toy Tool', story: [md('y', 'The tool the plan builds.')], journal: [] })
  return { root, site, skills: path.join(root, 'no-skills') }
}

test('the ways: four, each named on the tool and in the journal', () => {
  assert.deepEqual(REVISE_MODES, ['answers', 'direction', 'correct', 'tidy'])
  assert.deepEqual(Object.keys(REVISE_WAYS), REVISE_MODES)
  assert.equal(reviseHowText('direction'), "from the owner's direction")
  assert.equal(reviseHowText('nonsense'), 'from the answers')
})

test('reviseAsk: each way asks for its own change, all keep the house format and What Changed', () => {
  for (const mode of REVISE_MODES) {
    const ask = reviseAsk('Toy Plan', { mode, direction: mode === 'direction' ? 'Drop Phase 1.' : '' })
    assert.match(ask, /# What Changed/, mode)
    assert.match(ask, /"# Phase N" headings/, mode)
    assert.match(ask, /ghost with the plan's own title/, mode)
  }
  assert.match(reviseAsk('Toy Plan', { mode: 'answers' }), /given the answers to its open questions/)
  assert.match(reviseAsk('Toy Plan', { mode: 'direction', direction: 'Drop Phase 1.' }), /The owner's direction:\n\n"""\nDrop Phase 1\.\n"""/)
  assert.match(reviseAsk('Toy Plan', { mode: 'direction', direction: 'x' }), /unless the direction says otherwise/)
  assert.match(reviseAsk('Toy Plan', { mode: 'correct' }), /record shows done becomes "- \[x\]"/)
  assert.match(reviseAsk('Toy Plan', { mode: 'correct' }), /Add no new work/)
  assert.match(reviseAsk('Toy Plan', { mode: 'tidy' }), /without changing what it says/)
  assert.match(reviseAsk('Toy Plan', { mode: 'tidy' }), /do not tick or untick anything/)
  // a direction with another way is an addition that takes precedence
  assert.match(reviseAsk('Toy Plan', { mode: 'tidy', direction: 'Keep Phase 1 short.' }), /The owner adds this, which takes precedence:\n\n"""\nKeep Phase 1 short\.\n"""/)
  assert.doesNotMatch(reviseAsk('Toy Plan', { mode: 'answers' }), /"""/)
})

test('buildContent: the direction comes after the material, outside its tags; tidy sends no linked pages or answers', () => {
  const f = farm()
  const page = toy()
  const dir = buildContent({ kind: 'revise', page, origin: 'toy.localhost', siteDir: f.site, skillsFrom: f.skills, mode: 'direction', direction: 'Split Phase 1 in two.' })
  assert.ok(dir.content.lastIndexOf('</page>') < dir.content.indexOf('Split Phase 1 in two.'))
  assert.deepEqual([dir.account.mode, dir.account.direction], ['direction', true])
  assert.equal(dir.account.pages.length, 2)
  const tidy = buildContent({ kind: 'revise', page, origin: 'toy.localhost', siteDir: f.site, skillsFrom: f.skills, mode: 'tidy' })
  assert.equal(tidy.account.pages.length, 0)
  assert.ok(!tidy.content.includes('<page '))
  assert.ok(tidy.content.length < dir.content.length)
  // the default is the answers, as before 0.15.0
  const plain = buildContent({ kind: 'revise', page, origin: 'toy.localhost', siteDir: f.site, skillsFrom: f.skills })
  assert.equal(plain.account.mode, 'answers')
  assert.match(plain.content, /given the answers to its open questions/)
})

test('reviseHow: answers by default; a bad way, a missing or overlong direction are 400s; Save is lenient', () => {
  assert.deepEqual(reviseHow({}), { mode: 'answers', direction: '' })
  assert.deepEqual(reviseHow({ mode: 'direction', direction: '  Do it.\r\n' }), { mode: 'direction', direction: 'Do it.' })
  assert.throws(() => reviseHow({ mode: 'rewrite' }), e => e.status === 400 && /not a way to revise/.test(e.message))
  assert.throws(() => reviseHow({ mode: 'direction', direction: '  ' }), e => e.status === 400 && /needs the direction/.test(e.message))
  assert.throws(() => reviseHow({ mode: 'tidy', direction: 'x'.repeat(8001) }), e => e.status === 400 && /keep it under 8,000/.test(e.message))
  assert.deepEqual(reviseHow({ mode: 'direction' }, { saving: true }), { mode: 'direction', direction: '' })
})

test('reviseItems: the first line names the way and quotes the direction; Save drops it whole', () => {
  let n = 0
  const items = reviseItems({ page: toy(), markdown: 'Opening.\n\n# Phase 1\n> Begin.\n\n- [x] Write the page', model: 'm', date: '2026-10-21', id: () => `g${n++}`, mode: 'direction', direction: 'Drop the demo.\nAdd a review.' })
  assert.match(items[0].text, /^Proposed revision of \[\[Toy Plan\]\] through the \[\[Plan Tool\]\]'s Revise Plan, from the owner's direction, by m, 2026-10-21\. Fork this ghost/)
  assert.match(items[0].text, /\n\n> Drop the demo\.\n> Add a review\.(\n|$)/)
  assert.ok(!revisedStory(items).some(it => /Drop the demo/.test(it.text || '')))
  const long = reviseItems({ page: toy(), markdown: 'x', id: () => `h${n++}`, mode: 'direction', direction: 'word '.repeat(300) })
  assert.match(long[0].text, /word …(\n|$)/)
  // no way named: the wording before 0.15.0
  assert.match(reviseItems({ page: toy(), markdown: 'x', model: 'm', date: 'd', id: () => `k${n++}` })[0].text, /Revise Plan by m, d\./)
})

test('writeRevision: the way on every entry and in the provenance, the direction once; lastRevision reads the way', () => {
  const page = toy()
  const story = page.story.map(it => (it.id === 'c2' ? { ...it, text: '- [ ] Build the thing, reviewed' } : it)).concat([md('new', '- [ ] Review it')])
  const out = writeRevision(page, story, { model: 'claude-cli:claude-fable-5-1', date: 9, mode: 'direction', direction: 'Add a review step.' })
  assert.ok(out.changed)
  const added = out.actions
  assert.ok(added.length >= 2)
  for (const a of added) {
    assert.equal(a.planTool.mode, 'direction')
    assert.match(a.provenance, /^Revised through the Plan Tool's Revise Plan, from the owner's direction, by claude-fable-5-1, saved over the plan/)
  }
  assert.equal(added[0].planTool.direction, 'Add a review step.')
  assert.ok(added.slice(1).every(a => !('direction' in a.planTool)))
  const last = lastRevision(out.page)
  assert.equal(last.mode, 'direction')
  assert.deepEqual(storyAt(out.page, last.previous), page.story)
  // tidy, no direction
  const t = writeRevision(page, story, { model: 'm', date: 9, mode: 'tidy' })
  assert.ok(t.actions.every(a => a.planTool.mode === 'tidy' && !a.planTool.direction))
  assert.match(t.actions[0].provenance, /Revise Plan, to tidy its format, by m/)
})

test('the Revise Plan tool page: REVISE is its own face', () => {
  assert.equal(parse('REVISE').revise, true)
  assert.equal(face(parse('REVISE'), { ownTitle: 'Revise Plan', leftTitle: 'Toy Plan' }), 'revise')
  assert.equal(face(parse('REVISE'), { ownTitle: 'Revise Plan', leftTitle: 'Welcome Visitors' }), 'revise')
})
