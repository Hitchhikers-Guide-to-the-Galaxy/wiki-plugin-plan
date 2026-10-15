// Phase 4 — Do Next Phase and Revise Plan: the SKILLS line, the phase, the
// ghost page's items, proposed ticks, where the link goes, the content the
// door is given, the WIP heartbeat, and the handlers end to end on a
// throwaway farm with a stand-in `claude` behind the real shared door.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parse, face, skillsOf, phasesOf, choosePhase, reportTitle, splitMarkdown, reportItems, proposedTicks, linkAfter, addAction } from '../src/client/core.js'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-agent-'))
process.env.WIKI_WIP_DIR = scratch()
const { claim, release, heartbeat } = await import('../api/wip.js')
const { buildContent } = await import('../api/prompt.js')
const { next, revise, job } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const toy = (skills = 'SKILLS fedwiki-plan, toy-skill, ../etc') => ({
  title: 'Toy Plan',
  story: [
    md('a', 'Opening, linking [[Toy Tool]] and [[Not Here]].'),
    { type: 'plan', id: 'p', text: skills },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [x] Write the page'),
    md('c2', '- [x] Link the page'),
    md('h2', '# Phase 2\n> Then build.'),
    md('c3', '- [ ] Build the thing'),
    md('n2', 'A note between checkpoints.'),
    md('c4', '- [ ] Show the thing on a demo page'),
    md('h3', '# Open Questions\n> Each a red link.'),
    md('q1', '- [x] [[Is it answered?]] has a page'),
    md('q2', '- [ ] [[Is it open?]] has none'),
    md('h4', '# See\n\n- [[Toy Tool]]'),
    md('s2', '- [[Toy Notes]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: [] } }],
})

test('SKILLS: a plan item command, comma or space separated, lines add up; the face is unchanged', () => {
  assert.deepEqual(parse('SKILLS fedwiki-plan, fedwiki-page').skills, ['fedwiki-plan', 'fedwiki-page'])
  assert.deepEqual(parse('SKILLS: a b\nSKILLS b, c').skills, ['a', 'b', 'c'])
  assert.equal(parse('SKILLS a').commands, 1)
  assert.equal(parse('SKILLS a').caption, '')
  assert.equal(face(parse('SKILLS fedwiki-plan'), { ownTitle: 'Toy Plan' }), 'status')
  assert.deepEqual(parse('').skills, [])
})

test('skillsOf: fedwiki-plan first, then the named, once each; a name that could climb is refused', () => {
  assert.deepEqual(skillsOf(toy()), { skills: ['fedwiki-plan', 'toy-skill'], refused: ['../etc'] })
  assert.deepEqual(skillsOf(toy('')), { skills: ['fedwiki-plan'], refused: [] })
})

test('phasesOf and choosePhase: the next by default, by number or heading, null when none', () => {
  const ph = phasesOf(toy())
  assert.deepEqual(ph.map(p => [p.label, p.done, p.total, p.lastItemId, p.strap]), [
    ['Phase 1', 2, 2, 'c2', 'Begin.'],
    ['Phase 2', 0, 2, 'c4', 'Then build.'],
  ])
  assert.deepEqual(ph[1].checkpoints.map(c => c.text), ['Build the thing', 'Show the thing on a demo page'])
  assert.equal(choosePhase(toy()).label, 'Phase 2')
  assert.equal(choosePhase(toy(), 1).label, 'Phase 1')
  assert.equal(choosePhase(toy(), '2').label, 'Phase 2')
  assert.equal(choosePhase(toy(), 'Phase 1').label, 'Phase 1')
  assert.equal(choosePhase(toy(), 7), null)
  const done = toy()
  for (const it of done.story) if (/^- \[ \] [A-Z][a-z]/.test(it.text) && !it.text.includes('[[')) it.text = it.text.replace('[ ]', '[x]')
  assert.equal(choosePhase(done), null)
})

test('reportTitle: a phase report; a revision has the plan\'s own title', () => {
  assert.equal(reportTitle({ kind: 'next', planTitle: 'Toy Plan', phaseLabel: 'Phase 2' }), 'Toy Plan Phase 2 Report')
  assert.equal(reportTitle({ kind: 'revise', planTitle: 'Toy Plan', date: '2026-10-10' }), 'Toy Plan')
})

const REPORT = [
  'Phase 2 builds the thing and shows it.',
  '',
  '# Build the thing',
  '> The work itself.',
  '',
  '- Do: build it.',
  '- Verify: run it.',
  '- Evidence: not yet.',
  '',
  '# Proposed Ticks',
  '> Proposals only; nothing has been ticked.',
  '',
  '- Show the thing on a demo page',
].join('\n')

test('splitMarkdown and reportItems: each point its own item, heading and strap together, provenance first, See last', () => {
  assert.deepEqual(splitMarkdown(REPORT), [
    'Phase 2 builds the thing and shows it.',
    '# Build the thing\n> The work itself.',
    '- Do: build it.',
    '- Verify: run it.',
    '- Evidence: not yet.',
    '# Proposed Ticks\n> Proposals only; nothing has been ticked.',
    '- Show the thing on a demo page',
  ])
  let n = 0
  const items = reportItems({ kind: 'next', markdown: REPORT, planTitle: 'Toy Plan', phaseLabel: 'Phase 2', model: 'claude-cli:claude-opus-5-5', date: '2026-10-10', id: () => `i${n++}` })
  assert.equal(items.length, 9)
  assert.ok(items.every(i => i.type === 'markdown' && i.id))
  assert.equal(items[0].text, "Written by claude-opus-5-5 through the [[Plan Tool]]'s Do Next Phase for Phase 2 on [[Toy Plan]], 2026-10-10. Its proposed ticks are proposals: nothing on the plan was ticked.")
  assert.equal(items.at(-1).text, '# See\n\n- [[Toy Plan]]')
  const loose = reportItems({ kind: 'next', markdown: 'Sum.\n\n# Heading\n\n> Strap.\n\n- Do: x.', planTitle: 'Toy Plan', phaseLabel: 'Phase 2' })
  assert.deepEqual(loose.slice(1, -1).map(i => i.text), ['Sum.', '# Heading\n> Strap.', '- Do: x.'])
  const rev = reportItems({ kind: 'revise', markdown: 'x', planTitle: 'Toy Plan', date: '2026-10-10' })
  assert.match(rev[0].text, /Revise Plan on \[\[Toy Plan\]\].*the plan itself was not changed/)
})

test('proposedTicks: matched back to checkpoints by their words; none; missing', () => {
  const cps = phasesOf(toy())[1].checkpoints
  const t = proposedTicks(REPORT, cps)
  assert.equal(t.found, true)
  assert.equal(t.none, false)
  assert.deepEqual(t.listed, ['Show the thing on a demo page'])
  assert.deepEqual(t.matched.map(c => c.id), ['c4'])
  assert.deepEqual(proposedTicks('x\n\n# Proposed Ticks\n> p.\n\n- none', cps), { found: true, listed: [], matched: [], none: true })
  assert.equal(proposedTicks('no section', cps).found, false)
})

test('linkAfter: a report after its phase\'s last checkpoint item, a revision at the end of See', () => {
  assert.equal(linkAfter(toy(), { kind: 'next', phase: 2 }), 'c4')
  assert.equal(linkAfter(toy(), { kind: 'next', phase: 'Phase 1' }), 'c2')
  assert.equal(linkAfter(toy(), { kind: 'revise' }), 's2')
  const noSee = toy()
  noSee.story = noSee.story.slice(0, 12)
  assert.equal(linkAfter(noSee, { kind: 'revise' }), 'q2')
  assert.equal(linkAfter({ story: [] }, { kind: 'revise' }), null)
  assert.deepEqual(addAction({ type: 'markdown', id: 'x', text: '[[R]]' }, 'c4', 5), { type: 'add', id: 'x', item: { type: 'markdown', id: 'x', text: '[[R]]' }, after: 'c4', date: 5 })
})

// A throwaway farm: one site with the plan, an answer page, a linked page.
const farm = () => {
  const root = scratch()
  const site = path.join(root, 'toy.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  const put = (slug, page) => fs.writeFileSync(path.join(site, 'pages', slug), JSON.stringify(page))
  put('toy-plan', toy())
  put('is-it-answered', { title: 'Is it answered?', story: [md('x', 'Yes: build it in the farm.')], journal: [] })
  put('toy-tool', { title: 'Toy Tool', story: [md('y', 'The tool the plan builds.')], journal: [] })
  const skills = path.join(root, 'skills')
  fs.mkdirSync(path.join(skills, 'fedwiki-plan'), { recursive: true })
  fs.writeFileSync(path.join(skills, 'fedwiki-plan', 'SKILL.md'), '# fedwiki-plan\nCheckpoints are task lines.\n')
  return { root, site, status: path.join(site, 'status'), skills }
}

test('buildContent: plan, phase marked out, skills (a missing one noted), answer pages first', () => {
  const f = farm()
  const page = JSON.parse(fs.readFileSync(path.join(f.site, 'pages', 'toy-plan'), 'utf8'))
  const { content, account } = buildContent({ kind: 'next', page, phase: choosePhase(page), origin: 'toy.localhost', siteDir: f.site, skillsFrom: f.skills })
  assert.deepEqual(account.skills, ['fedwiki-plan'])
  assert.deepEqual(account.skipped.map(s => s.name), ['../etc', 'toy-skill'])
  assert.deepEqual(account.pages.map(p => [p.title, p.role]), [['Is it answered?', 'answer'], ['Toy Tool', 'linked']])
  assert.ok(content.includes('<plan title="Toy Plan" site="toy.localhost">\n# Toy Plan'))
  assert.ok(content.includes('<phase heading="Phase 2" checkpoints="2" ticked="0">\n# Phase 2\n> Then build.\n\n1. - [ ] Build the thing\n2. - [ ] Show the thing on a demo page\n</phase>'))
  assert.ok(content.includes('<skill name="fedwiki-plan">\n# fedwiki-plan'))
  assert.match(content, /Skills named but not loaded: \.\.\/etc \(not a skill folder name\); toy-skill \(no /)
  assert.ok(content.indexOf('Is it answered?"') < content.indexOf('Toy Tool"'))
  assert.match(content, /# Proposed Ticks/)
  const rev = buildContent({ kind: 'revise', page, origin: 'toy.localhost', siteDir: f.site, skillsFrom: f.skills })
  assert.ok(!rev.content.includes('<phase '))
  assert.match(rev.content, /# What Changed/)
})

test('heartbeat: refreshes the owner file and the marker; a wrong token is refused', async () => {
  const c = claim({ session: 'test heartbeat' })
  const marker = path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json')
  const before = JSON.parse(fs.readFileSync(marker, 'utf8')).heartbeat
  await new Promise(r => setTimeout(r, 1100))
  const at = heartbeat(c.token)
  assert.notEqual(at, before)
  assert.equal(JSON.parse(fs.readFileSync(marker, 'utf8')).heartbeat, at)
  assert.throws(() => heartbeat('nope'), /wrong WIP token/)
  release(c.token)
  assert.throws(() => heartbeat(c.token), /no WIP lock held/)
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

test('next: claims the WIP with the run named, answers a job, the job finishes with the report; released after', async () => {
  const f = farm()
  process.env.PLAN_SKILLS_DIR = f.skills
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(f.root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = standIn(f.root, REPORT)
  delete process.env.CLAUDE_DOOR_MODEL
  delete process.env.AUDIONOTE_SUMMARY_MODEL
  const ctx = { origin: 'toy.localhost', status: f.status, farmRoot: f.root }
  const started = await next({ slug: 'toy-plan', ...ctx })
  assert.match(started.job, /^[a-f0-9]{16}$/)
  assert.equal(started.status, 'running')
  assert.equal(started.reportTitle, 'Toy Plan Phase 2 Report')
  assert.equal(started.model, 'claude-opus-5-5')
  const markerFile = path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json')
  const during = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
  assert.equal(during.status, 'IN_PROGRESS')
  assert.equal(during.session, 'Plan Tool: Do Next Phase toy.localhost/toy-plan phase 2')
  assert.deepEqual(during.scope, ['toy.localhost/toy-plan'])

  // A second run while the first holds the marker: 409 naming the holder.
  await assert.rejects(revise({ slug: 'toy-plan', ...ctx }), e => e.status === 409 && /Do Next Phase toy\.localhost\/toy-plan phase 2/.test(e.message))

  const running = await job({ id: started.job, ...ctx })
  assert.equal(running.status, 'running')
  assert.ok(!('token' in running))
  const done = await until(async () => {
    const j = await job({ id: started.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.equal(done.result.markdown, REPORT.trim())
  assert.equal(done.result.model, 'claude-cli:claude-opus-5-5')
  assert.deepEqual(done.result.proposedTicks.matched, ['Show the thing on a demo page'])
  assert.ok(done.finished >= done.started)
  assert.deepEqual(done.context.skills, ['fedwiki-plan'])
  const after = JSON.parse(fs.readFileSync(markerFile, 'utf8'))
  assert.equal(after.status, 'DONE')
  assert.ok(!fs.existsSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.lock')))
  assert.ok(done.wip.released)
  const asked = fs.readFileSync(path.join(f.root, 'asked.txt'), 'utf8')
  assert.ok(asked.includes('<phase heading="Phase 2"'))
  // Nothing was written to the plan.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.site, 'pages', 'toy-plan'), 'utf8')), toy())
  // The job is on disk too.
  const disk = JSON.parse(fs.readFileSync(path.join(f.status, 'farm-tmp', 'plan-jobs', `${started.job}.json`), 'utf8'))
  assert.equal(disk.status, 'done')
  // Another site does not see it.
  await assert.rejects(job({ id: started.job, origin: 'other.localhost', status: f.status }), e => e.status === 404)
})

test('revise, a failing door, refusals before any claim, and a job orphaned on disk', async () => {
  const f = farm()
  process.env.PLAN_SKILLS_DIR = f.skills
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(f.root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = path.join(f.root, 'no-such-claude')
  const ctx = { origin: 'toy.localhost', status: f.status, farmRoot: f.root }
  const r = await revise({ slug: 'toy-plan', ...ctx })
  assert.equal(r.reportTitle, 'Toy Plan')
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json'), 'utf8')).session, 'Plan Tool: Revise Plan toy.localhost/toy-plan')
  const failed = await until(async () => {
    const j = await job({ id: r.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(failed.status, 'failed')
  assert.match(failed.error, /the claude CLI could not be started/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.WIKI_WIP_DIR, 'AGENT-WIP.json'), 'utf8')).status, 'DONE')

  await assert.rejects(next({ slug: '../x', ...ctx }), e => e.status === 400)
  await assert.rejects(next({ slug: 'is-it-answered', ...ctx }), e => e.status === 400 && /is not a plan/.test(e.message))
  await assert.rejects(next({ slug: 'no-page', ...ctx }), e => e.status === 404)
  await assert.rejects(next({ slug: 'toy-plan', phase: 9, ...ctx }), e => e.status === 400 && /no phase 9/.test(e.message))
  await assert.rejects(job({ id: 'nope', ...ctx }), e => e.status === 400)

  const orphan = 'abcdef0123456789'
  fs.writeFileSync(path.join(f.status, 'farm-tmp', 'plan-jobs', `${orphan}.json`), JSON.stringify({ id: orphan, origin: 'toy.localhost', status: 'running', started: 1 }))
  const o = await job({ id: orphan, ...ctx })
  assert.equal(o.status, 'failed')
  assert.match(o.error, /has gone/)
})
