// 0.10.0: the Model Settings face, the model labels, and the warning a
// redraft carries when it drops the plan's questions or task lines.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse, face, modelLabel, windowLabel, revisionLosses, reviseItems } from '../src/client/core.js'

test('MODELS is its own face, wherever the item sits', () => {
  assert.equal(face(parse('MODELS')), 'models')
  assert.equal(face(parse('MODELS'), { ownTitle: 'Toy Plan' }), 'models')
  assert.equal(face(parse('STATUS'), { ownTitle: 'Toy Plan' }), 'status')
})

test('modelLabel and windowLabel: short names for the chip and the rows', () => {
  assert.equal(modelLabel(''), 'farm default')
  assert.equal(modelLabel('openai:llm_auto-big'), 'coop · auto-big')
  assert.equal(modelLabel('claude-opus-5-5'), 'Claude Opus 5.5')
  assert.equal(modelLabel('claude-cli:claude-haiku-5-5'), 'Claude Haiku 5.5')
  assert.equal(modelLabel('ollama:qwen3:4b'), 'Ollama · qwen3:4b')
  assert.deepEqual([262144, 384000, 32768, 200000, 8192].map(windowLabel), ['262K', '384K', '32K', '200K', '8K'])
})

const plan = {
  title: 'Toy Plan',
  story: [
    { type: 'markdown', id: 'a', text: 'A toy plan.' },
    { type: 'plan', id: 'p', text: 'STATUS' },
    { type: 'markdown', id: 'b', text: '# Phase 1' },
    { type: 'markdown', id: 'c', text: '- [ ] Build it' },
    { type: 'markdown', id: 'd', text: '- [x] Ask first' },
    { type: 'markdown', id: 'e', text: '# Open Questions' },
    { type: 'markdown', id: 'f', text: '- [ ] [[Is it big?]] size' },
    { type: 'markdown', id: 'g', text: '- [ ] [[Who builds it?]] people' },
  ],
}

test('revisionLosses: nothing lost, nothing said', () => {
  const same = '# Phase 1\n\n- [ ] Build it\n\n- [x] Ask first\n\n# Open Questions\n\n- [ ] [[Is it big?]] size\n\n- [ ] [[Who builds it?]] people'
  const items = reviseItems({ page: plan, markdown: same, id: (() => { let n = 0; return () => `n${n++}` })() })
  assert.equal(revisionLosses(plan, items).warning, '')
  assert.ok(!items[0].text.includes('Check before you save'))
})

test('revisionLosses: a redraft without the questions says so on its first line, which Save drops', () => {
  const short = '# Phase 1\n\n- [ ] Build it'
  const items = reviseItems({ page: plan, markdown: short, id: (() => { let n = 0; return () => `n${n++}` })() })
  const r = revisionLosses(plan, items)
  assert.deepEqual(r.lostQuestions, ['Is it big?', 'Who builds it?'])
  assert.deepEqual(r.tasks, { before: 4, after: 1 })
  assert.match(items[0].text, /\*\*Check before you save:\*\* it drops 2 of the plan's 2 questions \("Is it big\?", "Who builds it\?"\); it has 1 task lines where the plan has 4\./)
})
