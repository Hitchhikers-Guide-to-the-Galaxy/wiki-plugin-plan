// 0.9.0 — Do Next Phase places the plan's Terminal Button: its text, shell
// safety, and where it goes (add, edit, move, or nothing to do).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { phaseButtonText, findPhaseButton, buttonPlacement, buttonSession, choosePhase, reportTitle } from '../src/client/core.js'

const md = (id, text) => ({ type: 'markdown', id, text })
const plan = (extra = []) => ({
  title: "Bob's Toy Plan",
  story: [
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [x] Write the page'),
    md('h2', '# Phase 2\n> Then build.'),
    md('c2', '- [ ] Build the thing'),
    md('c3', '- [ ] Show it on a demo page'),
    ...extra,
    md('h3', '# Open Questions\n> Each a red link.'),
    md('q1', '- [ ] [[Is it open?]] has none'),
  ],
})
const textFor = page => {
  const phase = choosePhase(page)
  return { phase, text: phaseButtonText({ title: page.title, slug: 'bobs-toy-plan', base: 'https://toy.private.fish', phase, reportTitle: reportTitle({ kind: 'next', planTitle: page.title, phaseLabel: phase.label }) }) }
}

test('phaseButtonText: a BUTTON: show item for the next phase, its session, boot and guard, one shell-safe brief', () => {
  const { text } = textFor(plan())
  const lines = text.split('\n')
  assert.deepEqual(lines.slice(0, 6), ['BUTTON: show', 'LABEL: Do Phase 2', 'SESSION: bobs-toy-plan-phase-2', 'BOOT: cd ~ && claude', 'GUARD: claude auth status', 'GUARDLABEL: Sign in to Claude first'])
  assert.equal(lines.length, 7)
  const brief = lines[6]
  assert.ok(brief.startsWith('Do Phase 2 of the Bobs Toy Plan, https://toy.private.fish/view/bobs-toy-plan. '))
  assert.match(brief, /for real/)
  assert.match(brief, /Ask me before any DNS change/)
  assert.match(brief, /write the page Bobs Toy Plan Phase 2 Report/)
  assert.match(brief, /moving button rule/)
  assert.ok(!/['"`$\\]/.test(brief), 'no quote, backtick, dollar or backslash')
  assert.equal(buttonSession('x-plan'), 'x-plan-agent')
})

test('buttonPlacement: add after the last checkpoint; nothing when in place; edit and move when it is a phase behind', () => {
  const p = plan()
  const { phase, text } = textFor(p)
  assert.deepEqual(buttonPlacement(p, phase, text), { add: true, edit: false, move: false, after: 'c3', existing: null })

  const placed = plan([{ type: 'terminal', id: 'b', text }])
  assert.equal(findPhaseButton(placed).index, 5)
  const same = buttonPlacement(placed, choosePhase(placed), text)
  assert.equal(same.add || same.edit || same.move, false)

  const old = { type: 'terminal', id: 'b', text: text.replace(/Phase 2/g, 'Phase 1') }
  const behind = { ...p, story: [p.story[0], p.story[1], old, ...p.story.slice(2)] }
  const w = buttonPlacement(behind, choosePhase(behind), text)
  assert.deepEqual([w.add, w.edit, w.move, w.after, w.existing.id], [false, true, true, 'c3', 'b'])

  // A plain terminal item, or a button not labelled Do …, is not the plan's button.
  assert.equal(findPhaseButton(plan([{ type: 'terminal', id: 't', text: 'RUN\nls' }, { type: 'terminal', id: 'u', text: 'BUTTON\nLABEL: Kill it\nx' }])), null)
})

// 0.14.0: a fresh Claude Code session per phase unless the plan says CONTEXT carry.
import { planContext, parse, phasesOf } from '../src/client/core.js'

test('buttonSession: fresh per phase by default, the shared session when the plan carries context', () => {
  const phase = { label: 'Phase 2', number: 2 }
  assert.equal(buttonSession('x-plan', phase), 'x-plan-phase-2')
  assert.equal(buttonSession('x-plan', phase, { carry: true }), 'x-plan-agent')
  assert.equal(parse('STATUS\nCONTEXT carry').context, 'carry')
  assert.equal(parse('STATUS').context, 'fresh')
  assert.equal(planContext({ story: [{ type: 'plan', id: 'p', text: 'STATUS\nCONTEXT carry' }] }), 'carry')
  assert.equal(planContext({ story: [{ type: 'plan', id: 'p', text: 'STATUS' }] }), 'fresh')
})

test('phaseButtonText: a fresh session reads the previous report and names the next session; carry keeps one', () => {
  const page = { title: 'Toy Plan', story: [md('h1', '# Phase 1\n> a.'), md('c1', '- [x] one'), md('h2', '# Phase 2\n> b.'), md('c2', '- [ ] two'), md('h3', '# Phase 3\n> c.'), md('c3', '- [ ] three')] }
  const phase = choosePhase(page)
  const [, next] = phasesOf(page).filter(p => p.number >= 2)
  const fresh = phaseButtonText({ title: page.title, slug: 'toy-plan', base: 'https://t.x', phase, reportTitle: 'Toy Plan Phase 2 Report', previousReport: 'Toy Plan Phase 1 Report', nextPhase: next })
  const lines = fresh.split('\n')
  assert.equal(lines[2], 'SESSION: toy-plan-phase-2')
  assert.match(lines[6], /This is a fresh session for this phase/)
  assert.match(lines[6], /then Toy Plan Phase 1 Report if it exists/)
  assert.match(lines[6], /with SESSION toy-plan-phase-3 so the next phase starts fresh/)
  assert.ok(!/['"`$\\]/.test(lines[6]))
  const carried = phaseButtonText({ title: page.title, slug: 'toy-plan', base: 'https://t.x', phase, reportTitle: 'R', carry: true, nextPhase: next }).split('\n')
  assert.equal(carried[2], 'SESSION: toy-plan-agent')
  assert.ok(!/fresh session/.test(carried[6]))
  assert.match(carried[6], /keeping SESSION toy-plan-agent since the plan carries context/)
})

import { planRunner } from '../src/client/core.js'

test('RUNNER on the status item: the button boots the runner in its own checkout, signed-grant ready, with no typed brief', () => {
  assert.equal(parse('STATUS\nRUNNER plan-run').runner, 'plan-run')
  assert.equal(parse('STATUS\nRUNNER rm -rf ~').runner, 'rm')
  assert.equal(parse('STATUS\nRUNNER $(curl x)').runner, null)
  assert.equal(parse('STATUS\nRUNNER ../bin/x').runner, null)
  assert.equal(planRunner({ story: [{ type: 'plan', id: 'p', text: 'STATUS\nRUNNER plan-run' }] }), 'plan-run')
  assert.equal(planRunner({ story: [{ type: 'plan', id: 'p', text: 'STATUS' }] }), null)
  const p = plan()
  const phase = choosePhase(p)
  const text = phaseButtonText({ title: p.title, slug: 'bobs-toy-plan', base: 'http://intake.localhost:4242', phase, reportTitle: 'R', runner: 'plan-run' })
  assert.deepEqual(text.split('\n'), ['BUTTON: show', 'LABEL: Do Phase 2', 'SESSION: bobs-toy-plan-phase-2', 'BOOT: plan-run intake.localhost bobs-toy-plan "Phase 2"'])
  assert.ok(!/cd ~/.test(text))
  // an unsafe runner name falls back to the watched session
  assert.match(phaseButtonText({ title: p.title, slug: 'bobs-toy-plan', base: 'https://t.x', phase, reportTitle: 'R', runner: 'a;b' }), /BOOT: cd ~ && claude/)
})

import { advanceButton } from '../src/client/core.js'

// 0.15.2 — Update Plan moves the button on when its phase was ticked by something else.
const threePhases = ({ button, ticks = ['x', 'x', ' ', ' '], status = 'STATUS' }) => ({
  title: 'Toy Plan',
  story: [
    { type: 'plan', id: 'p', text: status },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', `- [${ticks[0]}] One`),
    md('c2', `- [${ticks[1]}] Two`),
    ...(button ? [button] : []),
    md('h2', '# Phase 2\n> Then.'),
    md('c3', `- [${ticks[2]}] Three`),
    md('h3', '# Phase 3\n> Last.'),
    md('c4', `- [${ticks[3]}] Four`),
    md('hq', '# Open Questions'),
    md('q1', '- [ ] [[Is it open?]]'),
  ],
  journal: [{ type: 'create', item: { title: 'Toy Plan', story: [] }, date: 1 }],
})
const phase1Button = base => {
  const p = threePhases({})
  const text = phaseButtonText({ title: 'Toy Plan', slug: 'toy-plan', base, phase: choosePhase(threePhases({ ticks: [' ', ' ', ' ', ' '] })), reportTitle: 'Toy Plan Phase 1 Report' })
  return { type: 'terminal', id: 'b', text }
}

test('advanceButton: a button left on a finished phase moves to the next open phase and is rewritten for it', () => {
  const page = threePhases({ button: phase1Button('https://toy.private.fish') })
  const r = advanceButton(page, { origin: 'toy.private.fish', slug: 'toy-plan', now: () => 7 })
  assert.deepEqual(r.moved, { id: 'b', from: 'Phase 1', to: 'Phase 2', moved: true, rewritten: true, unsigned: false })
  const ids = r.page.story.map(i => i.id)
  assert.equal(ids.indexOf('b'), ids.indexOf('c3') + 1)
  const b = r.page.story.find(i => i.id === 'b')
  assert.match(b.text, /LABEL: Do Phase 2/)
  assert.match(b.text, /Do Phase 2 of the Toy Plan, https:\/\/toy\.private\.fish\/view\/toy-plan\./)
  assert.deepEqual(r.page.journal.slice(1).map(e => e.type), ['move', 'edit'])
  assert.deepEqual(r.page.journal[1].order, ids)
  assert.equal(page.story.findIndex(i => i.id === 'b'), 4, 'the page given is untouched')
})

test('advanceButton: forward only, and never where the button is still wanted', () => {
  // its phase still has an unticked checkpoint
  assert.equal(advanceButton(threePhases({ button: phase1Button('https://t.x'), ticks: ['x', ' ', ' ', ' '] }), { slug: 'toy-plan' }).moved, null)
  // no button: Update Plan does not add one
  assert.equal(advanceButton(threePhases({}), { slug: 'toy-plan' }).moved, null)
  // every checkpoint ticked: nowhere to go
  assert.equal(advanceButton(threePhases({ button: phase1Button('https://t.x'), ticks: ['x', 'x', 'x', 'x'] }), { slug: 'toy-plan' }).moved, null)
  // a button after Phase 3's checkpoints while Phase 2 is open would go backwards
  const late = threePhases({ ticks: ['x', 'x', ' ', 'x'] })
  late.story.splice(late.story.findIndex(i => i.id === 'c4') + 1, 0, { ...phase1Button('https://t.x') })
  assert.equal(advanceButton(late, { slug: 'toy-plan' }).moved, null)
})

test('advanceButton: a signed runner button moves, is rewritten for the next phase, and loses its signature', () => {
  const status = 'STATUS\nRUNNER plan-run'
  const text = phaseButtonText({ title: 'Toy Plan', slug: 'toy-plan', base: 'http://intake.localhost', phase: choosePhase(threePhases({ ticks: [' ', ' ', ' ', ' '] })), reportTitle: 'R', runner: 'plan-run' })
  const page = threePhases({ status, button: { type: 'terminal', id: 'b', text, signature: { alg: 'bip340', pubkey: 'aa', created_at: 1, sig: 'bb' } } })
  const r = advanceButton(page, { origin: 'intake.localhost', slug: 'toy-plan' })
  assert.equal(r.moved.unsigned, true)
  const b = r.page.story.find(i => i.id === 'b')
  assert.equal(b.signature, undefined)
  assert.match(b.text, /BOOT: plan-run intake.localhost toy-plan "Phase 2"/)
})
