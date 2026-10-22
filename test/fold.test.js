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

test('0.16.4: pages to write — an unticked task each, with where and an Answer; red-link blockers get Answer too', () => {
  const page = { title: 'Toy Plan', story: [
    { type: 'plan', id: 'p', text: 'STATUS' },
    { type: 'markdown', id: 'h', text: '# Phase 1\n> Go.' },
    { type: 'markdown', id: 'c', text: '- [ ] Build [[Missing Page]]' },
  ] }
  const st = planState(page, new Set(), asSlug)
  st.missing = [{ title: 'Missing Page', slug: 'missing-page', kind: 'wikilink', section: 'Phase 1' }, { title: 'On Timeline', slug: 'on-timeline', kind: 'timeline event', section: '' }]
  const html = stateHtml(st, 'toy.localhost', false, false, null)
  assert.match(html, /2 pages to write/)
  assert.match(html, /2 pages the plan links are not written yet/)
  assert.match(html, /<li><span class="plan-box" aria-hidden="true">☐<\/span> <a[^>]*>Missing Page<\/a> <span class="plan-missing-where">in Phase 1<\/span> <a href="#" class="plan-ask" data-title="Missing Page"/)
  assert.match(html, /On Timeline<\/a> <span class="plan-missing-where">on the timeline<\/span>/)
  assert.match(html, /Blocked by red link <a[^>]*>Missing Page<\/a> <a href="#" class="plan-ask" data-title="Missing Page"/)
})
