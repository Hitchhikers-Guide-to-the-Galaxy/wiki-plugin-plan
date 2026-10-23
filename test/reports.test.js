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

test('linkReports: a complete phase whose report exists gets "See [[report]]." at the end of its section, journaled; a bare link is reworded', () => {
  let n = 0
  const exists = slug => ['toy-plan-phase-1-report', 'toy-plan-phase-2-report', 'toy-plan-phase-3-report'].includes(slug)
  const { page, added, reformatted } = linkReports(plan(), exists, { now: () => 9, id: () => `x${n++}` })
  assert.deepEqual(added, [{ title: 'Toy Plan Phase 1 Report', slug: 'toy-plan-phase-1-report', phase: 'Phase 1' }])
  assert.deepEqual(page.story.map(i => i.id).slice(0, 6), ['p', 'h1', 'c1', 'n1', 'x0', 'h2'])
  assert.equal(page.story[4].text, 'See [[Toy Plan Phase 1 Report]].')
  // the bare Phase 2 link (as 0.16.5 wrote them) now reads as a See line, by an edit
  assert.deepEqual(reformatted, [{ title: 'Toy Plan Phase 2 Report', slug: 'toy-plan-phase-2-report', phase: 'Phase 2' }])
  assert.equal(page.story.find(i => i.id === 'r2').text, 'See [[Toy Plan Phase 2 Report]].')
  const edit = page.journal.find(a => a.type === 'edit' && a.id === 'r2')
  assert.match(edit.provenance, /Phase 2's report link reads as a See line/)
  const add = page.journal.find(a => a.type === 'add')
  assert.deepEqual([add.type, add.id, add.after, add.date], ['add', 'x0', 'n1', 9])
  assert.match(add.provenance, /Phase 1 is done, so its report is linked/)
  assert.deepEqual(storyAt(page), page.story)
  // run again: nothing to add, nothing to reword; a See line in prose is left as written
  assert.deepEqual(linkReports(page, exists).added, [])
  assert.deepEqual(linkReports(page, exists).reformatted, [])
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
  assert.match(text, /add one markdown item at the end of the Phase 3 section on the plan page, through the journal, reading See \[\[Toy Plan Phase 3 Report\]\]\. with its full stop, unless that section links the report already/)
  assert.ok(!/['"`$\\]/.test(text.split('\n').pop()))
})

test('0.16.6: the brief asks for each tick the moment it is verified, before the next', () => {
  const text = phaseButtonText({ title: 'Toy Plan', slug: 'toy-plan', base: 'http://toy.localhost', phase: { label: 'Phase 3', slug: 'phase-3' }, reportTitle: 'Toy Plan Phase 3 Report' })
  assert.match(text, /Tick each checkpoint on the plan page the moment you have verified it, one journal edit for that item, before you start the next/)
  assert.ok(text.indexOf('Tick each checkpoint') < text.indexOf('When the phase is done'))
})

test('0.16.7: the Open Questions heading is found however it is cased or spaced', async () => {
  const { isQuestionsHeading, phasesOf, questionsOf, openQuestions, planLinks } = await import('../src/client/core.js')
  for (const h of ['Open Questions', 'Open questions', 'open questions', 'OPEN QUESTIONS', ' Open  Questions: ']) assert.equal(isQuestionsHeading(h), true, h)
  for (const h of ['Questions', 'Open Questions Page', 'Phase 1', null, undefined, '']) assert.equal(isQuestionsHeading(h), false, String(h))
  const page = {
    title: 'Swampish Plan',
    story: [
      md('h1', '# Phase 1\n> Go.'),
      md('c1', '- [x] Do it'),
      md('hq', '# Open questions\n> Each a red link.'),
      md('q1', '- [ ] [[Is it small?]] size'),
      md('q2', '- [x] [[Is it done?]] yes *Answer: yes.*'),
    ],
  }
  assert.deepEqual(phasesOf(page).map(p => p.label), ['Phase 1'])
  assert.deepEqual(planState(page).phases.map(p => p.line), ['Phase 1'])
  assert.equal(planState(page).complete, true)
  assert.deepEqual(questionsOf(page).map(q => q.title), ['Is it small?', 'Is it done?'])
  assert.equal(openQuestions(page), 1)
  assert.equal(planLinks(page).find(l => l.title === 'Is it small?').held, true)
  assert.deepEqual(phaseReports(page).map(r => r.label), ['Phase 1'])
})
