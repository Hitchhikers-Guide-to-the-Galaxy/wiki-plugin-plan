// Auto: the tier a run weighs, and the model the door picks for it.
// 0.12.0 (David, 20 Oct 2026): big runs to Claude Fable, the rest to the coop's own router.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoTier, autoLine, AUTO, AUTO_RULE, modelLabel } from '../src/client/core.js'
import { autoPick } from '../api/handlers.js'

test('a small redraft is light; its reason names tokens, answers and open phases', () => {
  const t = autoTier({ kind: 'revise', tokens: 34210, answers: 3, openPhases: 2 })
  assert.equal(t.tier, 'light')
  assert.equal(t.weight, 4)
  assert.equal(t.why, '34k tokens, 3 answers, 2 open phases')
})

test('big: a long question, many answers, a whole site, Go Ahead rewriting the plan or a page, a heavy redraft', () => {
  assert.equal(autoTier({ kind: 'revise', tokens: AUTO.bigTokens + 1, answers: 0 }).tier, 'big')
  assert.equal(autoTier({ kind: 'revise', tokens: 9000, answers: AUTO.bigAnswers }).tier, 'big')
  assert.equal(autoTier({ kind: 'site', tokens: 9000, answers: 1, pages: 4 }).tier, 'big')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'Amend', isPlan: true }).tier, 'big')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'Rewrite' }).tier, 'big')
  assert.equal(autoTier({ kind: 'revise', tokens: 20000, answers: 3, openPhases: 18 }).tier, 'big') // weight 12
})

test('light: small runs, Go Ahead Amend and New pages, Do Next Phase', () => {
  assert.equal(autoTier({ kind: 'revise', tokens: 20000, answers: 3, openPhases: 16 }).tier, 'light') // weight 11
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'Amend' }).tier, 'light')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'New' }).tier, 'light')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 6, action: 'Amend' }).tier, 'light') // Go Ahead pages all carry the answers
  assert.equal(autoTier({ kind: 'next', tokens: 9000, answers: 3, checkpoints: 30 }).tier, 'light')
  assert.ok(['light', 'big'].includes(autoTier({ kind: 'site', answers: 30, pages: 99, tokens: 99000 }).tier)) // no third tier
})

test('the farm can move the token line (PLAN_AUTO_BIG_TOKENS)', () => {
  assert.equal(autoTier({ kind: 'revise', tokens: 60000, answers: 1, bigTokens: 200000 }).tier, 'light')
  assert.equal(autoTier({ kind: 'revise', tokens: 60000, answers: 1 }).tier, 'big')
})

test('the same run always weighs the same', () => {
  const s = { kind: 'site', tokens: 61000, answers: 5, pages: 9, queries: 1 }
  assert.deepEqual(autoTier(s), autoTier(s))
})

test('autoLine and modelLabel', () => {
  assert.equal(autoLine({ model: 'openai:llm_auto-big', tier: 'light', why: '9k tokens, 2 answers', note: 'routes to glm-5.3-flash-pp' }), 'auto → auto-big: 9k tokens, 2 answers (routes to glm-5.3-flash-pp)')
  assert.equal(autoLine({ model: 'claude-fable-5-1', tier: 'big', why: '52k tokens, 5 answers' }), 'auto → claude-fable-5-1 (big): 52k tokens, 5 answers')
  assert.equal(autoLine({ model: '' }), '')
  assert.equal(modelLabel('auto'), 'auto')
  assert.equal(modelLabel('claude-fable-5-1'), 'Claude Fable 5.1')
  assert.match(AUTO_RULE, /Claude Fable for big runs/)
})

const doors = [
  {
    door: 'openai',
    models: [
      { id: 'openai:llm_auto-big', selector: true, routesTo: 'openai:llm_glm-5.3-flash-pp', contextLength: 262144, loaded: true },
      { id: 'openai:llm_dsv4s-pp-optimized', contextLength: 384000, loaded: false },
      { id: 'openai:llm_glm-5.3-flash-pp', contextLength: 262144, loaded: true },
    ],
  },
  { door: 'claude', models: [{ id: 'claude-fable-5-1', contextLength: 200000 }, { id: 'claude-opus-5-5', contextLength: 200000 }] },
]

test('autoPick: measures the question, weighs the run, names the model and the line', async () => {
  const content = 'x'.repeat(35 * 3500) // ~35k tokens with the system prompt
  const light = await autoPick({ kind: 'revise', answers: 2, openPhases: 3 }, content, { doors })
  assert.equal(light.model, 'openai:llm_auto-big')
  assert.equal(light.tier, 'light')
  assert.match(light.line, /^auto → auto-big: \d+k tokens, 2 answers, 3 open phases \(routes to glm-5\.3-flash-pp\)$/)
  const big = await autoPick({ kind: 'revise', answers: 5, openPhases: 2 }, content, { doors })
  assert.equal(big.tier, 'big')
  assert.equal(big.model, 'claude-fable-5-1')
  assert.match(big.line, /^auto → claude-fable-5-1 \(big\): /)
  const huge = await autoPick({ kind: 'revise', answers: 5, openPhases: 2 }, 'x'.repeat(280000 * 3.5), { doors })
  assert.equal(huge.model, 'openai:llm_dsv4s-pp-optimized') // over Claude's window
  assert.match(huge.line, /too big for Claude's window; cold/)
  await assert.rejects(autoPick({ kind: 'revise', answers: 1 }, 'x'.repeat(400000 * 3.5), { doors }), e => e.status === 400 && /auto found no model/.test(e.message))
})

// ---------- the classifier call (0.13.0, Auto Model Plan Phase 6) ----------
import { autoSummary, classifierMode } from '../api/handlers.js'

const toy = {
  title: 'Toy Plan',
  story: [
    { type: 'markdown', id: 'a', text: 'A toy plan for the tests, which says what it is for.' },
    { type: 'plan', id: 'p', text: 'STATUS' },
    { type: 'markdown', id: 'b', text: '# Phase 1\n> Build it.' },
    { type: 'markdown', id: 'c', text: '- [x] Build it' },
    { type: 'markdown', id: 'd', text: '# Phase 2\n> Show it.' },
    { type: 'markdown', id: 'e', text: '- [ ] Show it' },
    { type: 'markdown', id: 'f', text: '- [ ] Write it up' },
    { type: 'markdown', id: 'g', text: '# Open Questions' },
    { type: 'markdown', id: 'h', text: '- [x] [[Who pays?]] the farm or the coop. *Answer: the coop*' },
    { type: 'markdown', id: 'i', text: '- [ ] [[Is it worth it?]] *Answer: worth what?*' },
  ],
}
const toyQuestions = [
  { title: 'Who pays?', answered: true, by: 'inline', answer: 'the coop', query: '' },
  { title: 'Is it worth it?', answered: false, query: 'worth what?' },
]
const stub = (markdown, extra = {}) => async ({ summary, doors: d, model }) => ({ tier: markdown.split(':')[0], reason: markdown.split(': ')[1] || '', model: 'openai:glm-5.3-flash', ms: 7, usage: { input: 250, output: 500, reasoning: 480 }, summary, ...extra })
const withMode = async (mode, fn) => {
  const was = process.env.PLAN_AUTO_CLASSIFIER
  process.env.PLAN_AUTO_CLASSIFIER = mode
  try {
    return await fn()
  } finally {
    if (was === undefined) delete process.env.PLAN_AUTO_CLASSIFIER
    else process.env.PLAN_AUTO_CLASSIFIER = was
  }
}

test('autoSummary: the run, its phases, its opening, the questions going in — never the question itself', () => {
  const s = autoSummary({ kind: 'revise', page: toy, questions: toyQuestions })
  assert.match(s, /^Run: Revise Plan of "Toy Plan"/)
  assert.match(s, /Phases: 2, open 1 \(Phase 2: 0\/2 done\)/)
  assert.match(s, /Opening: A toy plan for the tests/)
  assert.match(s, /Answered questions going in: 1\n- Who pays\? — the coop/)
  assert.match(s, /Asked back, not answered: Is it worth it\?/)
  const n = autoSummary({ kind: 'next', page: toy, phase: { label: 'Phase 2', checkpoints: [{ text: 'Show it' }, { text: 'Write it up' }] }, questions: [] })
  assert.match(n, /Phase to do: Phase 2 — 2 checkpoints: Show it; Write it up/)
  const a = autoSummary({ kind: 'apply', title: 'Some Page', action: 'Rewrite', isPlan: true, account: { answers: [{ title: 'Who pays?', inline: true }, { title: 'Where?' }] } })
  assert.match(a, /^Run: Go Ahead, one page on "Some Page"\nAction: Rewrite — this page is the plan itself/)
  assert.match(a, /Answered questions going in: 2\n- Who pays\?\n- Where\? \(an answer page\)/)
  const site = autoSummary({ kind: 'site', page: toy, account: { answers: ['Who pays?'], queries: ['Is it worth it?'], pages: [{ title: 'A' }, { title: 'B' }], brief: ['C'] } })
  assert.match(site, /Pages of the site going in: 2 in full, 1 in brief — A; B/)
  assert.match(site, /Answered questions going in: 1\n- Who pays\?/)
})

test('classifierMode: decide by default, advise and off by PLAN_AUTO_CLASSIFIER, anything else decide', async () => {
  assert.equal(await withMode('', () => classifierMode()), 'decide')
  assert.equal(await withMode('advise', () => classifierMode()), 'advise')
  assert.equal(await withMode('OFF', () => classifierMode()), 'off')
  assert.equal(await withMode('maybe', () => classifierMode()), 'decide')
})

test('decide: the classifier reads the summary with the size on top and its tier is sent; the rule is kept beside it', async () => {
  const content = 'x'.repeat(35 * 3500)
  const r = await withMode('decide', () => autoPick({ kind: 'revise', answers: 2, openPhases: 3 }, content, { doors, summary: 'Run: Revise Plan of "Toy Plan"', classify: stub('big: many open phases') }))
  assert.equal(r.ruled, 'light')
  assert.equal(r.asked, 'big')
  assert.equal(r.model, 'claude-fable-5-1')
  assert.equal(r.classifier.decided, true)
  assert.equal(r.classifier.reason, 'many open phases')
  assert.equal(r.classifier.usage.reasoning, 480)
  assert.match(r.line, /^auto → claude-fable-5-1 \(big\): 3\dk tokens, 2 answers, 3 open phases · classifier said big, the rule light: many open phases$/)
  const agree = await withMode('decide', () => autoPick({ kind: 'revise', answers: 2, openPhases: 3 }, content, { doors, summary: 's', classify: stub('light: a short plan') }))
  assert.equal(agree.model, 'openai:llm_auto-big')
  assert.match(agree.line, / · classifier said light: a short plan$/)
})

test('the summary the classifier reads starts with the size of the question', async () => {
  let read = ''
  await withMode('decide', () => autoPick({ kind: 'revise', answers: 1 }, 'x'.repeat(9 * 3500), { doors, summary: 'Run: Revise Plan', classify: async o => ((read = o.summary), { tier: 'light', reason: 'r' }) }))
  assert.match(read, /^Question: (9|10)k tokens\nRun: Revise Plan$/)
})

test('advise: recorded on the job, the rule decides', async () => {
  const content = 'x'.repeat(35 * 3500)
  const r = await withMode('advise', () => autoPick({ kind: 'revise', answers: 2, openPhases: 3 }, content, { doors, summary: 's', classify: stub('big: many open phases') }))
  assert.equal(r.asked, 'light')
  assert.equal(r.model, 'openai:llm_auto-big')
  assert.equal(r.classifier.decided, false)
  assert.match(r.line, / · classifier advised big, the rule light: many open phases$/)
})

test('off, or no summary: no call, no classifier on the job', async () => {
  const content = 'x'.repeat(35 * 3500)
  let called = 0
  const spy = async () => ((called += 1), { tier: 'big' })
  const off = await withMode('off', () => autoPick({ kind: 'revise', answers: 2 }, content, { doors, summary: 's', classify: spy }))
  const bare = await withMode('decide', () => autoPick({ kind: 'revise', answers: 2 }, content, { doors, classify: spy }))
  assert.equal(called, 0)
  assert.equal(off.classifier, undefined)
  assert.equal(bare.classifier, undefined)
  assert.equal(off.ruled, 'light')
})

test('skipped: the rule stands and the line says why', async () => {
  const content = 'x'.repeat(35 * 3500)
  const r = await withMode('decide', () => autoPick({ kind: 'revise', answers: 5 }, content, { doors, summary: 's', classify: async () => ({ tier: null, skipped: 'no coop model is loaded', ms: 3 }) }))
  assert.equal(r.asked, 'big')
  assert.equal(r.model, 'claude-fable-5-1')
  assert.equal(r.classifier.decided, false)
  assert.match(r.line, / · classifier skipped: no coop model is loaded$/)
})
