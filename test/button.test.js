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
  assert.deepEqual(lines.slice(0, 6), ['BUTTON: show', 'LABEL: Do Phase 2', 'SESSION: bobs-toy-plan-agent', 'BOOT: cd ~ && claude', 'GUARD: claude auth status', 'GUARDLABEL: Sign in to Claude first'])
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
