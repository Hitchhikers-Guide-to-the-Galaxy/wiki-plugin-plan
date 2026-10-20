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
