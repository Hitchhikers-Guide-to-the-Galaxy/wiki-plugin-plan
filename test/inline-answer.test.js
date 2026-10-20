// 0.8.0 — Open Questions answered on their own line, "*Answer: …*" after the
// question link, as on dns.private.fish/view/resource-map-plan. The parser
// reads them, Update Plan ticks them, the state view counts them, and Revise
// Plan and Revise Site hand them to the door; a reply ending in "?" asks back
// and is a query, not an answer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { inlineAnswer, questionsOf, tickAnswered, planState } from '../src/client/core.js'

// These runs stand in for the Claude CLI: name Claude, not the coop default (0.10.0).
process.env.PLAN_MODEL = 'claude-opus-5-5'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-inline-'))
process.env.WIKI_WIP_DIR = scratch()
const { buildContent, buildSiteContent } = await import('../api/prompt.js')
const { reviseSite } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })

// The lines as written on the Resource Map Plan, 17 October 2026.
const plan = () => ({
  title: 'Map Plan',
  story: [
    md('a', 'Opening, linking [[Map Card]].'),
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [ ] Build the route'),
    md('h2', '# Open Questions\n> For David.'),
    md('q1', '- [x] [[Who may see a tailnet-scope card?]] everyone on our tailnet, or only the people its offerer names. *Answer: everyone on our tailnet.*'),
    md('q2', '- [ ] [[Whose key signs a card?]] the operator, the Embassy, or both. *Answer: Both*'),
    md('q3', "- [x] [[What may be sent to a resource?]] a CONSENT line per kind of material, or per caller. *Answer: Explain more i do nto follow?*"),
    md('q4', '- [ ] [[Is there a page?]] answered by a page'),
    md('q5', '- [ ] [[Is it open?]] nobody has said'),
    md('q6', '- [ ] [[Bold form?]] **Answer:** Through peers. Policy decided by VTC.'),
    md('h3', '# See\n\n- [[Map Card]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Map Plan', story: [] } }],
})

test('inlineAnswer: the forms after the link, emphasis stripped; none is ""', () => {
  assert.equal(inlineAnswer('[[A?]] gloss. *Answer: everyone on our tailnet.*'), 'everyone on our tailnet.')
  assert.equal(inlineAnswer('[[A?]] *Answer: Yes*'), 'Yes')
  assert.equal(inlineAnswer('[[A?]] _Answer: Both._'), 'Both.')
  assert.equal(inlineAnswer('[[A?]] **Answer:** Through peers.'), 'Through peers.')
  assert.equal(inlineAnswer('[[A?]] Answer: plain'), 'plain')
  assert.equal(inlineAnswer('[[A?]] gloss only'), '')
  assert.equal(inlineAnswer('[[A?]] *Answer:*'), '')
  assert.equal(inlineAnswer('[[Answer: inside the link?]] gloss'), '', 'the link title is not the line')
})

test('questionsOf: answered by a page or on the line; a reply ending in ? is a query', () => {
  const qs = questionsOf(plan(), new Set(['is-there-a-page']))
  assert.deepEqual(
    qs.map(q => [q.title, q.answered, q.by, q.answer, q.query, q.ticked]),
    [
      ['Who may see a tailnet-scope card?', true, 'inline', 'everyone on our tailnet.', '', true],
      ['Whose key signs a card?', true, 'inline', 'Both', '', false],
      ['What may be sent to a resource?', false, null, '', 'Explain more i do nto follow?', true],
      ['Is there a page?', true, 'page', '', '', false],
      ['Is it open?', false, null, '', '', false],
      ['Bold form?', true, 'inline', 'Through peers. Policy decided by VTC.', '', false],
    ],
  )
})

test('planState: inline answers count, a query blocks and is counted apart', () => {
  const st = planState(plan(), new Set(['is-there-a-page', 'map-card']))
  assert.equal(st.answered, 4)
  assert.equal(st.answeredInline, 3)
  assert.equal(st.queried, 1)
  assert.deepEqual(st.blockers.questions.map(q => q.title), ['What may be sent to a resource?', 'Is it open?'])
})

test('tickAnswered: ticks unticked lines answered on the line, never a query or an open one', () => {
  const { page, ticked, unanswered } = tickAnswered(plan(), new Set(), undefined, () => 7)
  assert.deepEqual(ticked.map(t => [t.id, t.by]), [['q2', 'inline'], ['q6', 'inline']])
  assert.match(page.story.find(i => i.id === 'q2').text, /^- \[x\] \[\[Whose key signs a card\?\]\]/)
  assert.match(page.story.find(i => i.id === 'q3').text, /^- \[x\]/, "the author's own tick on a query is left alone")
  assert.match(page.story.find(i => i.id === 'q5').text, /^- \[ \]/)
  assert.deepEqual(unanswered, [
    { title: 'What may be sent to a resource?', slug: 'what-may-be-sent-to-a-resource', query: 'Explain more i do nto follow?' },
    { title: 'Is there a page?', slug: 'is-there-a-page' },
    { title: 'Is it open?', slug: 'is-it-open' },
  ])
  assert.deepEqual(page.journal.slice(1).map(e => [e.type, e.id, e.date]), [['edit', 'q2', 7], ['edit', 'q6', 7]])
})

const farm = () => {
  const root = scratch()
  const site = path.join(root, 'map.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  const put = (slug, page) => fs.writeFileSync(path.join(site, 'pages', slug), JSON.stringify(page))
  put('map-plan', plan())
  put('is-there-a-page', { title: 'Is there a page?', story: [md('x', 'Yes, this one.')], journal: [] })
  put('map-card', { title: 'Map Card', story: [md('y', 'A card.')], journal: [] })
  return { root, site, status: path.join(site, 'status') }
}

test('buildContent: Revise Plan is given the line answers and the query, and told what to do with each', () => {
  const f = farm()
  const page = plan()
  const { content, account } = buildContent({ kind: 'revise', page, origin: 'map.localhost', siteDir: f.site, skillsFrom: scratch() })
  assert.ok(content.includes(`<answer question="Whose key signs a card?" written="on the question's line">\nBoth\n</answer>`))
  assert.ok(content.includes('<query question="What may be sent to a resource?" note="a reply that asks back; the question is not answered">\nExplain more i do nto follow?\n</query>'))
  assert.deepEqual(account.inlineAnswers, ['Who may see a tailnet-scope card?', 'Whose key signs a card?', 'Bold form?'])
  assert.deepEqual(account.queries, ['What may be sent to a resource?'])
  assert.deepEqual(account.pages.map(p => [p.title, p.role]), [['Is there a page?', 'answer'], ['Map Card', 'linked']])
  assert.match(content, /the answers written on the question lines above/)
  assert.match(content, /A reply tagged as a query asks back/)
  assert.ok(content.indexOf('<answer question=') < content.indexOf('Redraft the plan'))
})

test('buildSiteContent: line answers lead with the answer pages, are never named untouched', () => {
  const f = farm()
  const { content, account, untouched } = buildSiteContent({ page: plan(), origin: 'map.localhost', siteDir: f.site })
  assert.deepEqual(
    account.answers.map(a => [a.title, !!a.inline]),
    [
      ['Who may see a tailnet-scope card?', true],
      ['Whose key signs a card?', true],
      ['Is there a page?', false],
      ['Bold form?', true],
    ],
  )
  assert.deepEqual(account.queries, ['What may be sent to a resource?'])
  assert.deepEqual(untouched.map(u => u.title), ['Is there a page?'])
  assert.ok(content.includes(`<answer question="Bold form?" written="on the question's line">\nThrough peers. Policy decided by VTC.\n</answer>`))
  assert.ok(content.indexOf('<query question=') < content.indexOf('<page title="Map Plan"'))
})

test('reviseSite: a plan answered only on its lines is not refused as unanswered', async () => {
  const root = scratch()
  const site = path.join(root, 'only.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  const p = plan()
  p.story = p.story.filter(i => i.id !== 'q4')
  fs.writeFileSync(path.join(site, 'pages', 'map-plan'), JSON.stringify(p))
  const none = { ...p, story: p.story.filter(i => !/^q/.test(i.id) || i.id === 'q5') }
  fs.writeFileSync(path.join(site, 'pages', 'none-plan'), JSON.stringify({ ...none, title: 'None Plan' }))
  const ctx = { origin: 'only.localhost', status: path.join(site, 'status') }
  // Never the real claude: a door that fails at once.
  process.env.CLAUDE_DOOR_BIN = '/usr/bin/false'
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(root, 'no-key')
  await assert.rejects(reviseSite({ slug: 'none-plan', ...ctx }), e => e.status === 400 && /is answered on only\.localhost yet/.test(e.message))
  // The answered plan gets past the check; whatever the door then does is the job's business.
  const r = await reviseSite({ slug: 'map-plan', ...ctx }).catch(e => e)
  assert.ok(!(r instanceof Error && r.status === 400 && /is answered/.test(r.message)), String(r && r.message))
  assert.ok(r && r.job, 'a job was started')
  await new Promise(res => setTimeout(res, 200))
})
