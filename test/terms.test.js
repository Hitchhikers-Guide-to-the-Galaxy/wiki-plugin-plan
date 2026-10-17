// 0.5.0 — STATUS, the plan item's default text, and Create Red Links (named
// Red-link in 0.5.0): the terms the
// door names linked on a ghost with the plan's title, never in the Open
// Questions, headings, code, other item types or existing links; saved over
// the plan as a revision, end to end on a throwaway farm with a stand-in
// `claude` behind the real shared door.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parse, face, DEFAULT_TEXT, parseTerms, linkTerms, termsEligible, termLinkItems, revisedStory, writeRevision, lastRevision, storyAt, reportTitle } from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-redlink-'))
process.env.WIKI_WIP_DIR = scratch()
const { buildTermsContent, termsText } = await import('../api/prompt.js')
const { linkTerms: linkTermsOp, saveRevision, job } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const QUESTIONS = '- [ ] [[Which Webhook relay?]] the Webhook or the poller'
const plan = () => ({
  title: 'Hook Plan',
  story: [
    md('a', 'Wire the Matrix bridge to the Webhook relay on the Pi5, through Caddy. The Webhook relay posts to ntfy.'),
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1 Webhook\n> Stand up the Webhook relay.'),
    md('c1', '- [ ] Install Caddy and the `Webhook` binary from https://example.org/Webhook'),
    md('c2', '- [ ] Point the [[Matrix bridge]] at Caddy, see [Webhook docs](https://example.org/Webhook)'),
    md('f', '```\nWebhook --port 9000\n```\nThen Synapse answers.'),
    { type: 'code', id: 'k', text: 'Webhook relay Synapse' },
    { type: 'terminal', id: 't', text: 'ssh pi5 Webhook' },
    { type: 'paragraph', id: 'g', text: 'Synapse paragraph.' },
    md('q', '# Open Questions\n> Made by hand.'),
    md('q1', QUESTIONS),
    md('q2', '- [ ] [[Does Synapse need a restart?]] after Caddy'),
    md('s', '# See\n\n- [[Matrix bridge]]'),
    md('s2', '- Synapse notes'),
  ],
  journal: [],
})
const journaled = () => {
  const p = plan()
  p.journal = [{ type: 'create', date: 1, item: { title: p.title, story: p.story.map(i => ({ ...i })) } }]
  return p
}

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

test('termsEligible: markdown items outside Open Questions, Assets, See; no headings, no other types', () => {
  assert.deepEqual([...termsEligible(plan())], ['a', 'c1', 'c2', 'f'])
})

test('parseTerms: one per bullet, glosses, marks and duplicates dropped, none is nothing', () => {
  assert.deepEqual(parseTerms('- Webhook relay\n- **Caddy** — the web server\n* `Synapse`: the homeserver\n1. [[Pi5]]\n- caddy\n- none\nNot a bullet'), ['Webhook relay', 'Caddy', 'Synapse', 'Pi5'])
  assert.deepEqual(parseTerms('- none'), [])
  assert.deepEqual(parseTerms('- a [b] c\n- x|y'), [])
})

test('linkTerms: first plain mention only, longest first, never the protected places', () => {
  const page = plan()
  const r = linkTerms(page, ['Webhook', 'Webhook relay', 'Caddy', 'Synapse', 'Matrix bridge', 'Hook Plan', 'ntfy', 'Poller'])
  const by = Object.fromEntries(r.story.map(i => [i.id, i.text]))
  // The opener: the longer term took its words first; Webhook alone never
  // splits a mention of the longer term, and finds no free mention of its own.
  assert.equal(by.a, 'Wire the Matrix bridge to the [[Webhook relay]] on the Pi5, through [[Caddy]]. The Webhook relay posts to [[ntfy]].')
  // Webhook: inline code, a url, a [text](url) link and a fence are protected.
  assert.equal(by.c1, '- [ ] Install Caddy and the `Webhook` binary from https://example.org/Webhook')
  assert.equal(by.c2, '- [ ] Point the [[Matrix bridge]] at Caddy, see [Webhook docs](https://example.org/Webhook)')
  assert.equal(by.f, '```\nWebhook --port 9000\n```\nThen [[Synapse]] answers.')
  // Untouched: headings, code, terminal, paragraph, plan, Open Questions, See.
  const before = Object.fromEntries(plan().story.map(i => [i.id, i.text]))
  for (const id of ['p', 'h1', 'k', 't', 'g', 'q', 'q1', 'q2', 's', 's2']) assert.equal(by[id], before[id], id)
  assert.deepEqual(r.linked.map(x => [x.term, x.id]), [['Webhook relay', 'a'], ['Caddy', 'a'], ['ntfy', 'a'], ['Synapse', 'f']])
  const why = Object.fromEntries(r.skipped.map(x => [x.term, x.why]))
  assert.match(why['Matrix bridge'], /already linked/)
  assert.match(why['Hook Plan'], /own title/)
  assert.match(why.Webhook, /no plain mention/)
  assert.match(why.Poller, /no plain mention/)
  // The page itself is not changed.
  assert.deepEqual(page, plan())
})

test('linkTerms: case-insensitive only when no exact mention; the text keeps its own case', () => {
  const page = { title: 'X Plan', story: [md('a', 'the claude door, then the Claude Door again.')] }
  assert.equal(linkTerms(page, ['Claude Door']).story[0].text, 'the claude door, then the [[Claude Door]] again.')
  assert.equal(linkTerms(page, ['CLAUDE DOOR']).story[0].text, 'the [[claude door]], then the Claude Door again.')
  assert.equal(linkTerms(page, ['door']).story[0].text, 'the claude [[door]], then the Claude Door again.')
  assert.equal(linkTerms(page, ['laude']).linked.length, 0, 'whole words only')
})

test('linkTerms: a question link outside the Open Questions section is still left alone', () => {
  const page = { title: 'X Plan', story: [md('a', '- [ ] [[Is Caddy needed?]] Caddy or not'), md('b', 'Caddy fronts it.')] }
  const r = linkTerms(page, ['Caddy'])
  assert.equal(r.story[0].text, page.story[0].text)
  assert.equal(r.story[1].text, '[[Caddy]] fronts it.')
})

test('termLinkItems: the line first, then the plan; revisedStory drops the line', () => {
  let n = 0
  const r = termLinkItems({ page: plan(), markdown: '- Webhook relay\n- Synapse\n- Poller', model: 'claude-cli:claude-opus-5-5', date: '2026-10-17', id: () => `g${n++}` })
  assert.match(r.items[0].text, /^Proposed links on \[\[Hook Plan\]\] through the \[\[Plan Tool\]\]'s Create Red Links by claude-opus-5-5, 2026-10-17: 2 terms linked \(Webhook relay, Synapse\)\./)
  assert.equal(r.items.length, plan().story.length + 1)
  assert.deepEqual(revisedStory(r.items).map(i => i.id), plan().story.map(i => i.id))
  assert.equal(r.items[2].type, 'plan')
  assert.deepEqual(r.skipped.map(x => x.term), ['Poller'])
})

test('writeRevision kind terms: edit entries for the linked items only, rewindable, named on the status line', () => {
  const page = journaled()
  const r = termLinkItems({ page, markdown: '- Caddy\n- Synapse', id: () => 'g' })
  const w = writeRevision(page, revisedStory(r.items), { model: 'claude-cli:claude-opus-5-5', kind: 'terms', date: 5 })
  assert.equal(w.changed, true)
  assert.deepEqual(w.actions.map(a => [a.type, a.id]), [['edit', 'a'], ['edit', 'f']])
  assert.match(w.actions[0].provenance, /^Linked through the Plan Tool's Create Red Links by claude-opus-5-5/)
  assert.deepEqual(storyAt(w.page, w.previous), page.story)
  assert.deepEqual(lastRevision(w.page), { kind: 'terms', previous: 0, model: 'claude-opus-5-5', date: 5 })
  assert.throws(() => writeRevision(page, page.story, { kind: 'rewrite' }), /not a kind of revision/)
})

test('buildTermsContent: only the linkable text goes to the door', () => {
  const { content, account } = buildTermsContent({ page: plan(), origin: 'hooks.localhost' })
  assert.equal(termsText(plan()).split('\n\n').length, 4)
  assert.ok(content.includes('Wire the Matrix bridge'))
  for (const hidden of ['Which Webhook relay?', 'Does Synapse need a restart?', 'ssh pi5', 'Synapse paragraph', '# Phase 1', 'Synapse notes', 'STATUS']) assert.ok(!content.includes(hidden), hidden)
  assert.match(content, /- Term/)
  assert.equal(account.bytes, Buffer.byteLength(content))
})

// A stand-in claude behind the real door: waits a moment, then answers.
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

test('linkTerms and saveRevision on a farm: a job of terms, then the plan written with Open Questions untouched', async () => {
  const root = scratch()
  const site = path.join(root, 'hooks.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  const page = journaled()
  fs.writeFileSync(path.join(site, 'pages', 'hook-plan'), JSON.stringify(page, null, 2))
  const ctx = { origin: 'hooks.localhost', status: path.join(site, 'status'), farmRoot: root }
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = standIn(root, '- Webhook relay\n- Synapse\n- Which Webhook relay\n')
  delete process.env.CLAUDE_DOOR_MODEL

  await assert.rejects(linkTermsOp({ slug: '../x', ...ctx }), e => e.status === 400)
  const started = await linkTermsOp({ slug: 'hook-plan', ...ctx })
  assert.equal(started.kind, 'terms')
  assert.equal(started.reportTitle, 'Hook Plan')
  const done = await until(async () => {
    const j = await job({ id: started.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.deepEqual(done.result.terms, ['Webhook relay', 'Synapse', 'Which Webhook relay'])
  assert.ok(!fs.readFileSync(path.join(root, 'asked.txt'), 'utf8').includes('Which Webhook relay?'), 'the questions never went to the door')
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'pages', 'hook-plan'), 'utf8')).journal.length, 1, 'the job wrote nothing')

  const ghost = termLinkItems({ page, markdown: done.result.markdown, model: done.result.model }).items
  await assert.rejects(saveRevision({ slug: 'hook-plan', story: ghost, kind: 'bogus', ...ctx }), e => e.status === 400 && /not a kind/.test(e.message))
  const r = await saveRevision({ slug: 'hook-plan', story: ghost, model: done.result.model, kind: 'terms', ...ctx })
  assert.equal(r.written, true)
  const saved = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'hook-plan'), 'utf8'))
  const text = Object.fromEntries(saved.story.map(i => [i.id, i.text]))
  assert.match(text.a, /\[\[Webhook relay\]\]/)
  assert.match(text.f, /\[\[Synapse\]\]/)
  assert.equal(text.q1, QUESTIONS, 'the hand-made question link is untouched')
  assert.equal(saved.story[1].type, 'plan')
  assert.equal(saved.journal.at(-1).planTool.kind, 'terms')
  assert.deepEqual(storyAt(saved, r.previous.rev), page.story)
})
