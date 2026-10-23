// 0.16.5 — each finished phase links its report at the end of its section.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phaseReports, linkReports, planState, phaseButtonText, storyAt } from '../src/client/core.js'
import { stateHtml } from '../src/client/plan.js'

const md = (id, text) => ({ type: 'markdown', id, text })
const plan = () => {
  const story = [
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1\n> Begin.'),
    md('c1', '- [x] Write the page'),
    md('n1', 'A note after the checkpoints.'),
    md('h2', '# Phase 2\n> Then build.'),
    md('c2', '- [x] Build it'),
    md('r2', '[[Toy Plan Phase 2 Report]]'),
    md('h3', '# Phase 3\n> Ship.'),
    md('c3', '- [ ] Ship it'),
    md('h4', '# See\n\n- [[Toy Tool]]'),
  ]
  return { title: 'Toy Plan', story, journal: [{ type: 'create', date: 1, item: { title: 'Toy Plan', story: JSON.parse(JSON.stringify(story)) } }] }
}

test('phaseReports: each phase with checkpoints, its report, linked in its own section or not', () => {
  const r = phaseReports(plan())
  assert.deepEqual(r.map(x => [x.label, x.title, x.linked, x.complete, x.lastId]), [
    ['Phase 1', 'Toy Plan Phase 1 Report', false, true, 'n1'],
    ['Phase 2', 'Toy Plan Phase 2 Report', true, true, 'r2'],
    ['Phase 3', 'Toy Plan Phase 3 Report', false, false, 'c3'],
  ])
})

test('linkReports: a complete phase whose report exists gets [[report]] at the end of its section, journaled; nothing else', () => {
  let n = 0
  const exists = slug => ['toy-plan-phase-1-report', 'toy-plan-phase-2-report', 'toy-plan-phase-3-report'].includes(slug)
  const { page, added } = linkReports(plan(), exists, { now: () => 9, id: () => `x${n++}` })
  assert.deepEqual(added, [{ title: 'Toy Plan Phase 1 Report', slug: 'toy-plan-phase-1-report', phase: 'Phase 1' }])
  assert.deepEqual(page.story.map(i => i.id).slice(0, 6), ['p', 'h1', 'c1', 'n1', 'x0', 'h2'])
  assert.equal(page.story[4].text, '[[Toy Plan Phase 1 Report]]')
  const add = page.journal.at(-1)
  assert.deepEqual([add.type, add.id, add.after, add.date], ['add', 'x0', 'n1', 9])
  assert.match(add.provenance, /Phase 1 is done, so its report is linked/)
  assert.deepEqual(storyAt(page), page.story)
  // run again: nothing to add
  assert.deepEqual(linkReports(page, exists).added, [])
  // no report page yet: nothing
  assert.deepEqual(linkReports(plan(), () => false).added, [])
})

test('the status line shows a linked report beside its phase', () => {
  const st = planState(plan())
  assert.equal(st.phases[1].report.linked, true)
  const html = stateHtml(st, 'toy.localhost', false, false, null)
  assert.match(html, /Phase 2 <span class="plan-ticks">1\/1<\/span> <a class="internal plan-report" href="\/toy-plan-phase-2-report\.html"[^>]*>report<\/a>/)
  assert.doesNotMatch(html, /toy-plan-phase-1-report/)
})

test('the Do Phase brief asks the run to link its report at the end of the section', () => {
  const text = phaseButtonText({ title: 'Toy Plan', slug: 'toy-plan', base: 'http://toy.localhost', phase: { label: 'Phase 3', slug: 'phase-3' }, reportTitle: 'Toy Plan Phase 3 Report' })
  assert.match(text, /add one markdown item whose text is \[\[Toy Plan Phase 3 Report\]\] at the end of the Phase 3 section on the plan page, through the journal, unless that section links it already/)
  assert.ok(!/['"`$\\]/.test(text.split('\n').pop()))
})
