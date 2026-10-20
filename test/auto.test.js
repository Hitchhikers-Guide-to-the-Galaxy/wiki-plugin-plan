// Auto (0.11.0): the tier a run weighs, and the model the door picks for it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoTier, autoLine, AUTO, AUTO_RULE, modelLabel } from '../src/client/core.js'
import { autoPick } from '../api/handlers.js'

test('a small redraft is light; its reason names tokens and answers', () => {
  const t = autoTier({ kind: 'revise', tokens: 34210, answers: 3, openPhases: 2 })
  assert.equal(t.tier, 'light')
  assert.equal(t.weight, 4)
  assert.equal(t.why, '34k tokens, 3 answers, 2 open phases')
})

test('big: a long question, many answers, a whole site, Go Ahead rewriting the plan or a page', () => {
  assert.equal(autoTier({ kind: 'revise', tokens: AUTO.bigTokens + 1, answers: 0 }).tier, 'big')
  assert.equal(autoTier({ kind: 'revise', tokens: 9000, answers: AUTO.bigAnswers }).tier, 'big')
  assert.equal(autoTier({ kind: 'site', tokens: 9000, answers: 1, pages: 4 }).tier, 'big')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'Amend', isPlan: true }).tier, 'big')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'Rewrite' }).tier, 'big')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'Amend' }).tier, 'light')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 2, action: 'New' }).tier, 'light')
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 6, action: 'Amend' }).tier, 'light') // Go Ahead pages all carry the answers
})

test('careful: only a redraft or site revision heavy with answers and open phases', () => {
  const t = autoTier({ kind: 'revise', tokens: 40000, answers: 10, openPhases: 4 })
  assert.equal(t.weight, 12)
  assert.equal(t.tier, 'careful')
  assert.equal(autoTier({ kind: 'revise', tokens: 40000, answers: 9, openPhases: 4 }).tier, 'big') // 11
  assert.equal(autoTier({ kind: 'site', tokens: 90000, answers: 10, pages: 16 }).tier, 'careful') // 10 + 2
  assert.equal(autoTier({ kind: 'site', tokens: 34000, answers: 5, pages: 60 }).tier, 'big') // pages count to 24: 5 + 3
  assert.equal(autoTier({ kind: 'revise', tokens: 20000, answers: 8, openPhases: 4, queries: 2 }).tier, 'careful') // asked back counts
  // Go Ahead and Do Next Phase never go to Claude on weight alone
  assert.equal(autoTier({ kind: 'apply', tokens: 9000, answers: 30, action: 'Rewrite', isPlan: true }).tier, 'big')
  assert.equal(autoTier({ kind: 'next', tokens: 9000, answers: 3, checkpoints: 30 }).tier, 'light')
})

test('the same run always weighs the same', () => {
  const s = { kind: 'site', tokens: 61000, answers: 5, pages: 9, queries: 1 }
  assert.deepEqual(autoTier(s), autoTier(s))
})

test('autoLine and modelLabel', () => {
  assert.equal(autoLine({ model: 'openai:llm_glm-5.3-flash-pp', why: '34k tokens, 3 answers' }), 'auto → glm-5.3-flash-pp: 34k tokens, 3 answers')
  assert.equal(autoLine({ model: 'openai:llm_dsv4s-pp-optimized', tier: 'big', why: '60k tokens, 5 answers', note: 'cold — it loads first' }), 'auto → dsv4s-pp-optimized (big): 60k tokens, 5 answers (cold — it loads first)')
  assert.equal(autoLine({ model: 'openai:llm_glm-5.3-flash-pp', tier: 'light', why: '9k tokens, 2 answers' }), 'auto → glm-5.3-flash-pp: 9k tokens, 2 answers')
  assert.equal(autoLine({ model: '' }), '')
  assert.equal(modelLabel('auto'), 'auto')
  assert.match(AUTO_RULE, /^Auto picks per run/)
})

const doors = [
  {
    door: 'openai',
    models: [
      { id: 'openai:llm_auto-big', selector: true, contextLength: 262144, loaded: true },
      { id: 'openai:llm_dsv4s-pp-optimized', contextLength: 384000, loaded: false },
      { id: 'openai:llm_glm-5.3-flash-pp', contextLength: 262144, loaded: true },
    ],
  },
  { door: 'claude', models: [{ id: 'claude-opus-5-5', contextLength: 200000 }] },
]

test('autoPick: measures the question, weighs the run, names the model and the line', async () => {
  const content = 'x'.repeat(35 * 3500) // ~35k tokens with the system prompt
  const light = await autoPick({ kind: 'revise', answers: 2, openPhases: 3 }, content, { doors })
  assert.equal(light.model, 'openai:llm_glm-5.3-flash-pp')
  assert.equal(light.tier, 'light')
  assert.match(light.line, /^auto → glm-5\.3-flash-pp: \d+k tokens, 2 answers, 3 open phases$/)
  const big = await autoPick({ kind: 'revise', answers: 5, openPhases: 2 }, content, { doors })
  assert.equal(big.tier, 'big')
  assert.equal(big.model, 'openai:llm_glm-5.3-flash-pp') // loaded and a big window: no swap
  const huge = await autoPick({ kind: 'revise', answers: 5, openPhases: 2 }, 'x'.repeat(280000 * 3.5), { doors })
  assert.equal(huge.model, 'openai:llm_dsv4s-pp-optimized')
  assert.match(huge.line, /cold — it loads first/)
  const careful = await autoPick({ kind: 'revise', answers: 11, openPhases: 4 }, content, { doors })
  assert.equal(careful.model, 'claude-opus-5-5')
  await assert.rejects(autoPick({ kind: 'revise', answers: 1 }, 'x'.repeat(400000 * 3.5), { doors }), e => e.status === 400 && /auto found no model/.test(e.message))
})
