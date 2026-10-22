// 0.16.2 — the pages a redraft links are drafted with it: researched like
// Red-link, offered as ghosts, never written by the farm.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-drafts-'))
process.env.WIKI_WIP_DIR = scratch()
const { draftLinks, job } = await import('../api/handlers.js')
const { buildResearchContent } = await import('../api/prompt.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const plan = {
  title: 'Toy Plan',
  story: [
    md('a', 'Opening, linking [[Toy Tool]] and [[Old Red]].'),
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [ ] Build the thing'),
    md('h3', '# Open Questions\n> Each a red link.'),
    md('q1', '- [ ] [[Is it big?]] size'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: [] } }],
}
// The ghost: the proposal line, then the plan with one new link and one old red one kept.
const ghost = [
  md('g0', 'Proposed revision of [[Toy Plan]] through the [[Plan Tool]]\'s Revise Plan, from the owner\'s direction, by m, d. Fork this ghost to write it.'),
  md('a', 'Opening, linking [[Toy Tool]] and [[Old Red]].'),
  { type: 'plan', id: 'p', text: 'STATUS' },
  md('h1', '# Phase 1\n> Begin.'),
  md('c1', '- [ ] Build the thing, with [[Restart Button Feedback]]'),
  md('h3', '# Open Questions\n> Each a red link.'),
  md('q1', '- [ ] [[Is it big?]] size'),
  md('q2', '- [ ] [[Held Back]] in the questions section'),
]

const farm = () => {
  const root = scratch()
  const site = path.join(root, 'toy.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  fs.writeFileSync(path.join(site, 'pages', 'toy-plan'), JSON.stringify(plan))
  fs.writeFileSync(path.join(site, 'pages', 'toy-tool'), JSON.stringify({ title: 'Toy Tool', story: [], journal: [] }))
  const bin = path.join(root, 'claude')
  fs.writeFileSync(bin, `#!/bin/sh\ncat > "${root}/asked.txt"\necho "TITLE: Drafted"\necho\necho "A page about it, from the plan."\n`, { mode: 0o755 })
  return { root, site, status: path.join(site, 'status'), bin }
}
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('timed out')
}

test('draftLinks: the new link first, then the old red one; questions and the Open Questions section left; nothing written', async () => {
  const f = farm()
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(f.root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = f.bin
  process.env.PLAN_SKILLS_DIR = path.join(f.root, 'no-skills')
  const ctx = { origin: 'toy.localhost', status: f.status, farmRoot: f.root }
  const wipBefore = fs.readdirSync(process.env.WIKI_WIP_DIR)
  const s = await draftLinks({ slug: 'toy-plan', story: ghost, direction: 'Add feedback to the restart button.', ...ctx })
  const done = await until(async () => {
    const j = await job({ id: s.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.deepEqual(done.meta.red, [
    { title: 'Restart Button Feedback', slug: 'restart-button-feedback', isNew: true },
    { title: 'Old Red', slug: 'old-red', isNew: false },
  ])
  assert.deepEqual(done.drafts.map(d => [d.slug, d.isNew]), [['restart-button-feedback', true], ['old-red', false]])
  const page = done.drafts[0].page
  assert.equal(page.title, 'Restart Button Feedback') // TITLE: Drafted is not the link's name, so the link's title stands
  assert.match(page.story[0].text, /researched on the web .*through the \[\[Plan Tool\]\]'s Revise Plan, .* for a link on \[\[Toy Plan\]\]/)
  assert.match(page.journal[0].provenance, /through the Plan Tool's Revise Plan/)
  // the model read the redraft and the direction
  const asked = fs.readFileSync(path.join(f.root, 'asked.txt'), 'utf8')
  assert.match(asked, /Restart Button Feedback/)
  assert.match(asked, /<direction note="the owner's direction/)
  // nothing written, no marker taken
  assert.deepEqual(fs.readdirSync(path.join(f.site, 'pages')).sort(), ['toy-plan', 'toy-tool'])
  assert.deepEqual(fs.readdirSync(process.env.WIKI_WIP_DIR), wipBefore)
  assert.equal(done.wip.claimed, null)
})

test('draftLinks: a redraft whose links all have pages is a 400 before anything starts', async () => {
  const f = farm()
  const ctx = { origin: 'toy.localhost', status: f.status, farmRoot: f.root }
  const clean = ghost.map(it => (it.id === 'c1' ? md('c1', '- [ ] Build the thing') : it.id === 'a' ? md('a', 'Opening, linking [[Toy Tool]].') : it))
  await assert.rejects(draftLinks({ slug: 'toy-plan', story: clean, ...ctx }), e => e.status === 400 && /every page the redraft of Toy Plan links is on this farm already/.test(e.message))
})

test('buildResearchContent: direction and talk are material, before the link', () => {
  const { content } = buildResearchContent({ page: plan, link: { title: 'Old Red', kind: 'wikilink', context: 'line' }, origin: 'toy.localhost', direction: 'Do it.', conversation: [{ role: 'owner', text: 'Why?' }] })
  assert.ok(content.indexOf('<direction ') < content.indexOf('<red-link '))
  assert.ok(content.indexOf('<conversation ') < content.indexOf('<red-link '))
  const plain = buildResearchContent({ page: plan, link: { title: 'Old Red', kind: 'wikilink', context: 'line' }, origin: 'toy.localhost' }).content
  assert.doesNotMatch(plain, /<direction|<conversation/)
})
