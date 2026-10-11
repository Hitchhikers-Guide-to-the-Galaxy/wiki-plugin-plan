// Phase 7 — Revise Site: the Open Questions page a research site links from
// its plan, the proposal (its ghost items and the page read back), one page
// through the door and back (keep lines, journal, names), and the two
// handlers end to end on a throwaway farm with a stand-in `claude` behind the
// real shared door.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import {
  openQuestionsLink,
  allQuestions,
  planState,
  questionsOf,
  tickAnswered,
  creditedSites,
  foreignOf,
  isPipeTable,
  pipeRows,
  tableText,
  proposalItems,
  parseProposal,
  proposalApplied,
  namesIn,
  namesCopied,
  doorMarkdown,
  storyFromReply,
  reviseJournal,
} from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-revise-'))
process.env.WIKI_WIP_DIR = scratch()
const { claim, release } = await import('../api/wip.js')
const { buildContent, buildSiteContent, questionsFor, siteOrder } = await import('../api/prompt.js')
const { update, next, reviseSite, applyRevision, job } = await import('../api/handlers.js')
// wiki-client's own journal replay, to check the journal Go Ahead writes.
const revisionJs = path.join(os.homedir(), '.nvm/versions/node', process.version, 'lib/node_modules/wiki/node_modules/wiki-client/lib/revision.js')
const revision = fs.existsSync(revisionJs) ? createRequire(import.meta.url)(revisionJs) : null

const md = (id, text) => ({ type: 'markdown', id, text })
const SITE = 'toy.localhost'

// A small research site: the plan keeps no questions of its own; it links
// [[Open Questions]], where three are kept, two answered.
const plan = () => ({
  title: 'Toy Plan',
  story: [
    md('a', 'A plan for the toy garden, linking [[Where It Breaks]].'),
    { type: 'plan', id: 'p', text: '' },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [x] Write the pages'),
    md('c2', '- [ ] Build the bed'),
    { type: 'timeline', id: 't', text: 'section Phase 1\n2026-10-13..2026-10-17 Build' },
    md('h4', '# See\n\n- [[Open Questions]]\n- [[Where It Breaks]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: [] } }],
})
const openQuestions = () => ({
  title: 'Open Questions',
  story: [
    md('o0', 'What only the humans can settle, for the [[Toy Plan]].'),
    md('o1', '- [ ] [[Is the bed raised?]] or sunk'),
    md('o2', '- [ ] [[Who waters it?]] a rota or one keeper'),
    md('o3', '- [ ] [[Is it open at night?]] lights cost'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Open Questions', story: [] } }],
})

test('openQuestionsLink and allQuestions: the linked page read whole, its questions after the plan\'s own, once each', () => {
  assert.deepEqual(openQuestionsLink(plan()), { title: 'Open Questions', slug: 'open-questions' })
  assert.equal(openQuestionsLink({ story: [md('x', '# Open Questions\n> a heading, not a link.')] }), null)
  // Read whole: the Open Questions page has no section of that name.
  assert.equal(questionsOf(openQuestions()).length, 0)
  assert.equal(questionsOf(openQuestions(), new Set(), undefined, { whole: true }).length, 3)
  const own = plan()
  own.story.splice(6, 0, md('h3', '# Open Questions\n> On the plan.'), md('q1', '- [ ] [[Who waters it?]] already here'), md('q2', '- [ ] [[Is it fenced?]] only here'))
  const qs = allQuestions(own, openQuestions(), new Set(['who-waters-it']))
  assert.deepEqual(qs.map(q => [q.title, q.on, q.answered]), [
    ['Who waters it?', 'plan', true],
    ['Is it fenced?', 'plan', false],
    ['Is the bed raised?', 'open-questions', false],
    ['Is it open at night?', 'open-questions', false],
  ])
  const st = planState(plan(), new Set(['is-the-bed-raised']), undefined, openQuestions())
  assert.equal(st.questions.length, 3)
  assert.equal(st.answered, 1)
  // Without the linked page the plan has no questions, as before.
  assert.equal(planState(plan()).questions.length, 0)
})

test('tickAnswered whole: ticks the linked page\'s lines, one journal edit per item', () => {
  const { page, ticked } = tickAnswered(openQuestions(), new Set(['who-waters-it']), undefined, () => 7, { whole: true })
  assert.deepEqual(ticked.map(t => t.id), ['o2'])
  assert.equal(page.story[2].text, '- [x] [[Who waters it?]] a rota or one keeper')
  assert.deepEqual(page.journal.at(-1), { type: 'edit', id: 'o2', item: page.story[2], date: 7 })
})

test('creditedSites and foreignOf: a fork from another site, a credit; a saved ghost\'s site-less fork is neither', () => {
  const own = { journal: [{ type: 'create', date: 1 }, { type: 'edit', date: 2 }] }
  assert.deepEqual(creditedSites(own, SITE), [SITE])
  assert.equal(foreignOf(own, SITE), null)
  assert.equal(foreignOf({ journal: [{ type: 'create' }, { type: 'fork' }] }, SITE), null)
  assert.equal(foreignOf({ journal: [{ type: 'create' }, { type: 'fork', site: 'other.fish' }] }, SITE), 'forked from other.fish')
  assert.equal(foreignOf({ journal: [{ type: 'create' }, { type: 'edit', attribution: { site: 'other.fish' } }] }, SITE), 'credited to other.fish')
})

const PROPOSAL = [
  '# The tone shift',
  '> From doubt to intent.',
  '',
  'The site asked; the answers decide. The bed is raised and a rota waters it.',
  '',
  '# Pages',
  '> Keep, amend or rewrite, and why.',
  '',
  '| Page | Action | Reason |',
  '|---|---|---|',
  '| Toy Plan | Rewrite | Phase 1 gains the raised bed |',
  '| Welcome Visitors | Amend | Opens on the decision |',
  '| Where It Breaks | Rewrite | The bed is decided |',
  '| Garden Rota | New | The rota the answer asks for |',
  '| Is the bed raised? | Rewrite | the model got this wrong |',
  '| Borrowed Page | Amend | forked, must be refused |',
  '| Open Questions | Amend | the record, must be refused |',
  '| Old Notes | Delete | superseded |',
  '| Glossary | Keep | Unchanged |',
  '| Listed Untouched | Amend | listed below too |',
  '',
  '# Untouched',
  '> Never written.',
  '',
  '- [[Is the bed raised?]] — an answer page',
  '- [[Listed Untouched]] — kept as it is',
  '',
  '# Names',
  '> Copied nowhere until confirmed.',
  '',
  '- [ ] Tamsin Rook — Who waters it?',
  '- [x] Hollow Lane — Who waters it?',
].join('\n')

test('proposalItems: provenance, one item per point, the table a Table Plugin item, each name its own checkbox item, See last', () => {
  let n = 0
  const items = proposalItems({ markdown: PROPOSAL, planTitle: 'Toy Plan', site: SITE, model: 'claude-cli:claude-opus-5-5', date: '2026-10-11', id: () => `i${n++}` })
  assert.match(items[0].text, /^Written by claude-opus-5-5 through the \[\[Plan Tool\]\]'s Revise Site on \[\[Toy Plan\]\], 2026-10-11/)
  const table = items.find(i => i.type === 'table')
  assert.ok(table.text.startsWith('CAPTION Proposed revision of toy.localhost, 2026-10-11\nLAYOUT table\n\n| Page | Action | Reason |'))
  assert.deepEqual(
    items.filter(i => /^- \[[ x]\]/.test(i.text)).map(i => i.text),
    ['- [ ] Tamsin Rook — Who waters it?', '- [x] Hollow Lane — Who waters it?'],
  )
  assert.equal(items.at(-1).text, '# See\n\n- [[Toy Plan]]')
  assert.ok(isPipeTable('| a | b |\n|---|---|\n| 1 | 2 |'))
  assert.ok(!isPipeTable('| a | b |\n| 1 | 2 |'))
  assert.deepEqual(pipeRows(tableText('| Page | Action |\n|---|---|\n| X | Keep |')), [{ page: 'X', action: 'Keep' }])
})

test('parseProposal: the saved page read back, tone, rows in order, untouched, names with their boxes', () => {
  const page = { title: 'Revision Proposal', story: proposalItems({ markdown: PROPOSAL, planTitle: 'Toy Plan', site: SITE }) }
  const p = parseProposal(page)
  assert.equal(p.tone, 'The site asked; the answers decide. The bed is raised and a rota waters it.')
  assert.deepEqual(p.rows.map(r => [r.page, r.action]).slice(0, 4), [
    ['Toy Plan', 'Rewrite'],
    ['Welcome Visitors', 'Amend'],
    ['Where It Breaks', 'Rewrite'],
    ['Garden Rota', 'New'],
  ])
  assert.equal(p.rows.find(r => r.page === 'Old Notes').action, 'Delete')
  assert.deepEqual(p.untouched, ['Is the bed raised?', 'Listed Untouched'])
  assert.deepEqual(p.names, [
    { name: 'Tamsin Rook', answer: 'Who waters it?', confirmed: false },
    { name: 'Hollow Lane', answer: 'Who waters it?', confirmed: true },
  ])
  assert.equal(proposalApplied(page), false)
})

test('names: whole words, any case; a name already on the page was not copied', () => {
  assert.deepEqual(namesIn('ask tamsin rook first', ['Tamsin Rook', 'Rook']), ['Tamsin Rook', 'Rook'])
  assert.deepEqual(namesIn('Rookery', ['Rook']), [])
  const before = { story: [md('a', 'Hollow Lane is wide.')] }
  const after = { story: [md('a', 'Hollow Lane is wide; Tamsin Rook keeps the rota.')] }
  assert.deepEqual(namesCopied(before, after, ['Tamsin Rook', 'Hollow Lane']), ['Tamsin Rook'])
})

test('doorMarkdown and storyFromReply: keep lines bring items back by id, none dropped, no title opener, tables become items, See last', () => {
  const page = plan()
  const shown = doorMarkdown(page)
  assert.ok(shown.includes('{{keep p}}\n```plan\n\n```'))
  assert.ok(shown.includes('{{keep t}}\n```timeline\nsection Phase 1'))
  let n = 0
  const id = () => `n${n++}`
  const reply = [
    '# Toy Plan',
    '',
    'A plan for the raised bed, linking [[Where It Breaks]].',
    '',
    '{{keep p}}',
    '```plan',
    '```',
    '',
    '# See',
    '',
    '- [[Open Questions]]',
    '- [[Where It Breaks]]',
    '',
    '# Phase 1',
    '> Begin.',
    '',
    '- [x] Write the pages',
    '',
    '- [ ] Build the raised bed',
    '',
    '| Bed | Height |',
    '|---|---|',
    '| raised | 40 cm |',
  ].join('\n')
  const story = storyFromReply(page, reply, { id })
  const ids = story.map(i => i.id)
  // No title opener: the first item is the paragraph.
  assert.equal(story[0].text, 'A plan for the raised bed, linking [[Where It Breaks]].')
  // The keep line brought the status item back whole, and its fence was not copied.
  assert.equal(story[1], page.story[1])
  assert.ok(!story.some(i => /^```/.test(i.text || '')))
  // Unchanged text keeps its item.
  assert.ok(ids.includes('h1') && ids.includes('c1'))
  // The timeline the reply left out is back, after the nearest survivor before it (c1), never dropped.
  assert.equal(story[ids.indexOf('c1') + 1].id, 't')
  // A pipe table became a Table Plugin item.
  assert.equal(story.find(i => i.type === 'table').text, 'LAYOUT table\n\n| Bed | Height |\n|---|---|\n| raised | 40 cm |')
  // See moved last.
  assert.equal(story.at(-1).text, '# See\n\n- [[Open Questions]]\n- [[Where It Breaks]]')
  // Every non-markdown item survives a reply that names none of them.
  const bare = storyFromReply(page, 'Only one paragraph.\n\n# See\n\n- [[Open Questions]]', { id })
  assert.deepEqual(bare.filter(i => i.type !== 'markdown').map(i => i.id), ['p', 't'])
  assert.equal(bare.at(-1).text, '# See\n\n- [[Open Questions]]')
})

test('reviseJournal: removes, adds after their predecessor, an edit under the same heading, moves; replayed by wiki-client it gives the new story', () => {
  const old = plan().story
  const reply = 'A new opening.\n\n{{keep t}}\n\n{{keep p}}\n\n# Phase 1\n> Begun.\n\n- [x] Write the pages\n\n- [ ] Build the raised bed\n\n# See\n\n- [[Open Questions]]'
  let n = 0
  const story = storyFromReply({ title: 'Toy Plan', story: old }, reply, { id: () => `n${n++}` })
  const { story: out, actions } = reviseJournal(old, story, { provenance: 'Revised by test', date: 9 })
  // "# Phase 1\n> Begun." takes the place of "# Phase 1\n> Begin.": an edit, the id kept.
  assert.ok(actions.some(a => a.type === 'edit' && a.id === 'h1' && a.item.text === '# Phase 1\n> Begun.'))
  assert.ok(actions.some(a => a.type === 'remove' && a.id === 'a'))
  assert.ok(actions.every(a => a.provenance === 'Revised by test' && a.date === 9))
  assert.ok(actions.some(a => a.type === 'move' && a.id === 't'))
  if (revision) {
    const page = { title: 'Toy Plan', story: old.map(i => ({ ...i })), journal: [] }
    for (const a of actions) revision.apply(page, a)
    assert.deepEqual(page.story.map(i => i.id), out.map(i => i.id))
    assert.deepEqual(page.story.map(i => i.text), out.map(i => i.text))
  }
})

// ---------- the farm ----------

const put = (site, slug, page) => fs.writeFileSync(path.join(site, 'pages', slug), JSON.stringify(page, null, 2))
const read = (site, slug) => JSON.parse(fs.readFileSync(path.join(site, 'pages', slug), 'utf8'))

const farm = () => {
  const root = scratch()
  const site = path.join(root, SITE)
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  put(site, 'toy-plan', plan())
  put(site, 'open-questions', openQuestions())
  put(site, 'is-the-bed-raised', { title: 'Is the bed raised?', story: [md('x1', 'Raised, forty centimetres, so nobody kneels.')], journal: [{ type: 'create', date: 2 }] })
  put(site, 'who-waters-it', { title: 'Who waters it?', story: [md('x2', 'A rota of four households; Tamsin Rook keeps it, from Hollow Lane.')], journal: [{ type: 'create', date: 2 }] })
  put(site, 'welcome-visitors', { title: 'Welcome Visitors', story: [md('w1', 'Welcome to the toy garden. See [[Toy Plan]].'), { type: 'assets', id: 'w2', text: 'welcome-visitors' }], journal: [{ type: 'create', date: 1 }] })
  put(site, 'where-it-breaks', { title: 'Where It Breaks', story: [md('b1', 'It breaks if nobody waters it.'), md('b2', '# See\n\n- [[Toy Plan]]')], journal: [{ type: 'create', date: 1 }] })
  put(site, 'borrowed-page', { title: 'Borrowed Page', story: [md('f1', 'From elsewhere.')], journal: [{ type: 'create', date: 1 }, { type: 'fork', site: 'other.fish', date: 2 }] })
  put(site, 'listed-untouched', { title: 'Listed Untouched', story: [md('l1', 'Leave me.')], journal: [{ type: 'create', date: 1 }] })
  put(site, 'old-notes', { title: 'Old Notes', story: [md('n1', 'Old.')], journal: [{ type: 'create', date: 1 }] })
  put(site, 'glossary', { title: 'Glossary', story: [md('g1', 'Bed: a raised box.')], journal: [{ type: 'create', date: 1 }] })
  return { root, site, status: path.join(site, 'status'), ctx: { origin: SITE, status: path.join(site, 'status'), farmRoot: root } }
}

test('7.1: Do Next Phase and Revise Plan see the answers on the linked Open Questions page first', () => {
  const f = farm()
  const page = read(f.site, 'toy-plan')
  const { questions, openQuestions: oq } = questionsFor(f.site, page)
  assert.equal(oq.slug, 'open-questions')
  assert.deepEqual(questions.filter(q => q.answered).map(q => q.slug), ['is-the-bed-raised', 'who-waters-it'])
  const { account, content } = buildContent({ kind: 'revise', page, origin: SITE, siteDir: f.site, skillsFrom: path.join(f.root, 'no-skills') })
  assert.deepEqual(account.pages.slice(0, 2).map(p => [p.title, p.role]), [
    ['Is the bed raised?', 'answer'],
    ['Who waters it?', 'answer'],
  ])
  assert.ok(content.indexOf('title="Is the bed raised?" role="the answer to an open question"') < content.indexOf('title="Open Questions"'))
})

test('7.1: Update Plan ticks the linked Open Questions page, journaled on that page, not the plan', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const f = farm()
  const before = read(f.site, 'toy-plan')
  const r = await update({ slug: 'toy-plan', ...f.ctx })
  assert.deepEqual(r.ticked.map(t => [t.title, t.page]), [
    ['Is the bed raised?', 'open-questions'],
    ['Who waters it?', 'open-questions'],
  ])
  assert.deepEqual(r.unanswered.map(q => q.title), ['Is it open at night?'])
  assert.equal(r.page.written, false)
  assert.deepEqual(read(f.site, 'toy-plan'), before)
  assert.deepEqual(r.openQuestions, { slug: 'open-questions', title: 'Open Questions', written: true, journalEdits: 2, ticked: 2 })
  const oq = read(f.site, 'open-questions')
  assert.equal(oq.story[1].text, '- [x] [[Is the bed raised?]] or sunk')
  assert.equal(oq.story[3].text, '- [ ] [[Is it open at night?]] lights cost')
  assert.deepEqual(oq.journal.slice(1).map(e => [e.type, e.id]), [['edit', 'o1'], ['edit', 'o2']])
  assert.equal(r.index.reset, true)
})

test('buildSiteContent: answers first, every page in sitemap order, untouched named, overflow as title and first paragraph', () => {
  const f = farm()
  fs.writeFileSync(path.join(f.site, 'status', 'sitemap.json'), JSON.stringify([{ slug: 'welcome-visitors' }, { slug: 'toy-plan' }, { slug: 'gone' }]))
  assert.deepEqual(siteOrder(f.site).slice(0, 3), ['welcome-visitors', 'toy-plan', 'borrowed-page'])
  const page = read(f.site, 'toy-plan')
  const { content, account, untouched } = buildSiteContent({ page, origin: SITE, siteDir: f.site })
  assert.deepEqual(account.answers.map(a => a.title), ['Is the bed raised?', 'Who waters it?'])
  assert.deepEqual(untouched.map(u => [u.title, u.why]), [
    ['Is the bed raised?', 'an answer page'],
    ['Who waters it?', 'an answer page'],
    ['Open Questions', 'the Open Questions page, the record of what was asked'],
    ['Borrowed Page', 'forked from other.fish'],
  ])
  assert.deepEqual(account.pages.map(p => p.title), ['Welcome Visitors', 'Toy Plan', 'Glossary', 'Listed Untouched', 'Old Notes', 'Where It Breaks'])
  assert.ok(content.indexOf('<answer question="Is the bed raised?"') < content.indexOf('<page title="Welcome Visitors"'))
  assert.match(content, /\| Page \| Action \| Reason \|/)
  assert.match(content, /# Names/)
  const small = buildSiteContent({ page, origin: SITE, siteDir: f.site, budget: 300 })
  assert.ok(small.account.brief.length > 0)
  assert.match(small.account.note, /over the 0 kB budget went in as title and first paragraph only/)
  assert.ok(small.content.includes('shown="title and first paragraph only, over the budget"'))
})

// A stand-in claude: answers per page from a folder of replies, keyed by the
// title the request names, and logs the titles in the order asked.
const standIn = (dir, replies) => {
  const bin = path.join(dir, 'claude')
  const rdir = path.join(dir, 'replies')
  fs.mkdirSync(rdir, { recursive: true })
  for (const [title, text] of Object.entries(replies)) fs.writeFileSync(path.join(rdir, encodeURIComponent(title)), text)
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
let input = ''
process.stdin.on('data', d => (input += d)).on('end', () => {
  const m = input.match(/(?:Rewrite the page|Amend the page|Write the new page) "([^"]+)"/)
  const key = m ? m[1] : 'PROPOSAL'
  fs.appendFileSync(${JSON.stringify(path.join(dir, 'asked.log'))}, key + '\\n')
  fs.writeFileSync(${JSON.stringify(path.join(dir, 'asked-'))} + encodeURIComponent(key) + '.txt', input)
  setTimeout(() => process.stdout.write(fs.readFileSync(path.join(${JSON.stringify(rdir)}, encodeURIComponent(key)), 'utf8')), 200)
})
`,
    { mode: 0o755 },
  )
  return bin
}
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('timed out')
}

const REPLIES = {
  PROPOSAL,
  'Toy Plan': 'A plan for the raised garden bed, linking [[Where It Breaks]].\n\n{{keep p}}\n\n# Phase 1\n> Begin with the raised bed.\n\n- [x] Write the pages\n\n- [ ] Build the raised bed, forty centimetres\n\n{{keep t}}\n\n# See\n\n- [[Open Questions]]\n- [[Where It Breaks]]\n- [[Revision Proposal]]',
  'Welcome Visitors': 'Welcome to the toy garden: a raised bed, watered by a rota. See [[Toy Plan]].\n\n{{keep w2}}',
  'Where It Breaks': 'It no longer breaks for want of water: a rota of four households keeps it, run by Tamsin Rook.\n\n# See\n\n- [[Toy Plan]]',
  'Garden Rota': 'Four households take a week each, from Hollow Lane.\n\n# See\n\n- [[Toy Plan]]',
}

test('reviseSite then applyRevision: the proposal, then each page through the door, refusals, names, the plan last, the record left alone', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const f = farm()
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(f.root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = standIn(f.root, REPLIES)
  delete process.env.CLAUDE_DOOR_MODEL
  delete process.env.AUDIONOTE_SUMMARY_MODEL
  const marker = () => JSON.parse(fs.readFileSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json'), 'utf8'))

  // Revise Site: a job, nothing written.
  const before = Object.fromEntries(fs.readdirSync(path.join(f.site, 'pages')).map(s => [s, fs.readFileSync(path.join(f.site, 'pages', s), 'utf8')]))
  const started = await reviseSite({ slug: 'toy-plan', ...f.ctx })
  assert.equal(started.kind, 'site')
  assert.equal(started.reportTitle, 'Revision Proposal')
  assert.equal(marker().session, 'Plan Tool: Revise Site toy.localhost/toy-plan')
  const done = await until(async () => {
    const j = await job({ id: started.job, ...f.ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.equal(done.result.markdown, PROPOSAL)
  assert.deepEqual(done.result.proposal, { rows: 10, actions: { Rewrite: 3, Amend: 4, New: 1, Delete: 1, Keep: 1 }, untouched: 2, names: 2, tone: true })
  assert.deepEqual(done.context.answers.map(a => a.title), ['Is the bed raised?', 'Who waters it?'])
  assert.equal(marker().status, 'DONE')
  for (const [s, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(f.site, 'pages', s), 'utf8'), text, `${s} was not written`)

  // Pause: the client saves the ghost as a page (here, as it would) and links it from the plan.
  const proposal = { title: 'Revision Proposal', story: proposalItems({ markdown: done.result.markdown, planTitle: 'Toy Plan', site: SITE }), journal: [{ type: 'create', date: 3 }, { type: 'fork', date: 3 }] }
  put(f.site, 'revision-proposal', proposal)
  // A second Revise Site would title its proposal by the date.
  const p = plan()
  p.story[6].text += '\n- [[Revision Proposal]]'
  put(f.site, 'toy-plan', p)

  // Go Ahead.
  const oqBefore = fs.readFileSync(path.join(f.site, 'pages', 'open-questions'), 'utf8')
  const answerBefore = fs.readFileSync(path.join(f.site, 'pages', 'who-waters-it'), 'utf8')
  const go = await applyRevision({ slug: 'revision-proposal', ...f.ctx })
  assert.equal(go.kind, 'apply')
  assert.deepEqual(go.pages.map(x => [x.title, x.action]), [
    ['Welcome Visitors', 'Amend'],
    ['Where It Breaks', 'Rewrite'],
    ['Garden Rota', 'New'],
    ['Toy Plan', 'Rewrite'],
  ])
  assert.deepEqual(go.refused.map(r => [r.title, r.why]), [
    ['Is the bed raised?', 'an answer page is never written'],
    ['Borrowed Page', 'forked from other.fish: another site\'s page is never written'],
    ['Open Questions', 'the Open Questions page is the record of what was asked'],
    ['Old Notes', 'a page is never deleted'],
    ['Listed Untouched', 'listed under Untouched on the proposal'],
  ])
  assert.deepEqual(go.kept, ['Glossary'])
  assert.equal(marker().session, 'plan: revise site toy.localhost')
  assert.deepEqual(marker().scope, ['toy.localhost'])
  // A second run while this one holds the marker: 409.
  await assert.rejects(applyRevision({ slug: 'revision-proposal', ...f.ctx }), e => e.status === 409)

  const end = await until(async () => {
    const j = await job({ id: go.job, ...f.ctx })
    return j.status !== 'running' && j
  })
  assert.equal(end.status, 'done', end.error)
  assert.deepEqual(end.progress, { n: 4, of: 4, title: 'Toy Plan' })
  // The plan last; Glossary and the refused never asked.
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'asked.log'), 'utf8').trim().split('\n'), ['PROPOSAL', 'Welcome Visitors', 'Where It Breaks', 'Garden Rota', 'Toy Plan'])
  // The unconfirmed name went to the door as a name not to use; the confirmed one did not.
  const asked = fs.readFileSync(path.join(f.root, `asked-${encodeURIComponent('Where It Breaks')}.txt`), 'utf8')
  assert.match(asked, /do not write any of them anywhere on this page: Tamsin Rook\./)
  assert.ok(!/: Hollow Lane/.test(asked))
  assert.match(asked, /<page title="Where It Breaks">\nIt breaks if nobody waters it\./)
  // Where It Breaks came back carrying Tamsin Rook: refused, not written.
  assert.deepEqual(end.account.refused.at(-1), { title: 'Where It Breaks', action: 'Rewrite', why: 'name not confirmed: Tamsin Rook' })
  assert.equal(read(f.site, 'where-it-breaks').story[0].text, 'It breaks if nobody waters it.')
  // Written: Welcome Visitors (its assets item kept by id), Garden Rota (new, Hollow Lane is ticked), the plan.
  assert.deepEqual(end.account.written.map(w => [w.title, w.action]), [['Welcome Visitors', 'Amend'], ['Garden Rota', 'New'], ['Toy Plan', 'Rewrite']])
  const w = read(f.site, 'welcome-visitors')
  assert.deepEqual(w.story[1], { type: 'assets', id: 'w2', text: 'welcome-visitors' })
  const prov = 'Revised by the Plan Tool (Revise Site) from Revision Proposal, drawing on: Is the bed raised?; Who waters it?.'
  assert.ok(w.journal.slice(1).length > 0 && w.journal.slice(1).every(e => e.provenance === prov))
  assert.deepEqual(w.journal.slice(1).map(e => e.type), ['remove', 'add'])
  const rota = read(f.site, 'garden-rota')
  assert.equal(rota.journal[0].type, 'create')
  assert.equal(rota.journal[0].provenance, prov)
  // The plan: written last, its status line and timeline kept, ticks kept, asset re-rendered.
  const tp = read(f.site, 'toy-plan')
  assert.deepEqual(tp.story.find(i => i.id === 'p'), { type: 'plan', id: 'p', text: '' })
  assert.ok(tp.story.some(i => i.id === 't' && i.type === 'timeline'))
  assert.ok(tp.story.some(i => i.text === '- [x] Write the pages'))
  const planEntry = end.account.written.at(-1)
  assert.ok(planEntry.before > 0 && planEntry.after > 0)
  assert.equal(planEntry.asset.path, '/assets/toy-plan/toy-plan.md')
  assert.match(fs.readFileSync(path.join(f.site, 'assets', 'toy-plan', 'toy-plan.md'), 'utf8'), /Build the raised bed, forty centimetres/)
  // 7.7: the Open Questions page and the answer pages are untouched; nothing deleted.
  assert.equal(fs.readFileSync(path.join(f.site, 'pages', 'open-questions'), 'utf8'), oqBefore)
  assert.equal(fs.readFileSync(path.join(f.site, 'pages', 'who-waters-it'), 'utf8'), answerBefore)
  for (const s of Object.keys(before)) assert.ok(fs.existsSync(path.join(f.site, 'pages', s)), `${s} still exists`)
  assert.equal(fs.readFileSync(path.join(f.site, 'pages', 'borrowed-page'), 'utf8'), before['borrowed-page'])
  assert.equal(fs.readFileSync(path.join(f.site, 'pages', 'old-notes'), 'utf8'), before['old-notes'])
  // The proposal says it was applied, and is not applied twice.
  const after = read(f.site, 'revision-proposal')
  assert.ok(proposalApplied(after))
  assert.match(after.story.at(-2).text, /3 pages written \(\[\[Welcome Visitors\]\], \[\[Garden Rota\]\], \[\[Toy Plan\]\]\), 6 refused, 0 failed, 1 kept/)
  assert.equal(after.story.at(-1).text, '# See\n\n- [[Toy Plan]]')
  await assert.rejects(applyRevision({ slug: 'revision-proposal', ...f.ctx }), e => e.status === 400 && /already been applied/.test(e.message))
  assert.equal(marker().status, 'DONE')
  assert.equal(end.account.indexReset, true)
  // A second Revise Site titles its proposal by the date.
  const again = await reviseSite({ slug: 'toy-plan', ...f.ctx })
  assert.equal(again.reportTitle, `Revision Proposal ${new Date().toISOString().slice(0, 10)}`)
  await until(async () => (await job({ id: again.job, ...f.ctx })).status !== 'running')
})

test('reviseSite and applyRevision refuse before any claim', async () => {
  process.env.WIKI_WIP_DIR = scratch()
  const f = farm()
  // No answer page yet.
  fs.rmSync(path.join(f.site, 'pages', 'is-the-bed-raised'))
  fs.rmSync(path.join(f.site, 'pages', 'who-waters-it'))
  await assert.rejects(reviseSite({ slug: 'toy-plan', ...f.ctx }), e => e.status === 400 && /no open question of Toy Plan has an answer page/.test(e.message))
  await assert.rejects(reviseSite({ slug: 'glossary', ...f.ctx }), e => e.status === 400 && /is not a plan/.test(e.message))
  await assert.rejects(applyRevision({ slug: 'glossary', ...f.ctx }), e => e.status === 400 && /not a revision proposal/.test(e.message))
  await assert.rejects(applyRevision({ slug: 'no-such', ...f.ctx }), e => e.status === 404)
  assert.ok(!fs.existsSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.lock')))
  // A live claim by another: 409, nothing started.
  const c = claim({ session: 'another session' })
  put(f.site, 'is-the-bed-raised', { title: 'Is the bed raised?', story: [md('x1', 'Raised.')], journal: [] })
  await assert.rejects(reviseSite({ slug: 'toy-plan', ...f.ctx }), e => e.status === 409 && /another session/.test(e.message))
  release(c.token)
})
