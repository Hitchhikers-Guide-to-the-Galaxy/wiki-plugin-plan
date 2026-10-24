// 0.17.0 — Open Claude (an open conversation about the plan in a Claude Code
// session) and Claude Sessions (every Claude session on the laptop).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parse, face, COMMANDS, TOOL_SLUGS, OPEN_LABEL, openSession, openButtonText, findOpenButton, openPlacement, envScript, terminalsOf, planOfSession, sessionRows, planGuess } from '../src/client/core.js'

const plan = (extra = []) => ({
  title: 'Toy Plan',
  story: [{ type: 'markdown', id: 'a', text: 'Opening.' }, { type: 'plan', id: 'p', text: 'STATUS' }, { type: 'markdown', id: 'h', text: '# Phase 1' }, ...extra],
})

test('SESSIONS is a command and its own face', () => {
  assert.ok(COMMANDS.includes('SESSIONS'))
  const o = parse('SESSIONS')
  assert.equal(o.sessions, true)
  assert.equal(face(o, { ownTitle: 'Claude Sessions' }), 'sessions')
  assert.ok(TOOL_SLUGS.has('claude-sessions') && TOOL_SLUGS.has('claude-in-wiki'))
})

test('the Open Claude button boots claude in the plan session and types an open brief', () => {
  const text = openButtonText({ title: 'Toy Plan', slug: 'toy-plan', base: 'http://plan.localhost/' })
  const lines = text.split('\n')
  assert.deepEqual(lines.slice(0, 6), ['BUTTON: show', `LABEL: ${OPEN_LABEL}`, 'SESSION: toy-plan-claude', 'BOOT: cd ~ && claude', 'GUARD: claude auth status', 'GUARDLABEL: Sign in to Claude first'])
  assert.equal(lines.length, 7, 'the brief is one line')
  assert.match(lines[6], /^Open conversation about the Toy Plan, http:\/\/plan\.localhost\/view\/toy-plan\./)
  assert.match(lines[6], /change nothing until I ask/)
  // the terminal service reads a line opening with a capital word and a space or colon as a directive
  assert.doesNotMatch(lines[6], /^[A-Z][A-Z0-9_]*(?::.*|\s.*)?$/)
  assert.doesNotMatch(lines[6], /['"`$\\]/)
})

test('session names stay within the terminal service limit', () => {
  assert.equal(openSession('toy-plan'), 'toy-plan-claude')
  assert.ok(openSession('x'.repeat(80)).length <= 64)
})

test('a new button goes just under the status item; an existing one stays put', () => {
  const text = openButtonText({ title: 'Toy Plan', slug: 'toy-plan', base: 'http://plan.localhost' })
  assert.deepEqual(openPlacement(plan(), text), { add: true, after: 'p' })
  assert.deepEqual(openPlacement({ story: [{ type: 'markdown', id: 'a', text: 'x' }] }, text), { add: true, after: 'a' })
  const moved = plan([{ type: 'terminal', id: 't', text }])
  assert.equal(findOpenButton(moved).index, 3)
  assert.deepEqual(openPlacement(moved, text), { add: false, existing: moved.story[3], edit: false })
  const stale = plan([{ type: 'terminal', id: 't', text: text.replace('Toy Plan', 'Old Plan') }])
  assert.equal(openPlacement(stale, text).edit, true)
  // a Do Phase button is not the Open Claude button
  assert.equal(findOpenButton(plan([{ type: 'terminal', id: 'd', text: 'BUTTON: show\nLABEL: Do Phase 1\nhi' }])), null)
})

test('envScript keeps only pids', () => {
  assert.equal(envScript([12, '34', 12, 'x; rm -rf ~', -1]), 'ps -E -o pid=,command= -p 12,34')
  assert.equal(envScript([]), '')
})

test('terminalsOf reads the session name off ZDOTDIR', () => {
  const ps = [
    '71130 claude TERM=xterm-256color ZDOTDIR=/Users/david/.cache/wiki-plugin-terminal/sessions/open-squad-plan-phase-1 HOME=/Users/david',
    '  850 claude ZDOTDIR=/Users/david/.cache/wiki-plugin-terminal/sessions/swamp-card-plan-phase-1',
    '66233 /Applications/Claude.app/claude HOME=/Users/david',
    '5 claude ZDOTDIR=/Users/david/.zsh',
  ].join('\n')
  const m = terminalsOf(ps)
  assert.equal(m.get(71130), 'open-squad-plan-phase-1')
  assert.equal(m.get(850), 'swamp-card-plan-phase-1')
  assert.equal(m.has(66233), false)
  assert.equal(m.has(5), false)
})

test('planOfSession takes the longest plan slug', () => {
  const slugs = ['swamp-card-plan', 'card-plan', 'swamp-card-plan-two']
  assert.deepEqual(planOfSession('swamp-card-plan-phase-4', slugs), { slug: 'swamp-card-plan', part: 'phase-4' })
  assert.deepEqual(planOfSession('swamp-card-plan-two-claude', slugs), { slug: 'swamp-card-plan-two', part: 'claude' })
  assert.equal(planOfSession('item-01915baee814f3c5', slugs), null)
})

test('sessionRows: waiting first, wiki sessions named by their terminal, the rest kept apart', () => {
  const agents = [
    { pid: 1, name: 'david-1a', status: 'idle', kind: 'interactive', startedAt: 10 },
    { pid: 2, name: 'david-98', status: 'waiting', kind: 'interactive', startedAt: 5 },
    { pid: 3, name: 'First column text wrapping', status: 'busy', kind: 'interactive', startedAt: 20 },
    { pid: 4, name: 'Gatekeeper Plan Phase 5', status: 'idle', kind: 'background', startedAt: 30 },
  ]
  const terminals = new Map([[1, 'toy-plan-phase-1'], [2, 'toy-plan-claude']])
  const { claude, other } = sessionRows({ agents, terminals, shells: { sessions: ['toy-plan-phase-1', 'toy-plan-claude', 'scratch', 'item-ab'], idle: ['scratch'] }, slugs: ['toy-plan'] })
  assert.deepEqual(claude.map(r => r.name), ['toy-plan-claude', 'First column text wrapping', 'Gatekeeper Plan Phase 5', 'toy-plan-phase-1'])
  assert.deepEqual(claude[0].plan, { slug: 'toy-plan', part: 'claude' })
  assert.equal(claude[1].terminal, null)
  assert.deepEqual(other, [{ name: 'scratch', state: 'shell', plan: null }, { name: 'item-ab', state: 'running', plan: null }])
})

test('planGuess reads a plan off a session name', () => {
  assert.deepEqual(planGuess('fieldguide-dns-plan-phase-5'), { slug: 'fieldguide-dns-plan', part: 'phase-5' })
  assert.deepEqual(planGuess('toy-plan-claude'), { slug: 'toy-plan', part: 'claude' })
  assert.deepEqual(planGuess('toy-plan'), { slug: 'toy-plan', part: '' })
  assert.equal(planGuess('item-01915baee814f3c5'), null)
  assert.equal(planGuess('open-squad-console'), null)
})
