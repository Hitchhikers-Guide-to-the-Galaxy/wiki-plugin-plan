// The waiting line (0.15.4): a Do Phase run that stops for David says so
// under its phase, and clears it when the phase is done.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { phaseButtonText, waitingLine, isWaiting, waitingLines, WAITING_MARK } from '../src/client/core.js'

const args = { title: 'Open Squad Plan', slug: 'open-squad-plan', base: 'https://agentic.private.fish', phase: { label: 'Phase 2', slug: 'phase-2' }, reportTitle: 'Open Squad Plan Phase 2 Report', previousReport: 'Open Squad Plan Phase 1 Report', nextPhase: { label: 'Phase 3', slug: 'phase-3' } }

test('the brief asks for a waiting line under the phase, and its removal at the end', () => {
  const text = phaseButtonText(args)
  assert.match(text, /If you stop to wait for me/)
  assert.match(text, /just under the Phase 2 heading on the plan page/)
  assert.ok(text.includes(`${WAITING_MARK} David`))
  // 0.16.10: the decisions are asked on the page, answered there, and waited on
  assert.match(text, /one checkpoint per decision, each a red question link/)
  assert.match(text, /LABEL: Send my answers, then SESSION: open-squad-plan-phase-2, then BOOT/)
  assert.match(text, /My answers are on the plan page https:\/\/agentic\.private\.fish\/view\/open-squad-plan: read them/)
  assert.match(text, /remove it and the Send my answers button, one journal remove each/)
  assert.doesNotMatch(text, /wiki-await-answers|fedwiki\.settle/)
  assert.match(text, /If I answer in this terminal or with a suggested reply instead, first write my reply onto each question line/)
  assert.ok(!/[*?]/.test(text.split('\n').pop()), 'no glob characters for a bare zsh')
  // it comes before the closing instructions, and the brief stays shell-safe
  assert.ok(text.indexOf('If you stop to wait') < text.indexOf('When the phase is done'))
  const brief = text.split('\n').pop()
  assert.ok(!/['"`$\\]/.test(brief))
  // a CONTEXT carry plan gets it too; who can be another name
  assert.match(phaseButtonText({ ...args, carry: true, who: 'Lena' }), /starts ⏸ Waiting for Lena/)
})

test('a runner button carries no brief, so no waiting sentence', () => {
  assert.doesNotMatch(phaseButtonText({ ...args, runner: 'plan-run' }), /Waiting for/)
})

test('waiting lines are written, recognised and found under their phase', () => {
  const line = waitingLine({ since: '22:52, 21 October', what: 'drive Claude Squad in ~/Code/open-squad-pilot' })
  assert.equal(line, '⏸ Waiting for David since 22:52, 21 October: drive Claude Squad in ~/Code/open-squad-pilot.')
  assert.equal(isWaiting({ type: 'markdown', text: line }), true)
  assert.equal(isWaiting({ type: 'markdown', text: '- [ ] Waiting for David' }), false)
  const page = { story: [
    { type: 'markdown', id: 'h1', text: '# Phase 1\n> Install.' },
    { type: 'markdown', id: 'c1', text: '- [x] done' },
    { type: 'markdown', id: 'h2', text: '# Phase 2\n> A person supervises.' },
    { type: 'markdown', id: 'w', text: line },
    { type: 'markdown', id: 'c2', text: '- [ ] Squad session' },
  ] }
  assert.deepEqual(waitingLines(page), [{ id: 'w', phase: 'Phase 2', text: line }])
})

test('the Send my answers button goes back into the session that asked', async () => {
  const { answerButtonText } = await import('../src/client/core.js')
  const text = answerButtonText({ label: 'Phase 4', session: 'fieldguide-dns-plan-phase-4', url: 'https://dns.private.fish/view/fieldguide-dns-plan' })
  const lines = text.split('\n')
  assert.deepEqual(lines.slice(0, 3), ['BUTTON: show', 'LABEL: Send my answers', 'SESSION: fieldguide-dns-plan-phase-4'])
  assert.equal(lines[3], 'BOOT: cd ~ && claude')
  const message = lines.pop()
  assert.ok(!/['"`$\\*?]/.test(message), 'the message is safe for a bare zsh')
  assert.ok(!/^[A-Z][A-Z0-9_]*(:|\s)/.test(message), 'the message never looks like a directive line')
})
