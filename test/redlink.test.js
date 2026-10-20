// Red-link: find the plan's links with no page behind them and write their
// pages, the house meaning of "red-link this page". Since 0.7.0 each page is
// researched on the web through the door and written in full. Question links
// and the Open Questions section are never written. End to end on a throwaway
// farm with a stand-in `claude` behind the real shared door.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { planLinks, redLinksOf, parseResearch, researchedStory, researchedPage, asSlug, isUntouchedStub, storyAt } from '../src/client/core.js'

// These runs stand in for the Claude CLI: name Claude, not the coop default (0.10.0).
process.env.PLAN_MODEL = 'claude-opus-5-5'

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-stubs-'))
process.env.WIKI_WIP_DIR = scratch()
const { buildResearchContent } = await import('../api/prompt.js')
const { redlink, job } = await import('../api/handlers.js')

const md = (id, text) => ({ type: 'markdown', id, text })
const plan = () => ({
  title: 'Hook Plan',
  story: [
    md('a', 'Run the [[Webhook relay]] on the [[Pi5]], see [[Hook Plan]] and [[Is it safe?]] for the worry.'),
    { type: 'plan', id: 'p', text: 'STATUS' },
    md('h1', '# Phase 1\n> Stand up the relay.'),
    md('c1', '- [ ] Point the [[capability URL]] at [[Caddy]]'),
    md('f', '```\n[[Not A Link]]\n```\nThen [[Synapse]] answers.'),
    { type: 'code', id: 'k', text: '[[Code Link]]' },
    { type: 'timeline', id: 't', text: 'section Build\n2026-10-20 Relay Build #Phase1\n2026-10-21..2026-10-22 Pi5' },
    md('q', '# Open Questions\n> Made by hand.'),
    md('q1', '- [ ] [[Which relay?]] the [[Glossary Entry]] says'),
    md('s', '# See\n\n- [[Webhook relay]]\n- [[Welcome Visitors]]\n- [[About Hook Plugin]]'),
  ],
  journal: [{ type: 'create', date: 1, item: { title: 'Hook Plan', story: [] } }],
})

test('planLinks: wikilinks outside fences, timeline labels; code items hold none', () => {
  const titles = planLinks(plan()).map(l => l.title)
  assert.ok(titles.includes('Relay Build'), 'a timeline label, its #Group dropped')
  assert.ok(titles.includes('Synapse'))
  assert.ok(!titles.includes('Not A Link'), 'not inside a fence')
  assert.ok(!titles.includes('Code Link'), 'not from a code item')
  assert.ok(!titles.includes('Build'), 'a section name is not a link')
})

test('redLinksOf: red once each; questions, Open Questions, own title and known pages never', () => {
  const r = redLinksOf(plan(), new Set(['pi5', 'welcome-visitors', 'about-hook-plugin']))
  assert.deepEqual(r.red.map(x => x.title), ['Webhook relay', 'capability URL', 'Caddy', 'Synapse', 'Relay Build'])
  assert.deepEqual(r.questions, ['Is it safe?', 'Which relay?'])
  assert.deepEqual(r.held, ['Glossary Entry'])
  assert.equal(r.existing, 3)
  assert.equal(r.red[0].context, 'Run the [[Webhook relay]] on the [[Pi5]], see [[Hook Plan]] and [[Is it safe?]] for the worry.')
  assert.equal(r.red[1].section, 'Phase 1')
})

test('parseResearch: the TITLE line names the page when it is the same page as the link', () => {
  assert.deepEqual(parseResearch('TITLE: fx\n\nfx is a JSON viewer.', 'Fx'), { title: 'fx', body: 'fx is a JSON viewer.' })
  assert.deepEqual(parseResearch('TITLE: Something Else\n\nBody.', 'fx'), { title: 'fx', body: 'Body.' }, 'another page: the link words stand')
  assert.deepEqual(parseResearch('No title line.', 'fx'), { title: 'fx', body: 'No title line.' })
})

test('researchedStory: the opening line, the body as items, commands as terminal items, wiki links, the See', () => {
  let n = 0
  const id = () => `i${n++}`
  const body = 'fx is a terminal JSON viewer by Anton Medvedev.\n\n# fx\n> Not a page heading, a section.\n\nIt folds.\n\n# Install\n> One command.\n\n```bash\n$ brew install fx\n\n$ fx --version\n```\n\n```json\n{"a": 1}\n```\n\n# Links\n- [the repository](https://github.com/antonmedv/fx)\n- [https://fx.wtf fx.wtf]\n\n# See\n\n- [[Elsewhere]]'
  const st = researchedStory({ title: 'fx', body, planTitle: 'Hook Plan', model: 'claude-cli:claude-opus-5', date: '2026-10-17', id })
  assert.equal(st[0].text, "This page is AI generated: researched on the web by claude-opus-5 through the [[Plan Tool]]'s Red-link, 2026-10-17, for a link on [[Hook Plan]].")
  assert.deepEqual(st.map(i => i.type), ['markdown', 'markdown', 'markdown', 'markdown', 'markdown', 'terminal', 'code', 'markdown', 'markdown'])
  const listed = researchedStory({ title: 'fx', body: 'fx is a viewer.\n\n# What It Does\n> Shows JSON.\n\n- folds\n\n- searches\n- streams\n\n# Links\n\n- [https://a.org a]\n\n- [https://b.org b]', planTitle: 'Hook Plan', id })
  assert.deepEqual(listed.slice(1, -1).map(i => i.text), ['fx is a viewer.', '# What It Does\n> Shows JSON.', '- folds\n- searches\n- streams', '# Links\n- [https://a.org a]\n- [https://b.org b]'], 'a list is one item; Links takes its list')
  assert.equal(st[2].text, '# fx\n> Not a page heading, a section.', 'a heading with a strap is a section, kept')
  assert.equal(st[5].text, 'brew install fx\n\nfx --version', 'the fence kept whole, prompts dropped')
  assert.equal(st[6].text, '{"a": 1}')
  assert.equal(st[7].text, '# Links\n- [https://github.com/antonmedv/fx the repository]\n- [https://fx.wtf fx.wtf]')
  assert.equal(st.at(-1).text, '# See\n\n- [[Hook Plan]]')
  const page = researchedPage({ title: 'fx', body: 'fx is a viewer.', planTitle: 'Hook Plan', model: 'claude-cli:claude-opus-5', date: Date.UTC(2026, 9, 17), id })
  assert.equal(page.journal.length, 1)
  assert.match(page.journal[0].provenance, /^Researched on the web by claude-opus-5 through the Plan Tool's Red-link, for a red link on Hook Plan\.$/)
  assert.deepEqual(page.journal[0].item.story, page.story)
})

test('buildResearchContent: the plan, the link and its line, the site titles, the ask with tools named', () => {
  const r = redLinksOf(plan(), new Set(['pi5', 'welcome-visitors']))
  const link = r.red.find(x => x.title === 'capability URL')
  const { content } = buildResearchContent({ page: plan(), link, titles: ['Welcome Visitors'], origin: 'hooks.localhost' })
  assert.match(content, /<red-link title="capability URL" section="Phase 1">\n- \[ \] Point the \[\[capability URL\]\] at \[\[Caddy\]\]\n<\/red-link>/)
  assert.match(content, /Use WebSearch and WebFetch/)
  assert.match(content, /TITLE: /)
  assert.match(content, /\[https:\/\/example\.org\/page label\]/)
})

// A stand-in claude: records its arguments, answers for the link it was asked about.
const standIn = dir => {
  const bin = path.join(dir, 'claude')
  fs.writeFileSync(bin, `#!/bin/sh\necho "$*" >> "${dir}/args.log"\ncat > "${dir}/asked.txt"\nt=$(grep -o '<red-link title="[^"]*"' "${dir}/asked.txt" | head -1 | sed 's/.*title="//;s/"$//')\n[ "$t" = "Caddy" ] && { echo "nope" >&2; exit 3; }\nprintf 'TITLE: %s\\n\\n%s is a thing the plan uses, read from its site.\\n\\n# Links\\n- [https://example.org/%s %s]\\n' "$t" "$t" "$t" "$t"\n`, { mode: 0o755 })
  return bin
}
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('timed out')
}

test('redlink on a farm: each red link researched and written, one at a time; questions, existing pages and failures reported', async () => {
  const root = scratch()
  const extra = scratch()
  const site = path.join(root, 'hooks.localhost')
  for (const d of [path.join(site, 'pages'), path.join(site, 'status'), path.join(root, 'sister.localhost', 'pages'), path.join(extra, 'public.fish', 'pages')]) fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(site, 'pages', 'hook-plan'), JSON.stringify(plan(), null, 2))
  fs.writeFileSync(path.join(site, 'pages', 'welcome-visitors'), '{}')
  fs.writeFileSync(path.join(root, 'sister.localhost', 'pages', 'pi5'), '{}') // on a sibling site: not red
  fs.writeFileSync(path.join(extra, 'public.fish', 'pages', 'synapse'), '{}') // on an extra farm: not red
  process.env.WIKI_EXTRA_FARMS = extra
  const pkg = scratch() // an installed plugin's own page: not red
  fs.mkdirSync(path.join(pkg, 'wiki-plugin-hook', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(pkg, 'wiki-plugin-hook', 'pages', 'about-hook-plugin'), '{}')
  process.env.WIKI_PACKAGE_DIR = pkg
  const ctx = { origin: 'hooks.localhost', status: path.join(site, 'status'), farmRoot: root }
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(root, 'no-key')
  process.env.CLAUDE_DOOR_BIN = standIn(root)
  process.env.CLAUDE_DOOR_SCOPE_MEMORY = 'off'
  delete process.env.CLAUDE_DOOR_MODEL

  const started = await redlink({ slug: 'hook-plan', ...ctx })
  const done = await until(async () => {
    const j = await job({ id: started.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.deepEqual(done.meta.red, ['Webhook relay', 'capability URL', 'Caddy', 'Relay Build'])
  assert.deepEqual(done.meta.questions, ['Is it safe?', 'Which relay?'])
  assert.deepEqual(done.result.written.map(x => x.slug), ['webhook-relay', 'capability-url', 'relay-build'])
  assert.deepEqual(done.result.failed.map(x => x.slug), ['caddy'])
  assert.match(done.result.failed[0].error, /did not answer/)
  assert.deepEqual(done.progress, { n: 4, of: 4, title: 'Relay Build' })
  const args = fs.readFileSync(path.join(root, 'args.log'), 'utf8').trim().split('\n')
  assert.equal(args.length, 4, 'one question per red link')
  for (const a of args) assert.match(a, /--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch --disallowedTools Bash,/)
  const relay = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'webhook-relay'), 'utf8'))
  assert.equal(relay.title, 'Webhook relay')
  assert.match(relay.story[0].text, /^This page is AI generated: researched on the web/)
  assert.equal(relay.story[1].text, 'Webhook relay is a thing the plan uses, read from its site.')
  assert.equal(relay.story[2].text, '# Links\n- [https://example.org/Webhook relay Webhook relay]')
  assert.equal(relay.story.at(-1).text, '# See\n\n- [[Hook Plan]]')
  assert.ok(!fs.existsSync(path.join(site, 'pages', 'is-it-safe')), 'a question is never answered by the tool')
  assert.ok(!fs.existsSync(path.join(site, 'status', 'sitemap.json')), 'the index was reset')

  // Again: only Caddy, which failed, is red now.
  const again = await redlink({ slug: 'hook-plan', ...ctx })
  const second = await until(async () => {
    const j = await job({ id: again.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.deepEqual(second.meta.red, ['Caddy'])
  fs.writeFileSync(path.join(site, 'pages', 'caddy'), '{}')
  await assert.rejects(redlink({ slug: 'hook-plan', ...ctx }), e => e.status === 400 && /has no red links/.test(e.message) && /2 question links are left for their answers/.test(e.message))
  for (const k of ['WIKI_EXTRA_FARMS', 'WIKI_PACKAGE_DIR', 'CLAUDE_DOOR_SCOPE_MEMORY']) delete process.env[k]
})

test('redlink over its own untouched stubs: researched and written through the journal; an edited stub is a page', async () => {
  const root = scratch()
  const site = path.join(root, 'hooks.localhost')
  fs.mkdirSync(path.join(site, 'pages'), { recursive: true })
  fs.mkdirSync(path.join(site, 'status'), { recursive: true })
  const p = { title: 'Small Plan', story: [md('a', 'Use [[Caddy]] and the [[capability URL]].'), { type: 'plan', id: 'p', text: 'STATUS' }], journal: [{ type: 'create', date: 1, item: { title: 'Small Plan', story: [] } }] }
  fs.writeFileSync(path.join(site, 'pages', 'small-plan'), JSON.stringify(p))
  const stub = (title, extra = []) => {
    const story = [md('s1', 'This page is an AI generated [[Stub]]. A guess.'), md('s2', '# See\n\n- [[Stub]]\n- [[Small Plan]]')]
    return { title, story, journal: [{ type: 'create', item: { title, story }, date: 2, provenance: "AI generated stub for a red link on Small Plan, through the Plan Tool's Red-link by claude-opus-5." }, ...extra] }
  }
  fs.writeFileSync(path.join(site, 'pages', 'caddy'), JSON.stringify(stub('Caddy')))
  fs.writeFileSync(path.join(site, 'pages', 'capability-url'), JSON.stringify(stub('Capability URL', [{ type: 'edit', id: 's1', item: md('s1', 'David wrote this.'), date: 3 }])))
  assert.equal(isUntouchedStub(stub('Caddy')), true)
  assert.equal(isUntouchedStub(JSON.parse(fs.readFileSync(path.join(site, 'pages', 'capability-url'), 'utf8'))), false)
  const ctx = { origin: 'hooks.localhost', status: path.join(site, 'status'), farmRoot: root }
  process.env.CLAUDE_DOOR_KEY_FILE = path.join(root, 'no-key')
  const bin = path.join(root, 'claude')
  fs.writeFileSync(bin, "#!/bin/sh\ncat > /dev/null\nprintf 'TITLE: Caddy\\n\\nCaddy is a web server by the Caddy project.\\n\\n# Links\\n- [https://caddyserver.com caddyserver.com]\\n'\n", { mode: 0o755 })
  process.env.CLAUDE_DOOR_BIN = bin
  process.env.CLAUDE_DOOR_SCOPE_MEMORY = 'off'
  const started = await redlink({ slug: 'small-plan', ...ctx })
  const done = await until(async () => {
    const j = await job({ id: started.job, ...ctx })
    return j.status !== 'running' && j
  })
  assert.equal(done.status, 'done', done.error)
  assert.deepEqual(done.meta.red, ['Caddy'])
  assert.deepEqual(done.meta.stubs, ['Caddy'])
  assert.deepEqual(done.result.written.map(w => [w.slug, w.overStub]), [['caddy', true]])
  const caddy = JSON.parse(fs.readFileSync(path.join(site, 'pages', 'caddy'), 'utf8'))
  assert.match(caddy.story[0].text, /^This page is AI generated: researched on the web/)
  assert.equal(caddy.story[1].text, 'Caddy is a web server by the Caddy project.')
  assert.equal(caddy.journal[0].type, 'create', 'the stub stays in the history')
  assert.deepEqual(storyAt(caddy, 0), stub('Caddy').story, 'rev0 is the stub')
  assert.deepEqual(storyAt(caddy), caddy.story)
  assert.match(caddy.journal.at(-1).provenance, /over the stub it had written/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(site, 'pages', 'capability-url'), 'utf8')).story[0].text, 'This page is an AI generated [[Stub]]. A guess.', 'an edited stub is left alone')
  delete process.env.CLAUDE_DOOR_SCOPE_MEMORY
})
