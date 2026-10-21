// wiki-plugin-plan — the pure part: the item-text DSL and the plan rules.
//
// Nothing here touches the DOM or the network, so node's test runner can load
// it as is (test/core.test.js).
//
// The plan rules are COPIED from the fedwiki-plan-index skill's script
// (~/.claude/skills/fedwiki-plan-index/scripts/plan-index.py): is_plan_title,
// completion and modified there; is_plan_title, ticks and lastEdit here. The
// Plan Index board and this item must agree on what a plan is and how far
// along it is, so change both or neither.

// ---------- the item text ----------
//
// Line-oriented, the fedwiki-dsl convention: a line whose first word is an
// UPPERCASE command, an optional trailing colon allowed, is a command; every
// other line is the caption shown above the list. Phase 2 reuses this shape
// (audionote's parseItemText) when SUBJECT starts looking left.
//   SUBJECT        — the item is the Plan Tool: it reads the plan to its left
//   SITE domain    — list the plans of that site instead of this one
//   LIMIT n        — show at most n plans
//   SKILLS a, b    — on a plan's status item: the skills Do Next Phase and
//                    Revise Plan hand the model beside fedwiki-plan, read
//                    from ~/.claude/skills/<name>/SKILL.md on the machine the
//                    farm runs on (Phase 4); names split on commas or spaces,
//                    and several SKILLS lines add up
//   STATUS         — the status line, said out loud: on a plan page it reads
//                    exactly as a bare item does. It is the default text of a
//                    new plan item (DEFAULT_TEXT), because wiki-client removes
//                    an item whose text is saved empty: with STATUS there,
//                    opening the editor and saving never deletes the status
//                    line, and deleting the text is a deliberate act. An item
//                    with empty text (pages written before 0.5.0) still reads
//                    as the status line.
// subject is true only for an explicit SUBJECT line; face() below decides
// what a bare item does from the page it sits on. SKILLS and STATUS do not
// change the face: a status item that names skills is still the status line.
export const COMMANDS = ['SUBJECT', 'SITE', 'LIMIT', 'SKILLS', 'STATUS', 'MODELS', 'CONTEXT']

/** The text a new plan item carries, and the text an empty one is given when its editor opens. */
export const DEFAULT_TEXT = 'STATUS'

export const parse = text => {
  const out = { subject: false, status: false, models: false, context: 'fresh', site: null, limit: null, skills: [], caption: '', commands: 0 }
  const caption = []
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim()
    const [head = '', ...args] = line.split(/\s+/)
    const key = head.replace(/:$/, '')
    if (!COMMANDS.includes(key)) {
      caption.push(raw)
      continue
    }
    out.commands++
    if (key === 'SUBJECT') out.subject = true
    if (key === 'STATUS') out.status = true
    if (key === 'MODELS') out.models = true
    if (key === 'CONTEXT') out.context = /^carry$/i.test(args[0] || '') ? 'carry' : 'fresh'
    if (key === 'SITE') out.site = (args[0] || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null
    if (key === 'LIMIT') {
      const n = parseInt(args[0], 10)
      out.limit = Number.isFinite(n) && n > 0 ? n : null
    }
    if (key === 'SKILLS') {
      for (const name of args.join(' ').split(/[,\s]+/)) if (name && !out.skills.includes(name)) out.skills.push(name)
    }
  }
  out.caption = caption.join('\n').trim()
  return out
}

// ---------- what counts as a plan ----------
//
// plan-index.py: PLAN_TITLE_RE = r"\b(Plan|Roadmap)$". Python's \b is Unicode
// aware on str patterns and JavaScript's is ASCII only, so the boundary is
// spelled out: no letter, digit or underscore immediately before the word.
const PLAN_TITLE_RE = /(?<![\p{L}\p{N}_])(Plan|Roadmap)$/u

// plan-index.py: the reserved names of the Messy Planning convention —
// structural pages every planning site may carry, never listed as plans
// themselves. Only the two ending in Plan or Roadmap can collide with the
// title scan, and the Plan Index page itself is one of them.
const RESERVED_TITLES = new Set(['plan index', 'current plan'])

export const isPlanTitle = title => {
  // A malformed page (a title missing, or not a string) is not a plan, and
  // must never crash a scan of the site it sits on.
  if (typeof title !== 'string') return false
  const t = title.trim()
  if (RESERVED_TITLES.has(t.toLowerCase())) return false
  return PLAN_TITLE_RE.test(t)
}

// ---------- reading a plan page ----------

// plan-index.py: TASK_UNCHECKED_RE / TASK_CHECKED_RE, multiline.
const TASK_UNCHECKED_RE = /^\s*[-*]\s+\[ \]\s/gm
const TASK_CHECKED_RE = /^\s*[-*]\s+\[[xX]\]\s/gm
// plan-index.py: HEADING_RE and COUNT_SUFFIX_RE — a heading is one to six
// hashes then whitespace, so "#hashtag" prose is not mistaken for one.
const HEADING_RE = /^\s*#{1,6}\s/
const COUNT_SUFFIX_RE = /\s*[—-]\s*\d+\s*$/

const count = (re, text) => (text.match(re) || []).length
const markdown = page => (page && Array.isArray(page.story) ? page.story : []).filter(it => it && it.type === 'markdown')

// Ticks across every markdown item: the house format is one checkpoint per
// item, so a plan's checkpoints are spread over many items.
export const ticks = page => {
  let done = 0
  let open = 0
  for (const it of markdown(page)) {
    const text = it.text || ''
    done += count(TASK_CHECKED_RE, text)
    open += count(TASK_UNCHECKED_RE, text)
  }
  return { done, total: done + open }
}

// The label of a heading item, hashes and any "— 20" count stripped.
export const headingOf = it => {
  if (!it || it.type !== 'markdown') return null
  const first = (it.text || '').trim().split('\n')[0].trim()
  if (!HEADING_RE.test(first)) return null
  return first.replace(/^#+/, '').trim().replace(COUNT_SUFFIX_RE, '').trim()
}

// Unticked task lines inside the section headed "# Open Questions": from that
// heading item up to the next heading item of any level.
export const openQuestions = page => {
  const story = page && Array.isArray(page.story) ? page.story : []
  const start = story.findIndex(it => headingOf(it) === 'Open Questions')
  if (start === -1) return 0
  let n = 0
  for (let i = start; i < story.length; i++) {
    if (i > start && headingOf(story[i]) !== null) break
    if (story[i] && story[i].type === 'markdown') n += count(TASK_UNCHECKED_RE, story[i].text || '')
  }
  return n
}

// When the plan was last edited: its latest dated journal entry, the wiki's
// own record, which survives a sync that rewrites file times. The sitemap
// date is the fallback for a page whose journal carries no usable date.
export const lastEdit = (page, fallback = 0) => {
  const dates = (page && Array.isArray(page.journal) ? page.journal : [])
    .map(e => e && e.date)
    .filter(d => typeof d === 'number' && Number.isFinite(d))
  return dates.length ? Math.max(...dates) : fallback || 0
}

// Newest edit first; the title breaks ties so the order is stable.
export const byRecent = (a, b) =>
  b.modified - a.modified || (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0)

// One plan's row, from its sitemap entry and (when it could be read) its page.
//
// done/total are the state view's numbers, planState()'s phase checkpoints,
// so a plan reads the same fraction in the list as in its status line and on
// the Plan Tool (David's decision, Phase 3). Open Questions task lines are not
// in the total; their count is shown apart. ticks() above stays the Plan Index
// rule, which counts every task line on the page: the board and this list
// differ by design.
export const summarise = (entry, page) => {
  const st = page ? planState(page) : null
  return {
    title: entry.title,
    slug: entry.slug,
    modified: lastEdit(page, entry.date),
    read: !!page,
    done: st ? st.done : 0,
    total: st ? st.total : 0,
    questions: page ? openQuestions(page) : 0,
    // The Plan Index board's own count, every task line on the page (ticks()
    // above): what Check Plan Index compares the board against (Phase 5).
    all: page ? ticks(page) : null,
  }
}

// ======================================================================
// Phase 2 — the state of one plan, read off its page.
// ======================================================================

// ---------- which face the item shows ----------
//
// status  — a bare item (no SUBJECT, no SITE) on a plan page: that page's own
//           state, the status line a plan carries at its top.
// subject — SUBJECT, and the nearest real page to the left is a plan: that
//           plan's state, headed by its title.
// list    — everything else: SITE, SUBJECT with no plan to the left, or a bare
//           item on a page that is not a plan. The Phase 1 list.
export const face = (opts, { ownTitle = null, leftTitle = null } = {}) => {
  if (opts.models) return 'models'
  if (opts.site) return 'list'
  if (opts.subject) return isPlanTitle(leftTitle) ? 'subject' : 'list'
  return isPlanTitle(ownTitle) ? 'status' : 'list'
}

// ---------- models (0.10.0) ----------
//
// A short name for a model id, for the ⚙ chip and the Model Settings rows:
// openai:llm_auto-big → "coop · auto-big", claude-opus-5-5 → "Claude Opus 5.5",
// ollama:qwen3:4b → "Ollama · qwen3:4b"; '' is the farm's default.
export const modelLabel = id => {
  const m = String(id || '')
  if (!m) return 'farm default'
  if (m === 'auto') return 'auto'
  if (m.startsWith('openai:')) return `coop · ${m.slice(7).replace(/^llm_/, '')}`
  if (m.startsWith('ollama:')) return `Ollama · ${m.slice(7)}`
  const c = m.replace(/^claude-cli:/, '').match(/^claude-([a-z]+)-(\d+)-(\d+)$/)
  if (c) return `Claude ${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}.${c[3]}`
  return m
}

// ---------- Auto: how hard a run is (0.11.0; two tiers since 0.12.0) ----------
//
// With Auto chosen on Model Settings, the farm picks the model per run. This
// half decides the TIER from what the server already knows before it asks;
// the door's autoModel turns the tier into a model it can reach that holds
// the question. Deterministic, so the same run always picks the same tier.
//   tokens      the question, system prompt included (the door's estimate)
//   answers     answered open questions that go in
//   openPhases  phases with an unticked checkpoint: what a redraft may change
//   pages       pages of the site that go in whole (Revise Site)
//   action      Go Ahead's row: Amend, Rewrite or New; isPlan for the plan
//   queries     answers asked back ("*Answer: Explain more?*"): rewording
// weight = answers + openPhases/2 + queries (revise); answers + pages/8
// (counting at most 24 pages) + queries (site); 1/2/3 for Amend/New/Rewrite, +3 for the plan, + answers/2
// (one page of Go Ahead); checkpoints/2 + answers (next).
// David's rule (20 Oct 2026): we route the big runs to Claude ourselves; the
// small ones go to the coop, whose own router picks the model.
//   big      over AUTO.bigTokens (PLAN_AUTO_BIG_TOKENS on the farm),
//            AUTO.bigAnswers answers or more (Go Ahead excepted: every page
//            carries all the answers), a whole site, Go Ahead rewriting the
//            plan or a page, or a redraft weighing AUTO.heavyAt or more:
//            Claude (Fable 5.1 unless the farm names another)
//   light    everything else: the coop's router, llm_auto-big
export const AUTO = { heavyAt: 12, bigTokens: 48000, bigAnswers: 4 }
export const AUTO_RULE =
  "Auto picks per run: Claude Fable for big runs (over 48k tokens, 4+ answers, a whole site, or Go Ahead rewriting a page or the plan); the coop's own auto routing for everything smaller."

const ACTION_WEIGHT = { Amend: 1, New: 2, Rewrite: 3 }
const round1 = n => Math.round(n * 10) / 10

export const autoTier = ({ kind = 'revise', tokens = 0, answers = 0, openPhases = 0, pages = 0, action = '', isPlan = false, queries = 0, checkpoints = 0, bigTokens = AUTO.bigTokens } = {}) => {
  const weight = round1(
    kind === 'site'
      ? answers + Math.min(pages, 24) / 8 + queries
      : kind === 'apply'
        ? (ACTION_WEIGHT[action] || 1) + (isPlan ? 3 : 0) + answers / 2
        : kind === 'next'
          ? checkpoints / 2 + answers
          : answers + openPhases / 2 + queries,
  )
  const facts = [`${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens`, `${answers} answer${answers === 1 ? '' : 's'}`]
  if (kind === 'revise' && openPhases) facts.push(`${openPhases} open phase${openPhases === 1 ? '' : 's'}`)
  if (kind === 'site' && pages) facts.push(`${pages} page${pages === 1 ? '' : 's'}`)
  if (kind === 'apply') facts.push(isPlan ? `${action || 'Amend'} the plan` : action || 'Amend')
  if (kind === 'next' && checkpoints) facts.push(`${checkpoints} checkpoint${checkpoints === 1 ? '' : 's'}`)
  if (queries) facts.push(`${queries} asked back`)
  const big =
    tokens > bigTokens ||
    (kind !== 'apply' && answers >= AUTO.bigAnswers) ||
    kind === 'site' ||
    (kind === 'apply' && (isPlan || action === 'Rewrite')) ||
    (kind === 'revise' && weight >= AUTO.heavyAt)
  const tier = big ? 'big' : 'light'
  return { tier, weight, why: facts.join(', ') }
}

// The status line's words for an Auto pick: "auto → auto-big: 9k tokens, 2 answers (routes to
// glm-5.3-flash-pp)"; a big pick is named: "auto → claude-fable-5-1 (big): 52k tokens, 5 answers".
export const autoLine = auto => {
  if (!auto || !auto.model) return ''
  const name = String(auto.model).replace(/^(openai:llm_|openai:|ollama:|claude-cli:)/, '')
  const tier = auto.tier && auto.tier !== 'light' ? ` (${auto.tier})` : ''
  const c = auto.classifier
  const said = !c
    ? ''
    : c.tier
      ? ` · classifier ${c.decided ? 'said' : 'advised'} ${c.tier}${auto.ruled && c.tier !== auto.ruled ? `, the rule ${auto.ruled}` : ''}${c.reason ? `: ${c.reason}` : ''}`
      : c.skipped
        ? ` · classifier skipped: ${String(c.skipped).slice(0, 120)}`
        : ''
  return `auto → ${name}${tier}: ${auto.why}${auto.note ? ` (${auto.note})` : ''}${said}`
}

// A context window in tokens, short, as the model names say it: 262144 →
// "262K", 384000 → "384K", but 32768 → "32K" and 8192 → "8K".
export const windowLabel = n => {
  if (!n) return ''
  const k = n % 1024 === 0 && n <= 131072 ? n / 1024 : Math.round(n / 1000)
  return `${k}K`
}

// Tool pages the look-left walks past: audionote's TOOL_SLUGS (voice.js) plus
// this plugin's own Plan Tool, so a Voice Tool or the ☰ menu between the plan
// and the Plan Tool does not hide the plan.
export const TOOL_SLUGS = new Set(['selected-plugin-pages', 'voice-tool', 'search-tool', 'like-this-page', 'plan-tool', 'model-settings'])

// wiki-client's asSlug (lib/page.js): whitespace to hyphens, every other
// character outside [A-Za-z0-9-] deleted. The browser uses wiki.asSlug when it
// is there; this copy is for the tests and the fallback.
export const asSlug = title =>
  String(title || '')
    .replace(/\s/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .toLowerCase()

// Every [[Title]] in a text, in order, as written.
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g
export const wikilinksIn = text => [...String(text || '').matchAll(WIKILINK_RE)].map(m => m[1].trim()).filter(Boolean)

// The story cut into sections: a heading item and everything up to the next
// heading item. Items above the first heading form no section.
export const sections = page => {
  const story = page && Array.isArray(page.story) ? page.story : []
  const out = []
  for (const it of story) {
    const h = headingOf(it)
    if (h !== null) {
      const first = (it.text || '').trim().split('\n')[0].trim()
      out.push({ heading: h, line: first.replace(/^#+/, '').trim(), items: [it] })
    } else if (out.length) out[out.length - 1].items.push(it)
  }
  return out
}

const sectionTicks = sec => {
  let done = 0
  let open = 0
  for (const it of sec.items) {
    if (!it || it.type !== 'markdown') continue
    done += count(TASK_CHECKED_RE, it.text || '')
    open += count(TASK_UNCHECKED_RE, it.text || '')
  }
  return { done, total: done + open }
}

// ---------- open questions ----------
//
// The task lines of the Open Questions section that hold a [[question link]],
// a link whose title ends in "?". A question is ANSWERED in one of two ways:
//   by a page   a page exists behind its link — known is the set of slugs on
//               the plan's site and in the neighbourhood;
//   inline      the line itself carries the answer after the link, written
//               "*Answer: …*" (also _Answer: …_, **Answer:** …, Answer: …),
//               as on dns.private.fish/view/resource-map-plan.
// An inline answer that ends in "?" asks back ("Explain more?"): it is a
// QUERY, kept as `query`, and the question stays unanswered until it is
// rephrased or answered. The tick on the line is the author's own mark,
// reported alongside but never taken as the answer.
const TASK_LINE_RE = /^\s*[-*]\s+\[([ xX])\]\s(.*)$/
const INLINE_ANSWER_RE = /(?:^|\s)[*_]{0,2}Answer[*_]{0,2}\s*:\s*(?:[*_]{1,2}\s*)?(.*)$/i

/** The answer written on a question's line after its link, emphasis stripped; '' when there is none. */
export const inlineAnswer = rest => {
  const after = String(rest || '').replace(/^.*?\[\[[^\]]*\]\]/, '')
  const m = after.match(INLINE_ANSWER_RE)
  if (!m) return ''
  return m[1].replace(/[*_]+\s*$/, '').trim()
}

// One question line read: {title, slug, ticked, answered, by, answer, query}.
// by is 'page', 'inline' or null; a page behind the link wins over the line.
const readQuestion = (m, known, slug) => {
  const title = wikilinksIn(m[2]).find(t => t.endsWith('?'))
  if (!title) return null
  const s = slug(title)
  const said = inlineAnswer(m[2])
  const query = !!said && said.endsWith('?')
  const page = known.has(s)
  const inline = !!said && !query
  return {
    title,
    slug: s,
    ticked: m[1] !== ' ',
    answered: page || inline,
    by: page ? 'page' : inline ? 'inline' : null,
    answer: inline ? said : '',
    query: query ? said : '',
  }
}
// The items a page's questions are read from. A plan keeps them in its
// "# Open Questions" section; a page OF open questions (whole: true, the page a
// research site links from its plan as [[Open Questions]], Phase 7) keeps them
// anywhere on it, and its own Open Questions section is used when it has one.
const questionItems = (page, whole = false) => {
  const sec = sections(page).find(s => s.heading === 'Open Questions')
  if (sec) return sec.items
  return whole ? (page && Array.isArray(page.story) ? page.story : []) : []
}

export const questionsOf = (page, known = new Set(), slug = asSlug, { whole = false } = {}) => {
  const items = questionItems(page, whole)
  const out = []
  for (const it of items) {
    if (!it || it.type !== 'markdown') continue
    for (const line of (it.text || '').split('\n')) {
      const m = line.match(TASK_LINE_RE)
      if (!m) continue
      const q = readQuestion(m, known, slug)
      if (q) out.push(q)
    }
  }
  return out
}

// ---------- house lints ----------

// (b) A file named but not linked: a token with one of these extensions in a
// markdown item, outside any [url label] external link and any [[wikilink]].
const FILE_EXT = 'md|py|js|toml|json|sh|css|html|svg'
const FILE_RE = new RegExp(`(?<![\\w./-])[\\w][\\w./-]*\\.(?:${FILE_EXT})(?![\\w-])`, 'g')
export const unlinkedFiles = page => {
  const seen = new Set()
  for (const it of markdown(page)) {
    const bare = (it.text || '')
      .replace(/\[\[[^\]]*\]\]/g, ' ')
      .replace(/\[[a-z][a-z0-9+.-]*:\/\/[^\]\s]*(?:\s[^\]]*)?\]/gi, ' ') // [url label]
      .replace(/\[[^\]]*\]\([^)]*\)/g, ' ') // [label](url)
    for (const m of bare.matchAll(FILE_RE)) seen.add(m[0].replace(/^\.\//, ''))
  }
  return [...seen]
}

// (a) Every link title on the page: wikilinks and external-link labels.
export const linkTitles = page => {
  const titles = []
  for (const it of page && Array.isArray(page.story) ? page.story : []) {
    const text = String((it && it.text) || '')
    titles.push(...wikilinksIn(text))
    for (const m of text.matchAll(/\[[a-z][a-z0-9+.-]*:\/\/[^\]\s]*\s([^\]]+)\]/gi)) titles.push(m[1].trim())
  }
  return titles
}

// (c) Scatter, the lineage rule COPIED from the fedwiki-plan-index skill's
// plan-lint.py audit(): copies of one title on several sites are clean when
// they account for each other through fork events. A copy is accounted for if
// its own journal forks from another site in the group, or another copy in the
// group forks from its site. copies: [{site, forks: Set of fork sites}].
export const audit = copies => {
  const sites = new Set(copies.map(c => c.site))
  const forkedFrom = new Set()
  for (const c of copies) for (const f of c.forks) if (sites.has(f)) forkedFrom.add(f)
  const clean = []
  const scattered = []
  for (const c of copies) {
    const knowsOrigin = [...c.forks].some(f => sites.has(f) && f !== c.site)
    ;(knowsOrigin || forkedFrom.has(c.site) ? clean : scattered).push(c)
  }
  return { clean, scattered }
}

export const forkSites = page =>
  new Set((page && Array.isArray(page.journal) ? page.journal : []).filter(e => e && e.type === 'fork' && e.site).map(e => e.site))

// The demo a Conclusion names, "The demo is [[Title]].", the line Finish Plan
// writes (Phase 5); it satisfies the no-Demo lint whatever the title ends in.
const DEMO_LINE_RE = /The demo is \[\[([^\]]+)\]\]/
export const namedDemo = page => {
  for (const it of markdown(page)) {
    const m = String(it.text || '').match(DEMO_LINE_RE)
    if (m) return m[1].trim()
  }
  return ''
}

// ---------- the Open Questions page (Phase 7) ----------
//
// A research site (fedwiki-research-site) keeps its questions on a page of
// their own, titled Open Questions and linked from the plan's See section, so
// each can be dragged and each answer spoken through the Voice Tool. The plan
// links it; that link is how the tool finds it: a [[link]] on the plan whose
// slug is open-questions. Answers {title, slug} or null.
export const OPEN_QUESTIONS_SLUG = 'open-questions'
export const openQuestionsLink = (page, slug = asSlug) => {
  for (const it of page && Array.isArray(page.story) ? page.story : []) {
    for (const t of wikilinksIn(it && it.text)) if (slug(t) === OPEN_QUESTIONS_SLUG) return { title: t, slug: OPEN_QUESTIONS_SLUG }
  }
  return null
}

/** The plan's own questions, then the linked Open Questions page's, once each by slug; each says where it was read. */
export const allQuestions = (page, linked = null, known = new Set(), slug = asSlug) => {
  const out = questionsOf(page, known, slug).map(q => ({ ...q, on: 'plan' }))
  const seen = new Set(out.map(q => q.slug))
  if (linked) {
    for (const q of questionsOf(linked, known, slug, { whole: true })) {
      if (seen.has(q.slug)) continue
      seen.add(q.slug)
      out.push({ ...q, on: OPEN_QUESTIONS_SLUG })
    }
  }
  return out
}

// ---------- the state view ----------
//
// planState(page, known) — everything the status and subject faces show.
//   phases     each "# " section holding at least one checkpoint, Open
//              Questions excepted: {line, done, total}
//   next       index into phases of the first with an unticked checkpoint,
//              or -1 when the plan is complete
//   blockers   of the next phase: its unanswered questions and the red links
//              inside its section
//   questions  every question line, answered by a page existing or by an
//              answer written on the line; queried ones carry `query`
//   lints      short sentences, only those triggered (scatter is added by the
//              caller, which has to fetch the other copies)
// linked: the page the plan links as [[Open Questions]] (Phase 7), when the
// caller has read it; its questions join the plan's own, once each.
export const planState = (page, known = new Set(), slug = asSlug, linked = null) => {
  const phases = sections(page)
    .filter(s => s.heading !== 'Open Questions')
    .map(s => ({ ...s, ...sectionTicks(s) }))
    .filter(s => s.total > 0)
  const next = phases.findIndex(p => p.done < p.total)
  const questions = allQuestions(page, linked, known, slug)
  const unanswered = questions.filter(q => !q.answered)

  let redLinks = []
  if (next !== -1) {
    const seen = new Set()
    for (const it of phases[next].items) {
      for (const t of wikilinksIn(it && it.text)) {
        const s = slug(t)
        if (s && !known.has(s) && !seen.has(s)) {
          seen.add(s)
          redLinks.push({ title: t, slug: s })
        }
      }
    }
  }

  const lints = []
  const done = phases.reduce((n, p) => n + p.done, 0)
  const total = phases.reduce((n, p) => n + p.total, 0)
  if (total > 0 && done === total && !linkTitles(page).some(t => /Demo$/.test(t)) && !namedDemo(page))
    lints.push('Every checkpoint is ticked but nothing on the page links a Demo.')
  const files = unlinkedFiles(page)
  if (files.length) lints.push(`Named but not linked: ${files.join(', ')}.`)

  return {
    title: page && page.title,
    phases: phases.map(({ line, done, total }) => ({ line, done, total })),
    done,
    total,
    next,
    complete: phases.length > 0 && next === -1,
    blockers: next === -1 ? { questions: [], redLinks: [] } : { questions: unanswered, redLinks },
    questions,
    answered: questions.length - unanswered.length,
    answeredInline: questions.filter(q => q.by === 'inline').length,
    queried: questions.filter(q => q.query).length,
    ticked: questions.filter(q => q.ticked).length,
    lints,
  }
}

// ---------- page actions ----------
//
// Whether the Plan Tool may offer to trash the page to its left. The usual
// way to delete a page, forking its creation ghost, needs revision 0 to open
// from the journal's first action; a page whose first action is a fork (the
// New plugin's create-from-a-twin, the interlink seed) opens the remote copy
// from that action instead, so rev0 is never reached and the fork button
// never deletes. The tool offers the server's own DELETE instead, which moves
// the page to the site's recycler. Only an origin page that is really on this
// site qualifies: not a remote copy, not a ghost, not a browser-local draft,
// not a recycled page, not a revision view.
export const trashable = ({ site = null, host = '', ghost = false, local = false, recycler = false, id = '' } = {}) => {
  if (ghost) return { ok: false, why: 'a ghost page is not on this site' }
  if (local) return { ok: false, why: 'a local draft lives in the browser, not on the site' }
  if (recycler) return { ok: false, why: 'already in the recycler' }
  if (/_rev\d+$/.test(String(id || ''))) return { ok: false, why: 'a revision view, not the page' }
  const origin = !site || ['view', 'origin', 'local', host].includes(site)
  if (!origin) return { ok: false, why: `a copy from ${site}; trash it on that site` }
  return { ok: true, why: '' }
}


// ======================================================================
// Phase 3 — Update Plan, the pure part. The farm handler (api/handlers.js)
// does the file IO, the WIP claim and the index reset around these.
// ======================================================================

// ---------- ticking answered questions ----------
//
// Every unticked Open Questions task line that is answered, by a page behind
// its ?-link (known, the slugs that exist) or by an answer written on the
// line (a query, an answer ending in "?", is not one), is ticked, "- [ ]" to "- [x]", in that item's
// text. One journal edit per item changed, shaped as the wiki itself journals
// an edit: {type, id, item, date}, no site. Returns a new page; the one given
// is not touched.
export const tickAnswered = (page, known = new Set(), slug = asSlug, now = () => Date.now(), { whole = false } = {}) => {
  const out = JSON.parse(JSON.stringify(page || {}))
  out.story = Array.isArray(out.story) ? out.story : []
  out.journal = Array.isArray(out.journal) ? out.journal : []
  const items = questionItems(out, whole)
  const ticked = []
  {
    for (const it of items) {
      if (!it || it.type !== 'markdown' || !it.id) continue
      let changed = false
      const lines = String(it.text || '').split('\n').map(line => {
        const m = line.match(TASK_LINE_RE)
        if (!m || m[1] !== ' ') return line
        const q = readQuestion(m, known, slug)
        if (!q || !q.answered) return line
        changed = true
        ticked.push({ id: it.id, title: q.title, slug: q.slug, by: q.by })
        return line.replace('[ ]', '[x]')
      })
      if (!changed) continue
      it.text = lines.join('\n')
      out.journal.push({ type: 'edit', id: it.id, item: { ...it }, date: now() })
    }
  }
  const unanswered = questionsOf(out, known, slug, { whole })
    .filter(q => !q.answered)
    .map(({ title, slug, query }) => (query ? { title, slug, query } : { title, slug }))
  return { page: out, ticked, unanswered }
}

// ---------- the plan's markdown asset ----------
//
// A faithful port of the fedwiki-plan skill's plan-md.py render(): the page
// back to markdown, so the plan carries its own source in its assets folder.
// test/render.test.js checks this against the Python byte for byte.
//   markdown, paragraph   as is; a run of one-checkpoint items kept as one list
//   code, terminal        fenced (terminal tagged bash)
//   timeline, mermaid     fenced with their DSL, so the roadmap survives as text
//   assets                skipped: it points at the folder the file lives in
//   image                 ![caption](url)
//   anything else         a one-line placeholder naming the type
// then the create entry's provenance, and runs of blank lines collapsed.
const FENCED = { code: '', terminal: 'bash', timeline: 'timeline', mermaid: 'mermaid' }
const PASSTHROUGH = new Set(['markdown', 'paragraph'])
const CHECKPOINT_RE = /^[-*] \[( |x|X)\] /
// Python's str.rstrip() with no argument: trailing Unicode whitespace, which
// is what String.prototype.trimEnd removes (the two lists differ only in
// \x1c-\x1f and ﻿, which no plan page carries).
const rstrip = s => String(s).trimEnd()
// An f-string's view of a JSON value: null prints as None, as it does there.
const pyStr = v => (v === null ? 'None' : String(v))

export const planMarkdown = page => {
  const p = page || {}
  const out = [`# ${p.title === undefined ? 'Untitled' : pyStr(p.title)}`, '']
  for (const item of Array.isArray(p.story) ? p.story : []) {
    const it = item || {}
    const kind = it.type || ''
    const text = rstrip(it.text || '')
    if (kind === 'assets') continue
    if (PASSTHROUGH.has(kind)) {
      if (text) {
        if (CHECKPOINT_RE.test(text) && out.length >= 2 && out[out.length - 1] === '' && CHECKPOINT_RE.test(out[out.length - 2])) out.pop()
        out.push(text, '')
      }
    } else if (Object.prototype.hasOwnProperty.call(FENCED, kind)) {
      out.push(rstrip('```' + FENCED[kind]), text, '```', '')
    } else if (kind === 'image') {
      const cap = text || it.caption || ''
      out.push(`![${pyStr(cap)}](${it.url === undefined ? '' : pyStr(it.url)})`, '')
    } else {
      out.push(`*[${kind} item]*`, '')
    }
  }
  const journal = Array.isArray(p.journal) ? p.journal : []
  const create = journal.find(e => e && e.type === 'create' && e.provenance)
  if (create) out.push('---', '', `*${create.provenance}*`, '')
  const lines = []
  let blank = false
  for (const line of out) {
    if (line === '') {
      if (blank) continue
      blank = true
    } else blank = false
    lines.push(line)
  }
  return rstrip(lines.join('\n')) + '\n'
}


// ======================================================================
// Phase 4 — Do Next Phase and Revise Plan, the pure part. The farm handler
// (api/handlers.js) claims the WIP marker and calls the Claude door around
// these; the client opens the answer as a ghost page with them; and the demo
// saved its report page through the same functions.
// ======================================================================

// ---------- which skills ----------
//
// fedwiki-plan always, then whatever the plan's own plan items name on a
// SKILLS line, in order, once each. A name is a skill folder's name: letters,
// digits, hyphens and underscores, so it can never climb out of the skills
// folder. Others are returned apart, to be reported and skipped.
export const DEFAULT_SKILLS = ['fedwiki-plan']
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
export const skillsOf = page => {
  const named = []
  for (const it of page && Array.isArray(page.story) ? page.story : []) {
    if (it && it.type === 'plan') named.push(...parse(it.text).skills)
  }
  const all = [...new Set([...DEFAULT_SKILLS, ...named])]
  return { skills: all.filter(n => SKILL_NAME_RE.test(n)), refused: all.filter(n => !SKILL_NAME_RE.test(n)) }
}

// ---------- the phase ----------
//
// The phases as planState counts them (sections holding a checkpoint, Open
// Questions excepted), each with its checkpoints read line by line and the id
// of the last item holding one — where a report's link goes.
const phaseNumber = heading => {
  const m = String(heading || '').match(/^Phase\s+(\d+)\b/i)
  return m ? parseInt(m[1], 10) : null
}

export const phasesOf = page =>
  sections(page)
    .filter(s => s.heading !== 'Open Questions')
    .map(s => {
      const checkpoints = []
      let lastItemId = null
      for (const it of s.items) {
        if (!it || it.type !== 'markdown') continue
        let here = false
        for (const line of String(it.text || '').split('\n')) {
          const m = line.match(TASK_LINE_RE)
          if (!m) continue
          here = true
          checkpoints.push({ id: it.id, text: m[2].trim(), done: m[1] !== ' ', line: line.trim() })
        }
        if (here) lastItemId = it.id
      }
      const first = String(s.items[0].text || '').trim().split('\n')
      const strap = (first.find((l, i) => i > 0 && /^\s*>/.test(l)) || '').replace(/^\s*>\s*/, '').trim()
      const number = phaseNumber(s.heading)
      return {
        heading: s.heading,
        label: number === null ? s.heading : `Phase ${number}`,
        number,
        strap,
        headingId: s.items[0].id,
        checkpoints,
        lastItemId,
        done: checkpoints.filter(c => c.done).length,
        total: checkpoints.length,
      }
    })
    .filter(p => p.total > 0)

// The phase a run is for: `phase` given as a number (Phase N) or a heading,
// else the next, the first with an unticked checkpoint. null when there is
// none: no such phase, or every checkpoint ticked.
export const choosePhase = (page, phase) => {
  const phases = phasesOf(page)
  if (phase === undefined || phase === null || phase === '') return phases.find(p => p.done < p.total) || null
  const want = String(phase).trim()
  if (/^\d+$/.test(want)) return phases.find(p => p.number === parseInt(want, 10)) || null
  const low = want.toLowerCase()
  return phases.find(p => p.heading.toLowerCase() === low || p.label.toLowerCase() === low) || null
}

// ---------- the ghost page ----------

export const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10)

/**
 * "<Plan Title> Phase N Report" for Do Next Phase. Revise Plan answers the
 * plan's own title (Phase 8): the revision is a ghost of the same page, and
 * Save writes it over the plan, journaled.
 */
export const reportTitle = ({ kind, planTitle, phaseLabel = '', date = today() }) =>
  kind === 'revise' || kind === 'terms' || kind === 'redlink' ? planTitle : `${planTitle} ${phaseLabel} Report`

/**
 * Markdown as separately draggable items: each paragraph its own item, each
 * top-level bullet its own item with anything nested beneath it. COPIED from
 * wiki-plugin-audionote's splitMarkdown (client/voice.js), the Voice Tool's
 * rule for a summary, so a report reads as a spoken note does. A heading with
 * its strap line directly beneath stays one item, the house heading.
 */
export const splitMarkdown = markdown => {
  const blocks = []
  for (const chunk of String(markdown || '').trim().split(/\n\s*\n/)) {
    const lines = chunk.split('\n')
    const isList = lines.every(l => /^\s*([-*+]|\d+[.)])\s/.test(l) || /^\s+\S/.test(l))
    if (!isList) {
      blocks.push(chunk.trim())
      continue
    }
    let current = null
    for (const line of lines) {
      if (/^([-*+]|\d+[.)])\s/.test(line)) {
        if (current) blocks.push(current)
        current = line
      } else current = current === null ? line : `${current}\n${line}`
    }
    if (current) blocks.push(current)
  }
  return blocks.filter(Boolean)
}

const randomHex = () => {
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The story of a report or revision ghost: a provenance line saying who wrote
 * it and that nothing was ticked, the model's markdown one item per point, and
 * a "# See" item linking back to the plan. audionote's spokenItems shape.
 */
// A heading and the "> " strap the model set a blank line beneath it are one
// house heading item, as fedwiki-page writes them.
export const joinStraps = blocks => {
  const out = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    if (prev !== undefined && /^\s*>\s/.test(b) && /^#{1,6}\s/.test(prev) && !prev.includes('\n')) out[out.length - 1] = `${prev}\n${b}`
    else out.push(b)
  }
  return out
}

export const reportItems = ({ kind, markdown, planTitle, phaseLabel = '', model = '', date = today(), id = randomHex }) => {
  const item = text => ({ type: 'markdown', id: id(), text })
  const what = kind === 'revise' ? 'Revise Plan' : `Do Next Phase for ${phaseLabel}`
  const by = model ? ` by ${model.replace(/^claude-cli:/, '')}` : ''
  const after =
    kind === 'revise'
      ? 'It is a draft beside the plan: the plan itself was not changed.'
      : 'Its proposed ticks are proposals: nothing on the plan was ticked.'
  return [
    item(`Written${by} through the [[Plan Tool]]'s ${what} on [[${planTitle}]], ${date}. ${after}`),
    ...joinStraps(splitMarkdown(markdown)).map(item),
    item(`# See\n\n- [[${planTitle}]]`),
  ]
}

// ---------- proposed ticks ----------
//
// The bullets of the report's "# Proposed Ticks" section, matched back to the
// phase's checkpoints by their words. Never applied: the report lists them.
const words = t => String(t || '').replace(/^\s*[-*+]\s+/, '').replace(/^\[[ xX]\]\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase()
export const proposedTicks = (markdown, checkpoints = []) => {
  const lines = String(markdown || '').split('\n')
  const at = lines.findIndex(l => /^\s*#\s+Proposed Ticks\b/i.test(l))
  if (at === -1) return { found: false, listed: [], matched: [], none: false }
  const listed = []
  for (const line of lines.slice(at + 1)) {
    if (/^\s*#{1,6}\s/.test(line)) break
    if (/^\s*[-*+]\s/.test(line)) listed.push(line.replace(/^\s*[-*+]\s+/, '').trim())
  }
  const none = !listed.length || (listed.length === 1 && /^none\.?$/i.test(listed[0]))
  const want = new Set(listed.map(words))
  const matched = checkpoints.filter(c => want.has(words(c.text)))
  return { found: true, listed: none ? [] : listed, matched, none }
}

// ---------- where the link goes ----------
//
// A report's [[link]] goes immediately after the last item of its phase that
// holds a checkpoint; a revision's after the last item of the See section;
// either, failing that, at the end of the story. Answers the item id to add
// after (null for an empty story).
export const linkAfter = (page, { kind, phase } = {}) => {
  const story = page && Array.isArray(page.story) ? page.story : []
  if (kind !== 'revise') {
    const p = choosePhase(page, phase)
    if (p && p.lastItemId) return p.lastItemId
  } else {
    const see = sections(page).find(s => /^see$/i.test(s.heading))
    if (see) return see.items[see.items.length - 1].id
  }
  return story.length ? story[story.length - 1].id : null
}

/** The add the wiki client journals for one new item: {type, id, item, after, date}. */
export const addAction = (item, after, date = Date.now()) => ({ type: 'add', id: item.id, item: { ...item }, after, date })


// ======================================================================
// Phase 5 — Finish Plan, Answer a question and Check Plan Index, the pure
// part. The farm handler (api/handlers.js, finish) does the file IO, the WIP
// claim, the demo lookup and the index reset around these; the client hands
// a question to the Voice Tool and compares the board with the live plans.
// ======================================================================

// ---------- Finish Plan ----------

// The Finish form's guess at the demo page: the one an existing Conclusion
// names, else the first title the page links that ends in Demo, the rule the
// "no Demo" lint reads.
export const demoCandidate = page => namedDemo(page) || linkTitles(page).find(t => /Demo$/.test(t)) || ''

/**
 * Why Finish Plan must not write, or null. Every phase checkpoint ticked
 * (planState's phases; the Open Questions are not phases), a conclusion and a
 * demo title given. The demo page's existence is the handler's to check: it
 * needs the farm's files.
 */
export const finishRefusal = (page, { conclusion, demo } = {}) => {
  const st = planState(page)
  if (!st.total) return `${(page && page.title) || 'this page'} has no checkpoints to finish`
  if (!st.complete) {
    const open = phasesOf(page).flatMap(p => p.checkpoints.filter(c => !c.done).map(c => `${p.label}: ${c.text}`))
    const shown = open.slice(0, 3).join('; ') + (open.length > 3 ? `; and ${open.length - 3} more` : '')
    return `${st.total - st.done} of ${st.total} checkpoints of ${page.title} are still unticked (${shown}); Finish Plan waits for every one`
  }
  if (!String(conclusion || '').trim()) return 'a conclusion is required: what the plan delivered, in a paragraph or two'
  const d = String(demo || '').trim()
  if (!d) return 'a demo page title is required: the page that shows the finished work'
  if (/\[\[|\]\]|\n/.test(d)) return `a demo page title is a title, not a link or several lines: ${d}`
  return null
}

const SEE_RE = /^see$/i
const LIST_LINE_RE = /^\s*[-*]\s/m

/**
 * Write the Conclusion section and the See link, as the wiki would journal
 * them. The Conclusion goes immediately above # See (the fedwiki-plan end
 * matter: body, Files, Links, Assets, Conclusion, See), or at the end when
 * there is no See; an existing Conclusion section has its body replaced, item
 * by item. Its items: the heading "# Conclusion", the conclusion one item per
 * paragraph, then "The demo is [[Demo]].". "- [[Demo]]" joins the See list
 * unless the section already links it. Returns a new page and the journal
 * actions written; the page given is not touched.
 */
export const writeConclusion = (page, { conclusion, demo, slug = asSlug, id = randomHex, now = () => Date.now() } = {}) => {
  const out = JSON.parse(JSON.stringify(page || {}))
  out.story = Array.isArray(out.story) ? out.story : []
  out.journal = Array.isArray(out.journal) ? out.journal : []
  const story = out.story
  const actions = []
  const record = a => {
    out.journal.push(a)
    actions.push(a)
  }
  const add = (item, after) => record({ type: 'add', id: item.id, item: { ...item }, after, date: now() })
  const edit = item => record({ type: 'edit', id: item.id, item: { ...item }, date: now() })
  const title = String(demo).trim()
  const texts = [
    ...String(conclusion || '')
      .trim()
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean),
    `The demo is [[${title}]].`,
  ]
  const indexOfHeading = test => story.findIndex(it => {
    const h = headingOf(it)
    return h !== null && test(h)
  })
  const bodyEnd = start => {
    let i = start + 1
    while (i < story.length && headingOf(story[i]) === null) i++
    return i
  }

  // The Conclusion.
  const at = indexOfHeading(h => h === 'Conclusion')
  let replaced = false
  const ids = []
  if (at !== -1) {
    replaced = true
    const head = story[at]
    if (String(head.text || '').trim() !== '# Conclusion') {
      head.text = '# Conclusion'
      edit(head)
    }
    ids.push(head.id)
    const old = story.slice(at + 1, bodyEnd(at))
    let prev = head.id
    texts.forEach((text, i) => {
      if (i < old.length) {
        const it = old[i]
        if (it.type !== 'markdown' || it.text !== text) {
          it.type = 'markdown'
          it.text = text
          edit(it)
        }
        prev = it.id
        ids.push(it.id)
      } else {
        const it = { type: 'markdown', id: id(), text }
        story.splice(story.findIndex(x => x.id === prev) + 1, 0, it)
        add(it, prev)
        prev = it.id
        ids.push(it.id)
      }
    })
    for (const it of old.slice(texts.length)) {
      story.splice(story.findIndex(x => x.id === it.id), 1)
      record({ type: 'remove', id: it.id, date: now() })
    }
  } else {
    const see = indexOfHeading(h => SEE_RE.test(h))
    let pos = see === -1 ? story.length : see
    let prev = pos > 0 ? story[pos - 1].id : null
    for (const text of ['# Conclusion', ...texts]) {
      const it = { type: 'markdown', id: id(), text }
      story.splice(pos++, 0, it)
      add(it, prev)
      prev = it.id
      ids.push(it.id)
    }
  }

  // The See link.
  const want = slug(title)
  const see = indexOfHeading(h => SEE_RE.test(h))
  let seeAdded = false
  if (see === -1) {
    const it = { type: 'markdown', id: id(), text: `# See\n\n- [[${title}]]` }
    const prev = story.length ? story[story.length - 1].id : null
    story.push(it)
    add(it, prev)
    seeAdded = true
  } else {
    const items = story.slice(see, bodyEnd(see))
    const linked = items.some(it => wikilinksIn(it && it.text).some(t => slug(t) === want))
    if (!linked) {
      const list = [...items].reverse().find(it => it.type === 'markdown' && LIST_LINE_RE.test(String(it.text || '')))
      if (list) {
        list.text = `${String(list.text).replace(/\s+$/, '')}\n- [[${title}]]`
        edit(list)
      } else {
        const it = { type: 'markdown', id: id(), text: `- [[${title}]]` }
        const last = items[items.length - 1]
        story.splice(story.findIndex(x => x.id === last.id) + 1, 0, it)
        add(it, last.id)
      }
      seeAdded = true
    }
  }
  return { page: out, actions, conclusion: { replaced, ids, items: texts.length + 1 }, see: { added: seeAdded } }
}

// ---------- Answer a question ----------
//
// Where the Voice Tool reads the question it is to wait for: a sessionStorage
// key, read and removed by wiki-plugin-audionote (client/main.js, findRed)
// when it paints its "a page it is waiting for" select.
export const WAITING_FOR_KEY = 'audionote.waitingFor'

// ---------- Check Plan Index ----------
//
// The board as fedwiki-plan-index's plan-index.py writes it: a local plan is
// a markdown line "- [ ] [[Title]] · 20/23 · 29 Jul" ("[x]" when complete,
// "no checkpoints" when it has none); a plan on another site, and a rolled-up
// site's index, is a reference item whose text is "site · 7/39 · 21 Aug".
// PLAN_LINE_RE there, read line by line here so a block of lines still reads.
const BOARD_LINE_RE = /^\s*[-*]\s+\[([ xX])\]\s*\[\[(.+?)\]\]\s*(?:·(.*))?$/
const progressOf = tail => {
  const m = String(tail || '').match(/(\d+)\s*\/\s*(\d+)/)
  if (m) return { done: parseInt(m[1], 10), total: parseInt(m[2], 10) }
  if (/no checkpoints/.test(String(tail || ''))) return { done: 0, total: 0 }
  return null
}
export const boardEntries = (...pages) => {
  const plans = []
  const refs = []
  for (const page of pages) {
    for (const it of page && Array.isArray(page.story) ? page.story : []) {
      if (!it) continue
      if (it.type === 'reference' && it.site && it.slug) {
        refs.push({ site: it.site, slug: it.slug, title: it.title || it.slug, ...(progressOf(it.text) || { done: null, total: null }) })
        continue
      }
      if (it.type !== 'markdown') continue
      for (const line of String(it.text || '').split('\n')) {
        const m = line.match(BOARD_LINE_RE)
        if (!m) continue
        const p = progressOf(m[3])
        plans.push({ title: m[2].trim(), box: m[1] !== ' ', board: (page && page.title) || '', ...(p || { done: null, total: null }) })
      }
    }
  }
  return { plans, refs }
}

const frac = (done, total) => (total ? `${done}/${total}` : done === null || done === undefined ? 'no count' : 'no checkpoints')

/**
 * The board against the live plans. live: rows of the list face, each with
 * the board's own count (all, every task line on the page: plan-index.py's
 * completion(), ticks() above), so a fraction that differs has really moved
 * and is not just the list's phases-only rule. Answers what the laptop skill
 * would change: plans missing from the board, plans on it that no longer
 * exist, fractions that moved (from and to), plans newly complete.
 */
export const compareIndex = ({ plans = [], refs = [] } = {}, live = [], slug = asSlug) => {
  const onBoard = new Map()
  for (const p of plans) if (!onBoard.has(slug(p.title))) onBoard.set(slug(p.title), p)
  const missing = []
  const moved = []
  const complete = []
  const unreadable = []
  let same = 0
  const seen = new Set()
  for (const r of live) {
    const s = r.slug || slug(r.title)
    seen.add(s)
    const b = onBoard.get(s)
    if (!r.read || !r.all) {
      if (b) unreadable.push({ title: r.title, slug: s })
      else missing.push({ title: r.title, slug: s, to: null })
      continue
    }
    const to = frac(r.all.done, r.all.total)
    if (!b) {
      missing.push({ title: r.title, slug: s, to })
      continue
    }
    const nowComplete = r.all.total > 0 && r.all.done === r.all.total
    const wasComplete = b.box || (b.total > 0 && b.done === b.total)
    if (b.done !== r.all.done || b.total !== r.all.total) moved.push({ title: r.title, slug: s, from: frac(b.done, b.total), to, board: b.board })
    else same++
    if (nowComplete && !wasComplete) complete.push({ title: r.title, slug: s, to })
  }
  const gone = [...onBoard.entries()].filter(([s]) => !seen.has(s)).map(([s, b]) => ({ title: b.title, slug: s, from: frac(b.done, b.total), board: b.board }))
  return { missing, gone, moved, complete, unreadable, unchanged: same, listed: plans.length, elsewhere: refs.length }
}


// ======================================================================
// Phase 7 — Revise Site, the pure part. The farm handlers (api/handlers.js,
// reviseSite and applyRevision) do the file IO, the WIP claim and the door
// calls around these; the client opens the proposal as a ghost with them.
// ======================================================================

// ---------- whose page it is ----------

/**
 * The credit block wiki-client draws, COPIED from fedwiki-lib's
 * credited_sites (itself a port of wiki-client lib/license.js authors()): the
 * journal read backwards, a site or attribution re-pointing the credit for
 * everything before it. Anything other than host in the answer is a site the
 * page credits.
 */
export const creditedSites = (page, host) => {
  let site = host
  const done = new Set()
  const out = []
  const journal = page && Array.isArray(page.journal) ? page.journal : []
  for (let i = journal.length - 1; i >= 0; i--) {
    const a = journal[i]
    if (!a || typeof a !== 'object') continue
    if (a.site) site = a.site
    if (a.attribution && a.attribution.site) site = a.attribution.site
    if (a.type !== 'fork' && !done.has(site)) {
      out.push(site)
      done.add(site)
    }
  }
  return out
}

/**
 * Why Revise Site must leave a page alone, or null: forked from another site
 * (a fork entry naming a site other than this one; the site-less fork a saved
 * ghost carries is not one), or credited to another site by its journal.
 */
export const foreignOf = (page, host) => {
  const forks = [...forkSites(page)].filter(s => s && s !== host)
  if (forks.length) return `forked from ${forks.join(', ')}`
  const others = creditedSites(page, host).filter(s => s && s !== host)
  if (others.length) return `credited to ${others.join(', ')}`
  return null
}

// ---------- tables ----------

const PIPE_LINE_RE = /^\s*\|.*\|\s*$/
const PIPE_RULE_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

/** A block that is a markdown pipe table: every line a |row|, the second the |---| rule. */
export const isPipeTable = block => {
  const lines = String(block || '').trim().split('\n')
  return lines.length >= 2 && lines.every(l => PIPE_LINE_RE.test(l)) && PIPE_RULE_RE.test(lines[1])
}

const cells = line =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(c => c.trim())

/** The rows of the first pipe table in a text (a table item's or a markdown item's), as {header: value} objects. */
export const pipeRows = text => {
  const lines = String(text || '').split('\n')
  const at = lines.findIndex((l, i) => PIPE_LINE_RE.test(l) && i + 1 < lines.length && PIPE_RULE_RE.test(lines[i + 1]))
  if (at === -1) return []
  const head = cells(lines[at]).map(h => h.toLowerCase())
  const rows = []
  for (const line of lines.slice(at + 2)) {
    if (!PIPE_LINE_RE.test(line)) break
    const c = cells(line)
    rows.push(Object.fromEntries(head.map((h, i) => [h, c[i] === undefined ? '' : c[i]])))
  }
  return rows
}

/** A pipe table as a Table Plugin item's text: CAPTION, LAYOUT table, the table. The form fortytwo.fish's proposal uses. */
export const tableText = (table, caption = '') => [...(caption ? [`CAPTION ${caption}`] : []), 'LAYOUT table', '', String(table).trim()].join('\n')

// ---------- the proposal ----------

export const PROPOSAL_TITLE = 'Revision Proposal'
export const ACTIONS = ['Keep', 'Amend', 'Rewrite', 'New']
const bare = t => String(t || '').replace(/\*\*|__|`/g, '').replace(/^\[\[|\]\]$/g, '').trim()

/** The table's action, normalised to one of ACTIONS, or the word as written when it is not one. */
export const actionOf = word => {
  const w = bare(word).toLowerCase()
  return ACTIONS.find(a => a.toLowerCase() === w) || bare(word)
}

/**
 * The proposal's ghost items: a provenance line, the model's markdown one item
 * per paragraph, heading or bullet (reportItems' rule), every pipe table a
 * Table Plugin item, and See back to the plan. Each - [ ] name its own item,
 * so a name is ticked where it stands.
 */
export const proposalItems = ({ markdown, planTitle, site = '', model = '', date = today(), id = randomHex }) => {
  const item = (text, type = 'markdown') => ({ type, id: id(), text })
  const by = model ? ` by ${model.replace(/^claude-cli:/, '')}` : ''
  const blocks = joinStraps(splitMarkdown(markdown))
  return [
    item(
      `Written${by} through the [[Plan Tool]]'s Revise Site on [[${planTitle}]], ${date}, from the answered open questions. ` +
        'Nothing has been written yet. Pause keeps this page and writes nothing else; Go Ahead rewrites the pages the table names, one at a time, the plan last. ' +
        'A name under Names is copied to no other page until its box is ticked.',
    ),
    ...blocks.map(b => (isPipeTable(b) ? item(tableText(b, `Proposed revision of ${site || 'this site'}, ${date}`), 'table') : item(b))),
    item(`# See\n\n- [[${planTitle}]]`),
  ]
}

const sectionText = (page, test) => {
  const sec = sections(page).find(s => test(s.heading.toLowerCase()))
  if (!sec) return null
  return sec.items
    .slice(1)
    .map(it => String((it && it.text) || ''))
    .filter(Boolean)
}

const DASH_SPLIT_RE = /\s+[—–]\s+|\s+-\s+/

/**
 * Read a saved proposal page back: the tone shift, the table's rows in order
 * (a table item's, or a pipe table in a markdown item), the Untouched titles
 * and the Names with whether each box is ticked.
 */
export const parseProposal = page => {
  const story = page && Array.isArray(page.story) ? page.story : []
  const toneParts = sectionText(page, h => h.startsWith('the tone shift') || h === 'tone shift') || []
  const tone = toneParts.filter(t => !/^\s*>/.test(t)).join('\n\n').trim()

  let rows = []
  for (const it of story) {
    if (!it || (it.type !== 'table' && it.type !== 'markdown')) continue
    const r = pipeRows(it.text)
    if (r.length && 'page' in r[0] && 'action' in r[0]) {
      rows = r.map(x => ({ page: bare(x.page), action: actionOf(x.action), reason: x.reason || '' }))
      break
    }
  }

  const untouched = []
  for (const text of sectionText(page, h => h === 'untouched') || []) {
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*[-*+]\s+(.*)$/)
      if (!m) continue
      const link = wikilinksIn(m[1])[0]
      const title = link || bare(m[1].split(DASH_SPLIT_RE)[0])
      if (title) untouched.push(title)
    }
  }

  const names = []
  for (const text of sectionText(page, h => h === 'names') || []) {
    for (const line of text.split('\n')) {
      const m = line.match(TASK_LINE_RE)
      if (!m) continue
      const [who, ...rest] = m[2].split(DASH_SPLIT_RE)
      const name = bare(who)
      if (!name) continue
      names.push({ name, answer: bare(rest.join(' — ')), confirmed: m[1] !== ' ' })
    }
  }
  return { tone, rows, untouched, names }
}

/** Whether a proposal page says it has been applied (applyRevision's closing line). */
export const APPLIED_RE = /^Applied through the \[\[Plan Tool\]\]'s Go Ahead/
export const proposalApplied = page => (page && Array.isArray(page.story) ? page.story : []).some(it => it && APPLIED_RE.test(String(it.text || '')))

// ---------- names ----------

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The names that occur in a text, whole words, any case. */
export const namesIn = (text, names) =>
  names.filter(n => n && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'iu').test(String(text || '')))

const pageText = page => (page && Array.isArray(page.story) ? page.story : []).map(it => String((it && it.text) || '')).join('\n')

/**
 * The unconfirmed names a revised page would carry to it: in the new story,
 * and not already on the page as it stood. A name already there was not
 * copied by this revision.
 */
export const namesCopied = (before, after, names) => {
  const was = pageText(before)
  return namesIn(pageText(after), names).filter(n => !namesIn(was, [n]).length)
}

// ---------- one page through the door and back ----------

// A non-markdown item is shown to the door as a keep line, its id inside, and
// its text beneath in a fence for reading; the reply puts the keep line where
// the item belongs and the item comes back whole. The door never rewrites a
// table, a timeline, a diagram, an assets or an audio item.
const KEEP_LINE_RE = /^\s*\{\{keep ([a-zA-Z0-9]+)\}\}\s*$/
const keepLine = it => `{{keep ${it.id}}}`
const TEXT_TYPES = new Set(['markdown', 'paragraph'])

/** The page as the door reads it: markdown items as they are, every other item a keep line with its type and text fenced beneath. */
export const doorMarkdown = page => {
  const out = []
  for (const it of page && Array.isArray(page.story) ? page.story : []) {
    if (!it) continue
    const text = String(it.text || '').trimEnd()
    if (TEXT_TYPES.has(it.type)) {
      if (text) out.push(text)
    } else if (it.id) out.push(`${keepLine(it)}\n\`\`\`${it.type}\n${text}\n\`\`\``)
  }
  return out.join('\n\n')
}

const isSeeItem = it => it && it.type === 'markdown' && /^see$/i.test(headingOf(it) || '')

/**
 * The new story from the door's reply. Keep lines bring their old items back
 * (and the fence the door may have copied beneath one is dropped). A heading
 * repeating the title as the first block is dropped: no H1 opener. Every pipe
 * table becomes a Table Plugin item. A non-markdown item the reply did not
 * place is never dropped: it goes back after the nearest item before it that
 * survived, else at its old index; never after See. See is moved last.
 */
export const storyFromReply = (old, reply, { id = randomHex } = {}) => {
  const story = old && Array.isArray(old.story) ? old.story.filter(Boolean) : []
  const byId = new Map(story.map(it => [it.id, it]))
  const texts = new Map()
  for (const it of story) if (TEXT_TYPES.has(it.type) && !texts.has(String(it.text || '').trim())) texts.set(String(it.text || '').trim(), it)

  // Fences directly beneath a keep line are the door copying what it was shown.
  const cleaned = []
  const lines = String(reply || '').replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    cleaned.push(lines[i])
    if (KEEP_LINE_RE.test(lines[i]) && /^\s*```/.test(lines[i + 1] || '')) {
      let j = i + 2
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) j++
      i = j
    }
  }

  let blocks = joinStraps(splitMarkdown(cleaned.join('\n')))
  const title = String((old && old.title) || '').trim().toLowerCase()
  if (blocks.length && /^#\s/.test(blocks[0]) && blocks[0].replace(/^#+\s*/, '').split('\n')[0].trim().toLowerCase() === title && !blocks[0].includes('\n')) blocks = blocks.slice(1)

  // "# See" and the bullets beneath it are one item, the house See section,
  // however the reply spaced them.
  const joined = []
  for (let i = 0; i < blocks.length; i++) {
    if (/^#\s+See\s*$/i.test(blocks[i].split('\n')[0]) && !/^\s*[-*+]\s/m.test(blocks[i])) {
      const list = []
      while (i + 1 < blocks.length && /^\s*[-*+]\s/.test(blocks[i + 1])) list.push(blocks[++i])
      joined.push(list.length ? `${blocks[i - list.length]}\n\n${list.join('\n')}` : blocks[i])
    } else joined.push(blocks[i])
  }
  blocks = joined

  const out = []
  const used = new Set()
  for (const b of blocks) {
    const keep = b.split('\n').map(l => l.match(KEEP_LINE_RE))
    if (keep.every(Boolean)) {
      for (const m of keep) {
        const it = byId.get(m[1])
        if (it && !used.has(it.id)) {
          used.add(it.id)
          out.push(it)
        }
      }
      continue
    }
    if (isPipeTable(b)) {
      out.push({ type: 'table', id: id(), text: tableText(b) })
      continue
    }
    const same = texts.get(b.trim())
    if (same && !used.has(same.id)) {
      used.add(same.id)
      out.push(same)
      continue
    }
    out.push({ type: 'markdown', id: id(), text: b })
  }

  const seeAt = out.findIndex(isSeeItem)
  if (seeAt !== -1 && seeAt !== out.length - 1) out.push(...out.splice(seeAt, 1))

  // Never drop a non-markdown item.
  story.forEach((it, k) => {
    if (TEXT_TYPES.has(it.type) || used.has(it.id)) return
    used.add(it.id)
    let at = -1
    for (let b = k - 1; b >= 0 && at === -1; b--) at = out.findIndex(x => x.id === story[b].id)
    let pos = at === -1 ? Math.min(k, out.length) : at + 1
    const see = out.findIndex(isSeeItem)
    if (see !== -1 && pos > see) pos = see
    out.splice(pos, 0, it)
  })
  return out
}

/**
 * The journal for a page written whole: remove for each old item gone, then
 * for each new item in order an add after its predecessor, or an edit where
 * it takes the place of an old item under the same heading line, and a move
 * for each item replaying those would leave out of place. Each entry carries the
 * provenance (and `extra`'s fields). The wiki's own shapes: {type, id, item,
 * after, date}. keepIds writes newStory exactly as given, ids and all: a
 * reconcile.
 */
export const reviseJournal = (oldStory, newStory, { provenance = '', date = Date.now(), keepIds = false, extra = null } = {}) => {
  const old = (oldStory || []).filter(Boolean)
  const next = (newStory || []).filter(Boolean)
  const oldIds = new Set(old.map(it => it.id))
  const newIds = new Set(next.map(it => it.id))
  const stamp = e => ({ ...e, ...(provenance ? { provenance } : {}), ...(extra ? { ...extra } : {}) })
  const actions = []

  // A new markdown item that opens with the same heading line as an old one
  // that is gone is that item edited: it keeps the old id.
  const firstLine = it => String((it && it.text) || '').trim().split('\n')[0].trim()
  const gone = old.filter(it => !newIds.has(it.id))
  const goneHeadings = new Map()
  for (const it of gone) if (it.type === 'markdown' && headingOf(it) !== null && !goneHeadings.has(firstLine(it))) goneHeadings.set(firstLine(it), it)
  const story = next.map(it => {
    if (keepIds || oldIds.has(it.id) || it.type !== 'markdown' || headingOf(it) === null) return it
    const was = goneHeadings.get(firstLine(it))
    if (!was) return it
    goneHeadings.delete(firstLine(it))
    return { ...it, id: was.id }
  })
  const finalIds = new Set(story.map(it => it.id))

  const replay = old.map(it => it.id)
  for (const it of old) {
    if (finalIds.has(it.id)) continue
    actions.push(stamp({ type: 'remove', id: it.id, date }))
    replay.splice(replay.indexOf(it.id), 1)
  }
  const oldText = new Map(old.map(it => [it.id, JSON.stringify(it)]))
  story.forEach((it, i) => {
    const after = i === 0 ? null : story[i - 1].id
    if (!oldIds.has(it.id)) {
      actions.push(stamp({ type: 'add', id: it.id, item: { ...it }, after, date }))
      const at = after === null ? 0 : replay.indexOf(after) + 1
      replay.splice(at, 0, it.id)
    } else if (oldText.get(it.id) !== JSON.stringify(it)) {
      actions.push(stamp({ type: 'edit', id: it.id, item: { ...it }, date }))
    }
  })
  // The wiki's move takes one item to just after its predecessor in order
  // (wiki-client lib/revision.js), so a reorder is one move per item out of place.
  const order = story.map(it => it.id)
  order.forEach((want, i) => {
    if (replay[i] === want) return
    actions.push(stamp({ type: 'move', id: want, order, date }))
    replay.splice(replay.indexOf(want), 1)
    replay.splice(i, 0, want)
  })
  return { story, actions }
}

/** Every [[link]] a page carries. */
export const linksOf = page => [...new Set((page && Array.isArray(page.story) ? page.story : []).flatMap(it => wikilinksIn(it && it.text)))]


// ======================================================================
// Phase 8 — Revise Plan revises the same page. The redraft opens as a ghost
// with the plan's own title carrying the whole page; Save over the plan
// writes it with reviseJournal, so the version it replaces is the plan's
// _rev<N>, one click back. Rewind writes nothing: it opens that rev, as the
// journal holds it, as a ghost beside the plan, and the wiki's own fork of
// the ghost is the rewind. The farm handler (saveRevision in
// api/handlers.js) does the IO and the WIP claim around the save.
// ======================================================================

/** The ghost's first line, which Save drops: it says what the ghost is. */
export const REVISE_LINE_RE = /^Proposed (?:revision of|links on|red links on) \[\[[^\]]+\]\] through the \[\[Plan Tool\]\]'s (?:Revise Plan|Create Red Links|Red-link)/

const firstLineOf = it => String((it && it.text) || '').trim().split('\n')[0].trim()
const isHeadingItem = it => !!it && TEXT_TYPES.has(it.type) && headingOf({ ...it, type: 'markdown' }) !== null
const TAIL_RE = /^(assets|see)$/i

/**
 * A plan's story in three: its `plan` items (the status line), the tail the
 * tool keeps as it is (the Assets and See sections, and any assets item), and
 * the body the model redrafts, everything else in order.
 */
export const planParts = page => {
  const story = page && Array.isArray(page.story) ? page.story.filter(Boolean) : []
  const plans = []
  const body = []
  const tail = []
  let inTail = false
  for (const it of story) {
    if (it.type === 'plan') {
      plans.push(it)
      continue
    }
    if (isHeadingItem(it)) inTail = TAIL_RE.test(headingOf({ ...it, type: 'markdown' }))
    ;(inTail || it.type === 'assets' ? tail : body).push(it)
  }
  return { plans, body, tail }
}

// What the model was told to leave out and may write anyway: the status line
// as planMarkdown renders it, a fenced copy of a kept item, an Assets or See
// section. The tool keeps the plan's own.
const PLACEHOLDER_RE = /^\*\[[\w-]+ item\]\*$/
const FENCE_TYPES = new Set(Object.values(FENCED).filter(Boolean))
const modelExtra = (it, oldIds) => {
  if (oldIds.has(it.id) || !TEXT_TYPES.has(it.type)) return false
  const text = String(it.text || '').trim()
  if (PLACEHOLDER_RE.test(text)) return true
  const fence = text.match(/^```(\w+)/)
  if (fence && FENCE_TYPES.has(fence[1])) return true
  return isHeadingItem(it) && TAIL_RE.test(headingOf({ ...it, type: 'markdown' }))
}

/**
 * The revise ghost's story: the line saying what it is, then the plan as it
 * would be after Save — the redraft's opener, the plan's own `plan` item
 * second, the rest of the redraft (storyFromReply, as Revise Site builds a
 * page) with the plan's timeline and other non-text items back in their
 * sections, and the plan's Assets and See sections unchanged at the end.
 */
// ---------- what a redraft dropped (0.10.0) ----------
//
// A smaller model's redraft can come back whole in shape but without the
// Open Questions (measured 20 Oct 2026: GLM-5.3 Flash on the Mood Board Plan
// kept 36 of 36 checkpoints and 0 of 9 questions). Saved, that deletes the
// questions the plan is revised from. So the ghost says, before Save, which
// question links and how many task lines the redraft lost.
const QUESTION_LINK = /\[\[([^\]]+\?)\]\]/g
const TASK_LINE = /^\s*[-*] \[[ xX]\]/gm
const textOf = story => (story || []).filter(it => TEXT_TYPES.has(it.type)).map(it => String(it.text || '')).join('\n')
export const revisionLosses = (page, story) => {
  const before = textOf(page && page.story)
  const after = textOf(story)
  const qs = text => [...new Set([...text.matchAll(QUESTION_LINK)].map(m => m[1]))]
  const kept = new Set(qs(after))
  const lostQuestions = qs(before).filter(q => !kept.has(q))
  const tasks = { before: (before.match(TASK_LINE) || []).length, after: (after.match(TASK_LINE) || []).length }
  const parts = []
  if (lostQuestions.length) {
    const shown = lostQuestions.slice(0, 3).map(q => `"${q}"`).join(', ')
    parts.push(`it drops ${lostQuestions.length} of the plan's ${qs(before).length} questions (${shown}${lostQuestions.length > 3 ? ', …' : ''})`)
  }
  if (tasks.after < tasks.before) parts.push(`it has ${tasks.after} task lines where the plan has ${tasks.before}`)
  return { lostQuestions, tasks, warning: parts.length ? `${parts.join('; ')}. Revise again with a stronger model (⚙), or save and add them back by hand.` : '' }
}

export const reviseItems = ({ page, markdown, model = '', date = today(), id = randomHex }) => {
  const title = String((page && page.title) || '')
  const { plans, body, tail } = planParts(page)
  const oldIds = new Set(body.map(it => it.id))
  const out = storyFromReply({ title, story: body }, markdown, { id }).filter(it => !modelExtra(it, oldIds))

  // A non-text item goes back into the section it was in, as many text items
  // in as it was.
  let heading = null
  let since = 0
  const where = new Map()
  for (const it of body) {
    if (isHeadingItem(it)) {
      heading = firstLineOf(it)
      since = 0
    } else if (!TEXT_TYPES.has(it.type)) where.set(it.id, { heading, since })
    else since++
  }
  for (const [iid, w] of where) {
    if (w.heading === null) continue
    const from = out.findIndex(x => x.id === iid)
    if (from === -1) continue
    const [moved] = out.splice(from, 1)
    const at = out.findIndex(x => isHeadingItem(x) && firstLineOf(x) === w.heading)
    if (at === -1) {
      out.splice(from, 0, moved)
      continue
    }
    let pos = at + 1
    let n = 0
    while (pos < out.length && !isHeadingItem(out[pos]) && (n < w.since || !TEXT_TYPES.has(out[pos].type))) {
      if (TEXT_TYPES.has(out[pos].type)) n++
      pos++
    }
    out.splice(pos, 0, moved)
  }

  const by = model ? ` by ${String(model).replace(/^claude-cli:/, '')}` : ''
  const lost = revisionLosses(page, out)
  const line = {
    type: 'markdown',
    id: id(),
    text:
      `Proposed revision of [[${title}]] through the [[Plan Tool]]'s Revise Plan${by}, ${date}. Save over the plan writes this page, less this line, over [[${title}]] in place through its journal: the version it replaces stays in the journal as its _rev, and Rewind opens that beside the plan to fork back.` +
      (lost.warning ? `\n\n**Check before you save:** ${lost.warning}` : ''),
  }
  const opener = out.length && TEXT_TYPES.has(out[0].type) && !isHeadingItem(out[0]) ? [out.shift()] : []
  return [line, ...opener, ...plans.map(it => ({ ...it })), ...out, ...tail.map(it => ({ ...it }))]
}

/** The story Save writes: the ghost's, less its first line. */
export const revisedStory = story => (Array.isArray(story) ? story : []).filter((it, i) => !(i === 0 && it && REVISE_LINE_RE.test(String(it.text || ''))))

// ---------- the journal, replayed ----------
//
// COPIED from wiki-client lib/revision.js (apply, create): the story a
// journal gives, up to and including entry `upto`, as /view/<slug>_rev<N>
// draws it.
const applyAction = (story, action) => {
  const order = () => story.map(it => it && it.id)
  const add = (after, item) => story.splice(order().indexOf(after) + 1, 0, item)
  const remove = () => {
    const i = order().indexOf(action.id)
    if (i !== -1) story.splice(i, 1)
  }
  switch (action.type) {
    case 'create':
      if (action.item && action.item.story) return action.item.story.slice()
      return story
    case 'add':
      add(action.after, action.item)
      return story
    case 'edit': {
      const i = order().indexOf(action.id)
      if (i !== -1) story.splice(i, 1, action.item)
      else story.push(action.item)
      return story
    }
    case 'move': {
      const at = action.order.indexOf(action.id)
      const after = action.order[at - 1]
      const item = story[order().indexOf(action.id)]
      remove()
      add(after, item)
      return story
    }
    case 'remove':
      remove()
      return story
    default:
      return story
  }
}

/** The story the journal gives up to entry `upto` (all of it by default). */
export const storyAt = (page, upto = Infinity) => {
  const journal = page && Array.isArray(page.journal) ? page.journal : []
  let story = []
  for (const a of journal.slice(0, upto === Infinity ? undefined : upto + 1)) story = applyAction(story, a || {})
  return story
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export const RECONCILE_NOTE = 'Journal reconciled by the Plan Tool before a revision: the page had been written without journal entries, so these bring the journal level with the story it holds.'

/**
 * A journal that replays to the story the page holds. A page written by a
 * script may hold a story its journal does not give; its _rev would then not
 * be the page as it was. The entries that bring it level (keepIds, so the
 * story is exactly the page's), or none when it is level already.
 */
export const reconcileJournal = (page, { date = Date.now() } = {}) => {
  const story = page && Array.isArray(page.story) ? page.story.filter(Boolean) : []
  const replay = storyAt(page)
  if (same(replay, story)) return []
  return reviseJournal(replay, story, { provenance: RECONCILE_NOTE, date, keepIds: true }).actions
}

/** The rev label and its slug: "<Plan Title>_rev<N>", "<slug>_rev<N>". */
export const revLabel = (title, n) => `${title}_rev${n}`
export const revSlug = (title, n, slug = asSlug) => `${slug(title)}_rev${n}`

/**
 * The page after Save over the plan: reconciled first, then the new story
 * journaled with reviseJournal. `previous` is the rev that is the page as it
 * was; every entry carries `planTool` so the status line can say when it was
 * revised and link that rev. Throws when replaying would not give
 * back the old story at `previous` and the new story at the end: nothing to
 * write then.
 */
// 'redlink' is the 0.5.0 name of 'terms', kept so a journal written then still reads.
export const REVISION_KINDS = ['revise', 'terms', 'redlink']

export const writeRevision = (page, story, { model = '', date = Date.now(), kind = 'revise' } = {}) => {
  if (!REVISION_KINDS.includes(kind)) throw new Error(`not a kind of revision: ${kind}`)
  const before = page && Array.isArray(page.story) ? page.story.filter(Boolean) : []
  const reconcile = reconcileJournal(page, { date })
  const journal = [...((page && page.journal) || []), ...reconcile]
  const previous = journal.length - 1
  const who = model ? ` by ${String(model).replace(/^claude-cli:/, '')}` : ''
  const provenance =
    kind === 'terms' || kind === 'redlink'
      ? `Linked through the Plan Tool's Create Red Links${who}: terms a reader may not know made [[links]], saved over the plan; the version it replaces is ${revLabel(page.title, previous)}.`
      : `Revised through the Plan Tool's Revise Plan${who}, saved over the plan; the version it replaces is ${revLabel(page.title, previous)}.`
  const extra = { planTool: { kind, previous, ...(model ? { model: String(model).replace(/^claude-cli:/, '') } : {}) } }
  const r = reviseJournal(before, story, { provenance, date, extra })
  if (!r.actions.length) return { page, actions: [], reconcile, previous, changed: false }
  const out = { ...page, story: r.story, journal: [...journal, ...r.actions] }
  if (!same(storyAt(out, previous), before)) throw new Error(`the journal would not give back the plan as it was at ${revLabel(page.title, previous)}`)
  if (!same(storyAt(out), out.story)) throw new Error('the journal would not replay to the revised story')
  return { page: out, actions: r.actions, reconcile, previous, changed: true }
}

/**
 * Rewind's ghost: the plan as the journal holds it at entry n, what
 * /view/<slug>_rev<n> draws (storyAt is wiki-client's revision.js create),
 * with the journal up to that entry, under the plan's own title. Nothing is
 * written: the wiki's own fork of this ghost is the rewind, as forking a
 * revision opened from the journal is.
 */
export const rewindPage = (page, n) => {
  const journal = page && Array.isArray(page.journal) ? page.journal : []
  if (!Number.isInteger(n) || n < 0 || n >= journal.length) return null
  return { title: page.title, story: storyAt(page, n), journal: journal.slice(0, n + 1) }
}

/** The last revision the Plan Tool saved over the plan: {kind, date, model, previous}, or null. */
export const lastRevision = page => {
  const journal = page && Array.isArray(page.journal) ? page.journal : []
  for (let i = journal.length - 1; i >= 0; i--) {
    const a = journal[i]
    if (a && a.planTool && Number.isInteger(a.planTool.previous) && a.planTool.previous < i) return { ...a.planTool, date: a.date }
  }
  return null
}


// ======================================================================
// Red-link (0.6.0): the links on the plan with no page behind them, stubbed.
// ======================================================================
//
// What the house has always meant by "red-link this page" (the
// fedwiki-stub-page skill): find the links that go nowhere and write the
// missing pages. Since 0.7.0 each page is researched on the web and written
// in full, not stubbed (David, 17 Oct: "the whole point is to describe what
// fx is in full detail"). A link is red when no page with
// its slug is on this site or on any other site the farm can see. Never
// stubbed, because an answer page is a person's act and a page behind a
// question marks it answered:
//   a question link, a title ending in "?", wherever it is;
//   anything under the "# Open Questions" heading, made by hand.
// Links are read from markdown, paragraph and html items, outside ``` fences,
// and from timeline event labels (fedwiki.py's from_timeline). Code and
// terminal items hold no links.

const QUESTIONS_RE = /^open questions$/i
const TIMELINE_EVENT_RE = /^(\d{4}-\d{2}-\d{2})(?:\.\.\d{4}-\d{2}-\d{2})?\s+(.*)$/
const LINK_ITEM_TYPES = new Set(['markdown', 'paragraph', 'html'])

/** Every link a plan offers, in story order: {title, kind, context, section, held}. */
export const planLinks = page => {
  const out = []
  let section = ''
  let held = false
  for (const it of page && Array.isArray(page.story) ? page.story : []) {
    if (!it || typeof it.text !== 'string') continue
    const h = headingOf(it)
    if (h !== null) {
      section = h
      held = QUESTIONS_RE.test(h)
    }
    if (LINK_ITEM_TYPES.has(it.type)) {
      let fenced = false
      for (const line of it.text.split('\n')) {
        if (/^\s*```/.test(line)) {
          fenced = !fenced
          continue
        }
        if (fenced) continue
        for (const title of wikilinksIn(line)) out.push({ title, kind: 'wikilink', context: line.trim(), section, held })
      }
    } else if (it.type === 'timeline') {
      for (const raw of it.text.split('\n')) {
        const m = raw.trim().match(TIMELINE_EVENT_RE)
        if (!m) continue
        const label = m[2].replace(/\s*#\S+$/, '').trim()
        if (label) out.push({ title: label, kind: 'timeline event', context: raw.trim(), section, held })
      }
      for (const title of wikilinksIn(it.text)) out.push({ title, kind: 'wikilink', context: '', section, held })
    }
  }
  return out
}

/**
 * The plan's red links, once each by slug, first mention kept:
 * {red: [{title, slug, kind, context, section}], questions: [titles],
 * held: [titles], existing: n}. known is the set of slugs with a page.
 */
export const redLinksOf = (page, known = new Set(), slug = asSlug) => {
  const own = slug((page && page.title) || '')
  const seen = new Set()
  const red = []
  const questions = []
  const held = []
  let existing = 0
  for (const l of planLinks(page)) {
    const s = slug(l.title)
    if (!s || s === own || seen.has(s)) continue
    seen.add(s)
    if (l.title.endsWith('?')) questions.push(l.title)
    else if (l.held) held.push(l.title)
    else if (known.has(s)) existing++
    else red.push({ title: l.title, slug: s, kind: l.kind, context: l.context, section: l.section })
  }
  return { red, questions, held, existing }
}

// ---------- the researched page ----------
//
// Red-link writes a full page for each red link, researched on the web by
// the door (WebSearch and WebFetch only): the model answers "TITLE: name" on
// its first line, the name as its makers write it, then the page. The page
// is written as the house writes one: an opening line saying it is AI
// generated and from where, the model's paragraphs one item each, commands as
// terminal items and other fenced blocks as code items, any GitHub-style
// [label](url) link turned into the wiki's [url label], the model's own See
// section dropped and the tool's added: the plan that linked it.

const FENCE_RE = /^```([\w-]*)\n([\s\S]*?)\n?```$/
const SHELL_LANGS = new Set(['', 'bash', 'sh', 'shell', 'console', 'zsh', 'terminal'])
const GFM_LINK_RE = /(?<!\[)\[([^\[\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g
const SEE_HEADING_RE = /^#\s*see\s*$/i

/** The model's answer read back: {title, body}; the title only when it names the same page as the link. */
export const parseResearch = (markdown, link, slug = asSlug) => {
  const lines = String(markdown || '').trim().split('\n')
  let title = link
  let start = 0
  const m = (lines[0] || '').match(/^\s*TITLE:\s*(.+?)\s*$/i)
  if (m) {
    const named = m[1].replace(/^\[\[|\]\]$/g, '').trim()
    if (slug(named) === slug(link)) title = named
    start = 1
  }
  return { title, body: lines.slice(start).join('\n').trim() }
}

// A reference page keeps a list together: paragraphs split on blank lines, a
// run of list blocks is one item, a heading and its strap one item, and a
// heading with no strap (# Links) takes the list that follows it. Unlike a
// report or a checklist, where each point is its own draggable item.
const LIST_BLOCK_RE = /^\s*([-*+]|\d+[.)])\s/
const isListBlock = b => b.split('\n').every(l => LIST_BLOCK_RE.test(l) || /^\s+\S/.test(l))
export const pageBlocks = text => {
  const out = []
  for (const raw of String(text || '').trim().split(/\n\s*\n/)) {
    const b = raw.trim()
    if (!b) continue
    const prev = out[out.length - 1]
    const headedList = prev !== undefined && /^#{1,6}\s/.test(prev) && !prev.split('\n').slice(1).some(l => !LIST_BLOCK_RE.test(l) && !/^\s+\S/.test(l))
    if (prev !== undefined && isListBlock(b) && (isListBlock(prev) || headedList) && !/^#{1,6}\s[^\n]*\n>/.test(prev)) out[out.length - 1] = `${prev}\n${b}`
    else out.push(b)
  }
  return joinStraps(out)
}

/** The page's story, built from the model's body. */
export const researchedStory = ({ title, body, planTitle, model = '', date = today(), id = randomHex }) => {
  const by = model ? ` by ${String(model).replace(/^claude-cli:/, '')}` : ''
  const out = [{ type: 'markdown', id: id(), text: `This page is AI generated: researched on the web${by} through the [[Plan Tool]]'s Red-link, ${date}, for a link on [[${planTitle}]].` }]
  // A fenced block may hold blank lines: keep it whole before splitting the rest.
  const blocks = []
  const text = String(body || '').replace(GFM_LINK_RE, (_, label, url) => `[${url} ${label}]`)
  for (const piece of text.split(/(^```[\w-]*\n[\s\S]*?\n```$)/m)) {
    if (FENCE_RE.test(piece.trim())) blocks.push(piece.trim())
    else blocks.push(...pageBlocks(piece))
  }
  let cut = blocks.findIndex(b => SEE_HEADING_RE.test(b.split('\n')[0].trim()))
  const kept = cut === -1 ? blocks : blocks.slice(0, cut)
  if (kept.length && new RegExp(`^#\\s*${escapeRe(title)}\\s*$`, 'i').test(kept[0].trim())) kept.shift()
  for (const b of kept) {
    const f = b.match(FENCE_RE)
    if (!f) out.push({ type: 'markdown', id: id(), text: b })
    else if (SHELL_LANGS.has(f[1].toLowerCase())) out.push({ type: 'terminal', id: id(), text: f[2].split('\n').map(l => l.replace(/^\$\s+/, '')).join('\n').trim() })
    else out.push({ type: 'code', id: id(), text: f[2] })
  }
  out.push({ type: 'markdown', id: id(), text: `# See\n\n- [[${planTitle}]]` })
  return out
}

/** A researched page as a page file: the story, and a journal of one create with its provenance. */
export const researchedPage = ({ title, body, planTitle, model = '', date = Date.now(), id = randomHex }) => {
  const story = researchedStory({ title, body, planTitle, model, date: today(date), id })
  const by = model ? ` by ${String(model).replace(/^claude-cli:/, '')}` : ''
  return {
    title,
    story,
    journal: [{ type: 'create', item: { title, story: story.map(i => ({ ...i })) }, date, provenance: `Researched on the web${by} through the Plan Tool's Red-link, for a red link on ${planTitle}.` }],
  }
}

/**
 * An AI stub the Plan Tool's Red-link wrote (0.6.0) that nobody has touched
 * since: one create in its journal, carrying Red-link's stub provenance.
 * Since 0.7.0 Red-link treats such a page as still missing, researches it and
 * writes the full page over it through the journal, so the stub stays in its
 * history. A stub anyone has edited, forked or written by hand is a page.
 */
export const isUntouchedStub = page =>
  !!page &&
  Array.isArray(page.journal) &&
  page.journal.length === 1 &&
  page.journal[0].type === 'create' &&
  /^AI generated stub for a red link on .+ through the Plan Tool's Red-link/.test(String(page.journal[0].provenance || ''))

/** The researched page written over an untouched stub: the stub's create, then the journal of the change. */
export const researchedOverStub = ({ stub, title, body, planTitle, model = '', date = Date.now(), id = randomHex }) => {
  const story = researchedStory({ title, body, planTitle, model, date: today(date), id })
  const by = model ? ` by ${String(model).replace(/^claude-cli:/, '')}` : ''
  const r = reviseJournal(stub.story || [], story, { provenance: `Researched on the web${by} through the Plan Tool's Red-link, over the stub it had written, for a red link on ${planTitle}.`, date })
  return { ...stub, title, story: r.story, journal: [...stub.journal, ...r.actions] }
}


// ======================================================================
// 0.9.0 — Do Next Phase places a Terminal Button.
// ======================================================================
//
// Until 0.8.0 Do Next Phase asked the Claude door, with every tool switched
// off, for a report on how the phase might be done: it described the work and
// did none of it. David chose (17 Oct 2026) that the work is done in a Claude
// Code session he watches, not by an agent the wiki starts unattended. So Do
// Next Phase now puts the plan's one Terminal Button (wiki-plugin-terminal's
// BUTTON mode, the fedwiki-plan skill's "moving button") just after the
// phase's last checkpoint, written for that phase. Clicking it opens the
// terminal on the laptop, boots `claude` in a shared session and types the
// brief in; every tool call is approved there, in the open. The brief carries
// the moving rule, so the session walks the button on when the phase is done.

// Shell-safe: an unmatched quote wedges a bare zsh at `quote>` if claude has
// not drawn yet, so the interpolated words lose quotes, backticks, $ and \.
const shellSafe = s => String(s || '').replace(/['"`$\\]/g, '').replace(/\s+/g, ' ').trim()

// Which Claude Code session a phase runs in (0.14.0, David 2026-10-21).
// Fresh by default: one session per phase, <plan-slug>-<phase-slug>, so a
// phase starts from the plan page and the reports, not from every earlier
// phase's conversation (by Phase 1 of the Mood Board Plan the one shared
// session sent ~230k tokens with every request). CONTEXT carry on the plan's
// status item keeps the old shared <plan-slug>-agent, conversation and all.
export const buttonSession = (slug, phase = null, { carry = false } = {}) =>
  carry || !phase ? `${slug}-agent` : `${slug}-${asSlug(phase.label) || 'phase'}`

/** CONTEXT on the plan's own status item: 'carry' or 'fresh' (the default). */
export const planContext = page => {
  const status = (page && Array.isArray(page.story) ? page.story : []).find(it => it && it.type === 'plan')
  return status ? parse(status.text).context : 'fresh'
}

export const phaseButtonText = ({ title, slug, base, phase, reportTitle: report, carry = false, previousReport = '', nextPhase = null }) => {
  const label = phase.label
  const origin = String(base).replace(/^https?:\/\//, '').replace(/\/$/, '')
  const t = shellSafe(title)
  const r = shellSafe(report)
  const prev = shellSafe(previousReport)
  const session = buttonSession(slug, phase, { carry })
  const brief =
    `Do ${label} of the ${t}, ${String(base).replace(/\/$/, '')}/view/${slug}. ` +
    (carry
      ? `Read the plan page first, then do every unticked checkpoint of ${label}, in order, for real: write the code, run it, write the pages, and verify each one with a command before you count it done. `
      : `This is a fresh session for this phase: what earlier phases did is on the plan page${prev ? ` and in ${prev}` : ' and in its phase reports'}, not in your memory. Read the plan page first${prev ? `, then ${prev} if it exists` : ''}, then do every unticked checkpoint of ${label}, in order, for real: write the code, run it, write the pages, and verify each one with a command before you count it done. `) +
    `The page files live on the machine whose farm serves ${origin}: write pages there through the journal with fedwiki-lib, and follow the fedwiki-plan skill. ` +
    `Ask me before any DNS change, anything on a public site, a farm restart, an npm publish, a git push or a message to anyone, and before any checkpoint that needs my decision. ` +
    `When the phase is done, write the page ${r}, over the old one through its journal if it exists, saying what you did and how you verified each checkpoint; tick each checkpoint you verified, one journal edit per item; then move this terminal item to just after the last checkpoint of the next unticked phase and rewrite it for that phase, as the moving button rule in fedwiki-plan says, ` +
    (carry
      ? `keeping SESSION ${session} since the plan carries context, `
      : `with SESSION ${nextPhase ? buttonSession(slug, nextPhase) : `${slug} and the next phase as a slug, joined by a hyphen`} so the next phase starts fresh, `) +
    `or remove it after the final phase. Reset the site index after writing.`
  return [
    'BUTTON: show',
    `LABEL: Do ${label}`,
    `SESSION: ${session}`,
    'BOOT: cd ~ && claude',
    'GUARD: claude auth status',
    'GUARDLABEL: Sign in to Claude first',
    brief,
  ].join('\n')
}

/** The plan's Terminal Button: a terminal item in BUTTON mode whose label is Do <something>. */
export const findPhaseButton = page => {
  const story = page && Array.isArray(page.story) ? page.story : []
  const index = story.findIndex(it => {
    if (!it || it.type !== 'terminal') return false
    const lines = String(it.text || '').split('\n')
    return lines.some(l => /^BUTTON(?::\s*\S+)?\s*$/.test(l)) && lines.some(l => /^LABEL:\s*Do\s/.test(l))
  })
  return index === -1 ? null : { item: story[index], index }
}

/**
 * What Do Next Phase must do to the plan so its button sits right after the
 * phase's last checkpoint item, with the text for that phase:
 * {add, edit, move, after, existing} — none of them when it already does.
 */
export const buttonPlacement = (page, phase, text) => {
  const story = page && Array.isArray(page.story) ? page.story : []
  const after = phase.lastItemId
  const found = findPhaseButton(page)
  if (!found) return { add: true, edit: false, move: false, after, existing: null }
  const at = story.findIndex(it => it && it.id === after)
  return { add: false, edit: found.item.text !== text, move: found.index !== at + 1, after, existing: found.item }
}
