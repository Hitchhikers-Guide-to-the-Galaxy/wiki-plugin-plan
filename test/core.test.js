import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, isPlanTitle, ticks, summarise, openQuestions, lastEdit, byRecent, headingOf, face, asSlug, sections, questionsOf, unlinkedFiles, linkTitles, audit, forkSites, planState, trashable } from '../src/client/core.js'

test('parse: commands, optional colon, caption, bare item', () => {
  assert.deepEqual(parse('SUBJECT'), { subject: true, status: false, models: false, revise: false, sessions: false, context: 'fresh', runner: null, site: null, limit: null, skills: [], caption: '', commands: 1 })
  const p = parse('Plans of the plan site\nSITE: plan.localhost\nLIMIT 5')
  assert.equal(p.site, 'plan.localhost')
  assert.equal(p.limit, 5)
  assert.equal(p.subject, false)
  assert.equal(p.caption, 'Plans of the plan site')
  assert.equal(parse('').subject, false) // bare: face() decides from the page
  assert.equal(parse('just a caption').subject, false)
  assert.equal(parse('just a caption').commands, 0)
  assert.equal(parse('site of plans').site, null) // lowercase is data
  assert.equal(parse('SITE https://plan.localhost/view/x').site, 'plan.localhost')
})

test('isPlanTitle copies plan-index.py', () => {
  for (const t of ['Email Plan', 'Product Roadmap', 'Plan', ' Plan Tool Plan ']) assert.ok(isPlanTitle(t), t)
  for (const t of ['Plan Index', 'Current Plan', 'current plan', 'Planning', 'Airplan', 'ÉtéPlan', 'Plan Tool', null, 42]) assert.ok(!isPlanTitle(t), String(t))
})

test('ticks across items, open questions in their section only', () => {
  const page = {
    story: [
      { type: 'markdown', text: '# Phase 1\n> x.' },
      { type: 'markdown', text: '- [x] one' },
      { type: 'markdown', text: '- [ ] two' },
      { type: 'paragraph', text: '- [ ] not markdown' },
      { type: 'markdown', text: '# Open Questions\n> Questions.' },
      { type: 'markdown', text: '- [ ] [[Why?]] gloss' },
      { type: 'markdown', text: '- [x] [[How?]] gloss' },
      { type: 'markdown', text: '- [ ] [[When?]] gloss' },
      { type: 'markdown', text: '# See\n\n- [ ] after' },
    ],
    journal: [{ date: 5 }, { date: 9 }, { type: 'x' }],
  }
  assert.deepEqual(ticks(page), { done: 2, total: 6 }) // the Plan Index rule: every task line
  // The list face counts as the state view does (David's decision, Phase 3):
  // phase checkpoints only, Open Questions apart. Phase 1 here is 1/2 and See
  // holds one stray checkpoint, so 1/3; the open questions are counted alone.
  const r = summarise({ title: 'T Plan', slug: 't-plan', date: 3 }, page)
  assert.deepEqual([r.done, r.total, r.questions, r.modified], [1, 3, 2, 9])
  assert.deepEqual([summarise({ title: 'U Plan', slug: 'u', date: 3 }, null).total, summarise({ title: 'U Plan', slug: 'u', date: 3 }, null).read], [0, false])
  assert.equal(openQuestions(page), 2)
  assert.equal(lastEdit(page, 1), 9)
  assert.equal(lastEdit({ journal: [] }, 7), 7)
  assert.equal(headingOf({ type: 'markdown', text: '#hashtag' }), null)
  assert.equal(headingOf({ type: 'markdown', text: '## Phase 2 — 20\nblurb' }), 'Phase 2')
})

test('newest first, title breaks ties', () => {
  const rows = [{ title: 'b', modified: 1 }, { title: 'A', modified: 1 }, { title: 'c', modified: 2 }]
  assert.deepEqual(rows.sort(byRecent).map(r => r.title), ['c', 'A', 'b'])
})

// ---------- Phase 2 ----------

test('face: status on a plan, subject when a plan is to the left, list otherwise', () => {
  assert.equal(face(parse(''), { ownTitle: 'Plan Tool Plan' }), 'status')
  assert.equal(face(parse('LIMIT 3'), { ownTitle: 'Plan Tool Plan' }), 'status')
  assert.equal(face(parse(''), { ownTitle: 'About Plan Plugin' }), 'list')
  assert.equal(face(parse('SUBJECT'), { ownTitle: 'Plan Tool', leftTitle: 'Plan Tool Plan' }), 'subject')
  assert.equal(face(parse('SUBJECT'), { ownTitle: 'Plan Tool', leftTitle: 'Plan Index' }), 'list')
  assert.equal(face(parse('SUBJECT'), { ownTitle: 'Plan Tool', leftTitle: null }), 'list')
  assert.equal(face(parse('SITE plan.localhost'), { ownTitle: 'Email Plan' }), 'list')
  assert.equal(face(parse('SUBJECT\nSITE plan.localhost'), { leftTitle: 'Email Plan' }), 'list')
})

test('asSlug copies wiki-client', () => {
  assert.equal(asSlug("Does the plan item also serve as the plan's status line?"), 'does-the-plan-item-also-serve-as-the-plans-status-line')
  assert.equal(asSlug('Plan Tool Plan'), 'plan-tool-plan')
})

const md = text => ({ type: 'markdown', text })
const plan = {
  title: 'Toy Plan',
  story: [
    md('Opening [[Toy Tool]].'),
    { type: 'plan', text: '' },
    md('# The Idea\n> No checkpoints here.'),
    md('Prose that names build.js and `docs/notes.md`, links [http://x.org/a.json a.json] and [[readme.md]].'),
    md('# Phase 0\n> Done.'),
    md('- [x] one'),
    md('- [X] two'),
    md('# Phase 1 — 3\n> Next.'),
    md('- [x] three'),
    md('- [ ] four, see [[Missing Page]] and [[Toy Tool]]'),
    md('# Phase 2\n> Later.'),
    md('- [ ] five [[Later Missing]]'),
    md('# Open Questions\n> Each a red link.'),
    md('- [ ] [[Is it big?]] gloss'),
    md('- [x] [[Is it small?]] ticked but no page'),
    md('- [ ] [[Not a question]] no mark'),
    md('- [x] [[Is it done?]] answered'),
    md('# See\n\n- [[Toy Tool]]'),
  ],
}
const known = new Set(['toy-tool', 'is-it-big', 'is-it-done'])

test('sections, phases and the next phase', () => {
  assert.deepEqual(sections(plan).map(s => s.heading), ['The Idea', 'Phase 0', 'Phase 1', 'Phase 2', 'Open Questions', 'See'])
  const s = planState(plan, known)
  assert.deepEqual(s.phases.map(({ line, done, total }) => ({ line, done, total })), [
    { line: 'Phase 0', done: 2, total: 2 },
    { line: 'Phase 1 — 3', done: 1, total: 2 },
    { line: 'Phase 2', done: 0, total: 1 },
  ])
  assert.equal(s.next, 1)
  assert.equal(s.complete, false)
  assert.deepEqual([s.done, s.total], [3, 5]) // Open Questions are not checkpoints of a phase
  assert.deepEqual(s.blockers.redLinks.map(r => r.title), ['Missing Page']) // only the next phase's section
  assert.deepEqual(s.blockers.questions.map(q => q.title), ['Is it small?'])
})

test('questions: a ?-link task line, answered when its page exists, tick reported apart', () => {
  const qs = questionsOf(plan, known)
  assert.deepEqual(qs.map(q => [q.title, q.answered, q.ticked]), [
    ['Is it big?', true, false],
    ['Is it small?', false, true],
    ['Is it done?', true, true],
  ])
  const s = planState(plan, known)
  assert.equal(s.answered, 2)
  assert.equal(s.ticked, 2)
  assert.equal(s.questions.length, 3)
})

test('lint: files named but not linked', () => {
  assert.deepEqual(unlinkedFiles(plan), ['build.js', 'docs/notes.md'])
  assert.deepEqual(unlinkedFiles({ story: [md('see plan.localhost and e.g. this, v0.1.0')] }), [])
  assert.match(planState(plan, known).lints.join(' '), /build\.js, docs\/notes\.md/)
})

test('lint: every checkpoint ticked but no Demo link', () => {
  const done = { story: [md('# Phase 0\n> x.'), md('- [x] a'), md('# Open Questions'), md('- [ ] [[Q?]]')] }
  const s = planState(done, new Set())
  assert.equal(s.complete, true)
  assert.equal(s.next, -1)
  assert.deepEqual(s.blockers, { questions: [], redLinks: [] })
  assert.ok(s.lints.some(l => /Demo/.test(l)))
  const shown = { story: [...done.story, md('[[Toy Plan Demo]]')] }
  assert.ok(!planState(shown, new Set()).lints.some(l => /Demo/.test(l)))
  const external = { story: [...done.story, md('[http://demo.localhost/view/x Plan State Demo]')] }
  assert.deepEqual(linkTitles(external).slice(-1), ['Plan State Demo'])
  assert.ok(!planState(external, new Set()).lints.some(l => /Demo/.test(l)))
  assert.ok(!planState(plan, known).lints.some(l => /Demo/.test(l))) // not complete
})

test('lint: scatter uses plan-lint.py audit()', () => {
  const c = (site, ...forks) => ({ site, forks: new Set(forks) })
  // home copy only has a create; the twin forked from it: both clean
  let r = audit([c('a'), c('b', 'a')])
  assert.deepEqual([r.clean.length, r.scattered.length], [2, 0])
  // neither knows the other: both scattered
  r = audit([c('a'), c('b')])
  assert.deepEqual(r.scattered.map(x => x.site), ['a', 'b'])
  // a fork from outside the group does not count
  r = audit([c('a', 'z'), c('b')])
  assert.equal(r.scattered.length, 2)
  // three copies, one stray
  r = audit([c('a'), c('b', 'a'), c('c')])
  assert.deepEqual(r.scattered.map(x => x.site), ['c'])
  assert.deepEqual([...forkSites({ journal: [{ type: 'create' }, { type: 'fork', site: 'x' }, { type: 'fork' }] })], ['x'])
})

test('trashable: only an origin page that is really here', () => {
  assert.ok(trashable({ site: null, host: 'plan.localhost', id: 'x' }).ok)
  assert.ok(trashable({ site: 'plan.localhost', host: 'plan.localhost', id: 'x' }).ok)
  assert.ok(trashable({ site: 'view', host: 'plan.localhost' }).ok)
  assert.ok(!trashable({ site: 'prompt.geek.fish', host: 'plan.localhost' }).ok)
  assert.ok(!trashable({ ghost: true, host: 'plan.localhost' }).ok)
  assert.ok(!trashable({ local: true, host: 'plan.localhost' }).ok)
  assert.ok(!trashable({ recycler: true, host: 'plan.localhost' }).ok)
  assert.ok(!trashable({ id: 'my-page_rev0', host: 'plan.localhost' }).ok)
  assert.match(trashable({ site: 'prompt.geek.fish', host: 'plan.localhost' }).why, /prompt\.geek\.fish/)
})
