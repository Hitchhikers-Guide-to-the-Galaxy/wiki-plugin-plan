// 0.16.0 — Talk it over (a conversation about the plan that writes nothing,
// and that a revision may draw on) and the ladder (a failed model climbs to a
// stronger one, and the coop's failures are logged where the coop can read).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { reviseItems, writeRevision } from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-talk-'))
process.env.WIKI_WIP_DIR = scratch()
const { buildContent, fitTalk } = await import('../api/prompt.js')
const { chat, checkTalk, revise } = await import('../api/handlers.js')
const { ladder, nextRung, failureKind, thenText, failureText, logFailures, DEFAULT_LADDER } = await import('../api/ladder.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const toy = () => ({
  title: 'Toy Plan',
  story: [md('a', 'Opening, linking [[Toy Tool]].'), { type: 'plan', id: 'p', text: 'STATUS' }, md('h1', '# Phase 1\n> Begin.'), md('c1', '- [ ] Build the thing')],
  journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: [] } }],
})
const farm = () => {
  const root = scratch()
  const site = path.join(root, 'toy.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  fs.writeFileSync(path.join(site, 'pages', 'toy-plan'), JSON.stringify(toy()))
  return { root, site, status: path.join(site, 'status') }
}
const talk = [
  { role: 'owner', text: 'Is Phase 1 too big?' },
  { role: 'model', text: 'It could be split: build, then test.' },
  { role: 'owner', text: 'Yes, split it.' },
]

// ---------- the talk ----------

test('fitTalk: newest kept within the cap, empty and unknown turns dropped', () => {
  const t = [{ role: 'owner', text: 'a'.repeat(30) }, { role: 'x', text: 'no' }, { role: 'model', text: ' ' }, { role: 'model', text: 'b'.repeat(30) }, { role: 'owner', text: 'c'.repeat(30) }]
  assert.deepEqual(fitTalk(t, 70).turns.map(x => x.text[0]), ['b', 'c'])
  assert.equal(fitTalk(t, 70).dropped, 1)
  assert.equal(fitTalk(t).turns.length, 3)
})

test('buildContent chat: the plan, the talk so far in its tags, then the message outside them', () => {
  const f = farm()
  const { content, account } = buildContent({ kind: 'chat', page: toy(), origin: 'toy.localhost', siteDir: f.site, skillsFrom: scratch(), conversation: talk, message: 'And Phase 2?' })
  assert.ok(content.indexOf('<plan ') < content.indexOf('<conversation note="the talk so far">'))
  assert.match(content, /The owner:\nIs Phase 1 too big\?\n\nThe model:\nIt could be split/)
  assert.ok(content.lastIndexOf('</conversation>') < content.indexOf('"""\nAnd Phase 2?\n"""'))
  assert.match(content, /Nothing you say changes the plan/)
  assert.doesNotMatch(content, /# What Changed/)
  assert.equal(account.talk, 3)
})

test('buildContent revise: a talk goes in as material with its rule; none, no rule', () => {
  const f = farm()
  const withTalk = buildContent({ kind: 'revise', page: toy(), origin: 'toy.localhost', siteDir: f.site, skillsFrom: scratch(), mode: 'direction', direction: 'Split Phase 1.', conversation: talk })
  assert.match(withTalk.content, /<conversation note="the owner talked the plan over with a model before asking for this revision">/)
  assert.match(withTalk.content, /a suggestion the model made that the owner did not take up is not a decision/)
  const without = buildContent({ kind: 'revise', page: toy(), origin: 'toy.localhost', siteDir: f.site, skillsFrom: scratch(), mode: 'tidy' })
  assert.doesNotMatch(without.content, /<conversation|not a decision/)
  assert.equal(without.account.talk, undefined)
})

test('checkTalk and chat: refusals before anything starts', async () => {
  assert.deepEqual(checkTalk(undefined), [])
  assert.deepEqual(checkTalk([{ role: 'owner', text: ' ' }, ...talk]).length, 3)
  assert.throws(() => checkTalk('hi'), e => e.status === 400)
  assert.throws(() => checkTalk([{ role: 'system', text: 'x' }]), e => e.status === 400)
  const f = farm()
  const ctx = { origin: 'toy.localhost', status: f.status }
  await assert.rejects(chat({ slug: 'toy-plan', message: '  ', ...ctx }), e => e.status === 400 && /message is empty/.test(e.message))
  await assert.rejects(chat({ slug: 'toy-plan', message: 'x'.repeat(6001), ...ctx }), e => e.status === 400 && /under 6,000/.test(e.message))
  await assert.rejects(revise({ slug: 'toy-plan', conversation: [{ role: 'x' }], ...ctx }), e => e.status === 400)
})

test('the ghost line and the journal say a talk was drawn on', () => {
  let n = 0
  const items = reviseItems({ page: toy(), markdown: 'x', model: 'm', date: 'd', id: () => `g${n++}`, mode: 'direction', direction: 'Split it.', talk: 3 })
  assert.match(items[0].text, /Revise Plan, from the owner's direction, drawing on a talk of 3 turns, by m, d\./)
  const out = writeRevision(toy(), toy().story.concat([md('n', '- [ ] Test the thing')]), { model: 'm', date: 5, mode: 'direction', direction: 'Split it.', talk: 3 })
  assert.equal(out.actions[0].planTool.talk, 3)
  assert.ok(out.actions.slice(1).every(a => !('talk' in a.planTool)))
})

// ---------- the ladder ----------

test('ladder: Claude Fable through the CLI by default; PLAN_LADDER names the rungs; off is none', () => {
  assert.deepEqual(ladder({}), DEFAULT_LADDER)
  assert.deepEqual(DEFAULT_LADDER, ['claude-cli:claude-fable-5-1'])
  assert.deepEqual(ladder({ PLAN_LADDER: 'openai:llm_dsv4, claude-opus-5-5' }), ['openai:llm_dsv4', 'claude-opus-5-5'])
  assert.deepEqual(ladder({ PLAN_LADDER: 'off' }), [])
})

test('nextRung: the coop climbs to the first untried rung; Claude is the top; a gate refusal never climbs', () => {
  const rungs = ['openai:llm_dsv4', 'claude-cli:claude-fable-5-1']
  assert.equal(nextRung({ model: 'openai:llm_auto-big', rungs }), 'openai:llm_dsv4')
  assert.equal(nextRung({ model: 'openai:llm_dsv4', tried: ['openai:llm_auto-big', 'openai:llm_dsv4'], rungs }), 'claude-cli:claude-fable-5-1')
  assert.equal(nextRung({ model: 'ollama:qwen3:4b', rungs: DEFAULT_LADDER }), 'claude-cli:claude-fable-5-1')
  assert.equal(nextRung({ model: 'claude-cli:claude-fable-5-1', rungs }), null)
  assert.equal(nextRung({ model: 'claude-opus-5-5', rungs }), null)
  assert.equal(nextRung({ model: 'openai:llm_auto-big', error: Object.assign(new Error('no'), { status: 403 }), rungs }), null)
  assert.equal(nextRung({ model: 'openai:llm_auto-big', rungs: [] }), null)
})

test('failureKind reads the door\'s words', () => {
  assert.equal(failureKind(new Error('openai:llm_tiny holds about 2,000 tokens and this question is about 9,000')), 'window')
  assert.equal(failureKind(new Error('llm_auto-big gave no answer (length)')), 'length')
  assert.equal(failureKind(new Error('spent all 32,000 max_tokens reasoning')), 'length')
  assert.equal(failureKind(new Error('could not be reached: fetch failed (UND_ERR_HEADERS_TIMEOUT)')), 'timeout')
  assert.equal(failureKind(new Error('could not be reached: fetch failed (ECONNREFUSED)')), 'unreachable')
  assert.equal(failureKind(new Error('HTTP 500 upstream command exited prematurely')), 'server')
  assert.equal(failureKind(new Error('answered 404: {"error":{"message":"no router for requested model","code":"not_found"}}')), 'no such model')
  assert.equal(failureKind(new Error('odd')), 'other')
})

test('thenText and failureText: one line the coop can read', () => {
  assert.equal(thenText(null), 'nothing above it on the ladder: the run failed')
  assert.equal(thenText('claude-cli:claude-fable-5-1', { ok: true, ms: 94000 }), 'escalated to claude-fable-5-1, which answered in 1 min 34 s')
  assert.equal(thenText('claude-cli:claude-fable-5-1', { ok: false, kind: 'timeout' }), 'escalated to claude-fable-5-1, which failed too (timeout)')
  const line = failureText({ when: '2026-10-22 15:04', model: 'openai:llm_auto-big', run: 'Revise Plan (direction)', origin: 'agentic.private.fish', slug: 'federated-agent-plan', title: 'Federated Agent Plan', tokens: 22400, bytes: 81920, kind: 'length', ms: 345000, error: 'llm_auto-big gave no answer (length)', then: 'escalated to claude-fable-5-1, which answered in 94 s' })
  assert.equal(line, '2026-10-22 15:04 · openai:llm_auto-big · Revise Plan (direction) of [https://agentic.private.fish/view/federated-agent-plan Federated Agent Plan] on agentic.private.fish · about 22k tokens in (80 kB) · length after 5 min 45 s: llm_auto-big gave no answer (length) · escalated to claude-fable-5-1, which answered in 94 s.')
})

test('logFailures: always the jsonl; the page only for the coop, only when the site is on this farm; never throws', () => {
  const f = farm()
  const rec = { when: 'w', model: 'openai:llm_x', run: 'Talk it over', origin: 'toy.localhost', slug: 'toy-plan', title: 'Toy Plan', tokens: 1000, bytes: 2048, kind: 'timeout', ms: 1000, error: 'e', then: 't' }
  const none = logFailures({ status: f.status, records: [rec] })
  assert.ok(none.jsonl && !none.page)
  assert.match(none.why, /no site coop\.private\.fish on this farm/)
  fs.mkdirSync(path.join(f.root, 'coop.private.fish', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(f.root, 'coop.private.fish', 'status'), { recursive: true })
  fs.writeFileSync(path.join(f.root, 'coop.private.fish', 'status', 'sitemap.json'), '[]')
  const one = logFailures({ status: f.status, records: [rec, { ...rec, model: 'claude-cli:claude-fable-5-1' }] })
  assert.ok(one.page)
  const page = JSON.parse(fs.readFileSync(one.page, 'utf8'))
  assert.equal(page.story.length, 3) // opener, heading, the coop's one failure (Claude's is not the coop's)
  assert.ok(!fs.existsSync(path.join(f.root, 'coop.private.fish', 'status', 'sitemap.json')))
  logFailures({ status: f.status, records: [rec] })
  const again = JSON.parse(fs.readFileSync(one.page, 'utf8'))
  assert.deepEqual(again.journal.map(a => a.type), ['create', 'add', 'add'])
  assert.equal(again.journal[2].after, again.story[2].id)
  assert.equal(fs.readFileSync(one.jsonl, 'utf8').trim().split('\n').length, 4)
  assert.doesNotThrow(() => logFailures({ status: '/nonexistent/x/status', records: [rec] }))
})

test('ourSites and foreignOf: a fork from a site of the same owner on this farm is ours; another owner\'s is not', async () => {
  const { ourSites } = await import('../api/handlers.js')
  const { foreignOf } = await import('../src/client/core.js')
  const f = farm()
  const owner = { name: 'David Bovill', friend: { secret: 's1' } }
  for (const [site, o] of [['toy.localhost', owner], ['localhost', { friend: { secret: 's1' }, name: 'David Bovill' }], ['other.localhost', { name: 'Someone', friend: { secret: 's2' } }]]) {
    fs.mkdirSync(path.join(f.root, site, 'status'), { recursive: true })
    fs.writeFileSync(path.join(f.root, site, 'status', 'owner.json'), JSON.stringify(o))
  }
  const ours = ourSites(f.status)
  assert.deepEqual([...ours].sort(), ['localhost', 'toy.localhost'])
  // Gatekeeper Plan's journal: a seeded fork from localhost, then the create
  const seeded = { title: 'Gatekeeper Plan', story: [], journal: [{ type: 'fork', site: 'localhost', date: 1 }, { type: 'create', date: 2, item: { title: 'Gatekeeper Plan', story: [] } }] }
  assert.equal(foreignOf(seeded, 'toy.localhost', ours), null)
  assert.equal(foreignOf(seeded, 'toy.localhost'), 'forked from localhost')
  const theirs = { ...seeded, journal: [{ type: 'fork', site: 'other.localhost', date: 1 }] }
  assert.equal(foreignOf(theirs, 'toy.localhost', ours), 'forked from other.localhost')
  assert.equal(foreignOf({ ...seeded, journal: [{ type: 'fork', site: 'wiki.example.org', date: 1 }] }, 'toy.localhost', ours), 'forked from wiki.example.org')
})

test('onceEach: a reply kept many times by the 0.16.0–0.16.2 polling bug reads once; a repeated question stays', async () => {
  const { onceEach } = await import('../src/client/plan.js')
  const r = { role: 'model', text: 'The same reply.' }
  const q = { role: 'owner', text: 'Again?' }
  assert.deepEqual(onceEach([q, r, r, r, r]), [q, r])
  assert.deepEqual(onceEach([q, r, q, r]), [q, r, q, r])
  assert.deepEqual(onceEach([q, r, { role: 'model', text: 'Another.' }]).length, 3)
  assert.deepEqual(onceEach([]), [])
})

test('0.16.3: a farm without the log site hands its coop failures back for posting; postFailures sends them with the key', async () => {
  const { postFailures } = await import('../api/ladder.js')
  const f = farm()
  const rec = { when: 'w', model: 'openai:llm_auto-big', run: 'Talk it over', origin: 'demo.localhost', slug: 'toy-plan', title: 'Toy Plan', tokens: 9000, bytes: 30000, kind: 'server', ms: 27000, error: 'upstream command exited prematurely', then: 'escalated to claude-fable-5-1, which answered in 17 s' }
  const out = logFailures({ status: f.status, records: [rec, { ...rec, model: 'claude-cli:claude-fable-5-1' }] })
  assert.equal(out.page, null)
  assert.equal(out.remote.length, 1)
  assert.ok(out.remote[0].farm)
  // no key file: not posted, and says why
  process.env.PLAN_FAILURE_KEY_FILE = path.join(f.root, 'no-key-here')
  const none = await postFailures({ records: out.remote, fetchImpl: () => assert.fail('must not post without a key') })
  assert.match(none.why, /no key in .*no-key-here/)
  // with a key: posted to the site, the key in X-Api-Key
  fs.writeFileSync(path.join(f.root, 'key'), 'k3y\n')
  process.env.PLAN_FAILURE_KEY_FILE = path.join(f.root, 'key')
  let sent = null
  const ok = await postFailures({ records: out.remote, fetchImpl: async (url, o) => ((sent = { url, o }), new Response(JSON.stringify({ added: 1 }), { status: 200 })) })
  assert.equal(ok.posted, 1)
  assert.equal(sent.url, 'https://coop.private.fish/system/api/plan/log-failures.json')
  assert.equal(sent.o.headers['X-Api-Key'], 'k3y')
  assert.equal(JSON.parse(sent.o.body).records[0].model, 'openai:llm_auto-big')
  const refused = await postFailures({ records: out.remote, fetchImpl: async () => new Response(JSON.stringify({ error: 'no key' }), { status: 403 }) })
  assert.match(refused.why, /coop\.private\.fish answered 403: no key/)
  delete process.env.PLAN_FAILURE_KEY_FILE
})

test('0.16.3: logFailuresOp takes only the coop\'s failures, cut to size, and writes them with the farm they came from', async () => {
  const { logFailuresOp } = await import('../api/handlers.js')
  const root = scratch()
  const site = path.join(root, 'coop.private.fish')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  const rec = { when: '2026-10-22 16:27', model: 'openai:llm_auto-big', run: 'Talk it over', origin: 'demo.localhost', slug: 'talk-it-over-demo-plan', title: 'Talk It Over [Demo] Plan', tokens: 9000, bytes: 30000, kind: 'server', ms: 27000, error: 'x'.repeat(2000), then: 'escalated', farm: 'MacBook' }
  const out = await logFailuresOp({ records: [rec, { ...rec, model: 'claude-opus-5-5' }, { ...rec, slug: '../etc' }], origin: 'coop.private.fish', status: path.join(site, 'status') })
  assert.equal(out.added, 2)
  const page = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'coop-model-failures'), 'utf8'))
  const lines = page.story.slice(2).map(i => i.text)
  assert.match(lines[0], /^2026-10-22 16:27 · openai:llm_auto-big · Talk it over of \[http:\/\/demo\.localhost\/view\/talk-it-over-demo-plan Talk It Over Demo Plan\] on demo\.localhost \(MacBook farm\) · /)
  assert.ok(lines[0].length < 1000)
  assert.match(lines[1], /view\/unknown /)
  await assert.rejects(logFailuresOp({ records: [{ ...rec, model: 'claude-opus-5-5' }], origin: 'coop.private.fish', status: path.join(site, 'status') }), e => e.status === 400)
})
