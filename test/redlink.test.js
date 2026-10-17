// 0.6.0 — Red-link: find the plan's links with no page behind them and stub
// them, the house meaning of "red-link this page" (fedwiki-stub-page).
// Question links and the Open Questions section are never stubbed. End to end
// on a throwaway farm with a stand-in `claude` behind the real shared door.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { planLinks, redLinksOf, titleCase, parseStubs, matchStubs, stubStory, stubPage, stubOfStubs, STUB_LINE, asSlug } from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-stubs-'))
process.env.WIKI_WIP_DIR = scratch()
const { buildStubsContent } = await import('../api/prompt.js')
const { redlink, writeStubs, job } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const plan = () => ({
  title: 'Hook Plan',
  story: [
    md('a', 'Run the [[Webhook relay]] on the [[Pi5]], see [[Hook Plan]] and [[Is it safe?]] for the worry.'),
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1\n> Stand up the relay.'),
    md('c1', '- [ ] Point the [[capability URL]] at [[Caddy]]'),
    md('f', '```\n[[Not A Link]]\n```\nThen [[Synapse]] answers.'),
    { type: 'code', id: 'k', text: '[[Code Link]]' },
    { type: 'timeline', id: 't', text: 'section Build\n2026-10-20 Relay Build #Phase1\n2026-10-21..2026-10-22 Pi5' },
    md('q', '# Open Questions\n> Made by hand.'),
    md('q1', '- [ ] [[Which relay?]] the [[Glossary Entry]] says'),
    md('s', '# See\n\n- [[Webhook relay]]\n- [[Welcome Visitors]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Hook Plan', story: [] } }],
})

test('planLinks: wikilinks outside fences, timeline labels; code items hold none', () => {
  const titles = planLinks(plan()).map(l => l.title)
  assert.ok(titles.includes('Relay Build'), 'a timeline label, its #Group dropped')
  assert.ok(titles.includes('Synapse'))
  assert.ok(!titles.includes('Not A Link'), 'not inside a fence')
  assert.ok(!titles.includes('Code Link'), 'not from a code item')
  assert.ok(!titles.includes('Build'), 'a section name is not a link')
})

test('redLinksOf: red once each; questions, Open Questions, own title and known pages never', () => {
  const r = redLinksOf(plan(), new Set(['pi5', 'welcome-visitors']))
  assert.deepEqual(r.red.map(x => x.title), ['Webhook relay', 'capability URL', 'Caddy', 'Synapse', 'Relay Build'])
  assert.deepEqual(r.questions, ['Is it safe?', 'Which relay?'])
  assert.deepEqual(r.held, ['Glossary Entry'])
  assert.equal(r.existing, 2)
  assert.equal(r.red[0].context, 'Run the [[Webhook relay]] on the [[Pi5]], see [[Hook Plan]] and [[Is it safe?]] for the worry.')
  assert.equal(r.red[1].section, 'Phase 1')
})

test('titleCase: the link words capitalised; capitals and small words kept', () => {
  assert.equal(titleCase('capability URL'), 'Capability URL')
  assert.equal(titleCase('state of the art'), 'State of the Art')
  assert.equal(titleCase('deSEC zone'), 'deSEC Zone')
  assert.equal(asSlug(titleCase('machine-free name')), asSlug('machine-free name'), 'same slug, so the link resolves')
})

test('parseStubs and matchStubs: drafts by heading, matched to what was asked by slug', () => {
  const drafts = parseStubs('=== Webhook relay\nThis page is an AI generated [[Stub]]. A relay.\n\n=== [[Caddy]] ===\nA web server.\n\n=== Stray\nNot asked for.\n=== Empty\n')
  assert.deepEqual(drafts.map(d => d.title), ['Webhook relay', 'Caddy', 'Stray'])
  const red = [{ title: 'Webhook relay', slug: 'webhook-relay' }, { title: 'caddy', slug: 'caddy' }, { title: 'Synapse', slug: 'synapse' }]
  const m = matchStubs(drafts, red)
  assert.deepEqual(m.stubs.map(s => [s.title, s.slug]), [['Webhook Relay', 'webhook-relay'], ['Caddy', 'caddy']])
  assert.deepEqual(m.missing, ['Synapse'])
})

test('stubStory: the accreditation line first, a title heading and a model See dropped, See = Stub + plan', () => {
  let n = 0
  const id = () => `i${n++}`
  const plain = stubStory({ title: 'Caddy', markdown: '# Caddy\n\nA web server that fronts the farm.\n\n# See\n\n- [[Elsewhere]]', planTitle: 'Hook Plan', id })
  assert.equal(plain[0].text, `${STUB_LINE} A web server that fronts the farm.`)
  assert.equal(plain.at(-1).text, '# See\n\n- [[Stub]]\n- [[Hook Plan]]')
  assert.equal(plain.length, 2)
  const opened = stubStory({ title: 'Relay', markdown: `${STUB_LINE} A relay.\n\n# How It Runs\n> Behind Caddy.\n\nOne process.`, planTitle: 'Hook Plan', id })
  assert.deepEqual(opened.map(i => i.text.split('\n')[0]), [`${STUB_LINE} A relay.`, '# How It Runs', 'One process.', '# See'])
  const page = stubPage({ title: 'Relay', markdown: 'A relay.', planTitle: 'Hook Plan', model: 'claude-cli:claude-opus-5', date: 7, id })
  assert.equal(page.journal.length, 1)
  assert.equal(page.journal[0].type, 'create')
  assert.match(page.journal[0].provenance, /^AI generated stub for a red link on Hook Plan, through the Plan Tool's Red-link by claude-opus-5\.$/)
  assert.deepEqual(page.journal[0].item.story, page.story)
  assert.equal(stubOfStubs().title, 'Stub')
})

test('buildStubsContent: the plan, the site titles, each red link with its line', () => {
  const r = redLinksOf(plan(), new Set(['pi5', 'welcome-visitors']))
  const { content, account } = buildStubsContent({ page: plan(), red: r.red, origin: 'hooks.localhost', titles: ['Welcome Visitors', 'Pi5'] })
  assert.match(content, /<red-links count="5">/)
  assert.match(content, /- capability URL \(under "Phase 1"\): - \[ \] Point the \[\[capability URL\]\] at \[\[Caddy\]\]/)
  assert.match(content, /This page is an AI generated \[\[Stub\]\]\./)
  assert.match(content, /=== Title/)
  assert.equal(account.red, 5)
})

const standIn = (dir, answer) => {
  const bin = path.join(dir, 'claude')
  fs.writeFileSync(path.join(dir, 'answer.md'), answer)
  fs.writeFileSync(bin, `#!/bin/sh\ncat > "${dir}/asked.txt"\nsleep 1\ncat "${dir}/answer.md"\n`, { mode: 0o755 })
  return bin
}
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('timed out')
}

test('redlink and writeStubs on a farm: drafts in a job, then new pages, the Stub page, never an overwrite', async () => {
  const root = scratch()
  const extra = scratch()
  const site = path.join(root, 'hooks.localhost')
  for (const d of [path.join(site, 'pages'), path.join(site, 'status'), path.join(root, 'sister.localhost', 'pages'), path.join(extra, 'public.fish', 'pages')]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(site, 'pages', 'hook-plan'), JSON.stringify(plan(), null, 2))
  fs.writeFileSync(path.join(site, 'pages', 'welcome-visitors'), '{}')
  fs.writeFileSync(path.join(root, 'sister.localhost', 'pages', 'pi5'), '{}') // on a sibling site: not red
  fs.writeFileSync(path.join(extra, 'public.fish', 'pages', 'synapse'), '{}') // on an extra farm: not red
  process.env.WIKI_EXTRA_FARMS = extra
  const ctx = { origin: 'hooks.localhost', status: path.join(site, 'status'), farmRoot: root }
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = standIn(root, '=== Webhook relay\nThis page is an AI generated [[Stub]]. The relay takes the bot\'s posts.\n\n=== capability URL\nA URL that is its own key.\n\n=== Caddy\nThe web server in front of the farm.\n')
  delete process.env.CLAUDE_DOOR_MODEL

  const started = await redlink({ slug: 'hook-plan', ...ctx })
  const done = await until(async () => {
    const j = await job({ id: started.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.deepEqual(done.meta.red, ['Webhook relay', 'capability URL', 'Caddy', 'Relay Build'])
  assert.deepEqual(done.meta.questions, ['Is it safe?', 'Which relay?'])
  assert.deepEqual(done.result.stubs.map(s => s.title), ['Webhook Relay', 'Capability URL', 'Caddy'])
  assert.deepEqual(done.result.missing, ['Relay Build'])
  const asked = fs.readFileSync(path.join(root, 'asked.txt'), 'utf8')
  assert.ok(!asked.includes('- Which relay?'), 'a question was never asked for')
  assert.deepEqual(fs.readdirSync(path.join(site, 'pages')).sort(), ['hook-plan', 'welcome-visitors'], 'the job wrote nothing')

  // Someone writes a Caddy page meanwhile: Create never overwrites it.
  fs.writeFileSync(path.join(site, 'pages', 'caddy'), '{"title":"Caddy","story":[],"journal":[]}')
  const w = await writeStubs({ slug: 'hook-plan', job: started.job, ...ctx })
  assert.deepEqual(w.written.map(x => x.slug), ['webhook-relay', 'capability-url'])
  assert.deepEqual(w.skipped.map(x => x.slug), ['caddy'])
  assert.equal(w.stubPage, true)
  assert.equal(fs.readFileSync(path.join(site, 'pages', 'caddy'), 'utf8'), '{"title":"Caddy","story":[],"journal":[]}')
  const relay = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'webhook-relay'), 'utf8'))
  assert.equal(relay.title, 'Webhook Relay')
  assert.match(relay.story[0].text, /^This page is an AI generated \[\[Stub\]\]\. The relay takes/)
  assert.equal(relay.story.at(-1).text, '# See\n\n- [[Stub]]\n- [[Hook Plan]]')
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'pages', 'capability-url'), 'utf8')).story[0].text, `${STUB_LINE} A URL that is its own key.`)
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'pages', 'stub'), 'utf8')).title, 'Stub')

  const again = await writeStubs({ slug: 'hook-plan', job: started.job, titles: ['Webhook Relay'], ...ctx })
  assert.deepEqual(again.written, [])
  assert.equal(again.skipped[0].slug, 'webhook-relay')
  await assert.rejects(writeStubs({ slug: 'hook-plan', job: started.job, titles: ['Nope'], ...ctx }), e => e.status === 400)

  // Only Relay Build is red now; a plan with none is told so.
  const left = redLinksOf(JSON.parse(fs.readFileSync(path.join(site, 'pages', 'hook-plan'), 'utf8')), new Set([...fs.readdirSync(path.join(site, 'pages')), 'pi5', 'synapse']))
  assert.deepEqual(left.red.map(r => r.title), ['Relay Build'])
  fs.writeFileSync(path.join(site, 'pages', 'relay-build'), '{}')
  await assert.rejects(redlink({ slug: 'hook-plan', ...ctx }), e => e.status === 400 && /has no red links/.test(e.message) && /2 question links are left for their answers/.test(e.message))
  delete process.env.WIKI_EXTRA_FARMS
})
