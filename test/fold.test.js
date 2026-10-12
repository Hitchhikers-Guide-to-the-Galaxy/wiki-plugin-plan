import test from 'node:test'
import assert from 'node:assert/strict'
import { planState, asSlug } from '../src/client/core.js'
import { stateHtml } from '../src/client/plan.js'

const page = {
  title: 'Fold Plan',
  story: [
    { type: 'markdown', id: '1', text: '# Phase 0\n> First.' },
    { type: 'markdown', id: '2', text: '- [ ] Do the first thing' },
    { type: 'markdown', id: '3', text: '# Open Questions' },
    { type: 'markdown', id: '4', text: '- [ ] [[Which way?]] left or right' },
    { type: 'markdown', id: '5', text: 'Named here: notes.md' },
  ],
}

test('stateHtml folds: summary stays, detail is wrapped, counts on the line', () => {
  const st = planState(page, new Set(), asSlug, null)
  const folded = stateHtml(st, 'x.localhost', false, true)
  assert.match(folded, /<a href="#" class="plan-fold"[^>]*>▸<\/a>0\/1 checkpoints · next: Phase 0 · 0 of 1 questions answered · 1 blocker · 1 lint<\/p><div class="plan-detail">/)
  assert.match(folded, /<ol class="plan-phases">/)
  assert.ok(folded.endsWith('</div>'))
  const open = stateHtml(st, 'x.localhost', true, false)
  assert.match(open, /class="plan-fold"[^>]*>▾<\/a>/)
  assert.match(open, /<p class="plan-subject">/)
})
