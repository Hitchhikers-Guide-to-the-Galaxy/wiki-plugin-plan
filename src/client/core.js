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
// subject is true only for an explicit SUBJECT line; face() below decides
// what a bare item does from the page it sits on.
export const COMMANDS = ['SUBJECT', 'SITE', 'LIMIT']

export const parse = text => {
  const out = { subject: false, site: null, limit: null, caption: '', commands: 0 }
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
    if (key === 'SITE') out.site = (args[0] || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null
    if (key === 'LIMIT') {
      const n = parseInt(args[0], 10)
      out.limit = Number.isFinite(n) && n > 0 ? n : null
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
export const summarise = (entry, page) => ({
  title: entry.title,
  slug: entry.slug,
  modified: lastEdit(page, entry.date),
  read: !!page,
  ...(page ? ticks(page) : { done: 0, total: 0 }),
  questions: page ? openQuestions(page) : 0,
})

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
  if (opts.site) return 'list'
  if (opts.subject) return isPlanTitle(leftTitle) ? 'subject' : 'list'
  return isPlanTitle(ownTitle) ? 'status' : 'list'
}

// Tool pages the look-left walks past: audionote's TOOL_SLUGS (voice.js) plus
// this plugin's own Plan Tool, so a Voice Tool or the ☰ menu between the plan
// and the Plan Tool does not hide the plan.
export const TOOL_SLUGS = new Set(['selected-plugin-pages', 'voice-tool', 'search-tool', 'like-this-page', 'plan-tool'])

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
// a link whose title ends in "?". A question is ANSWERED when a page exists
// behind its link — known is the set of slugs on the plan's site and in the
// neighbourhood. The tick on the line is the author's own mark, reported
// alongside but never taken as the answer.
const TASK_LINE_RE = /^\s*[-*]\s+\[([ xX])\]\s(.*)$/
export const questionsOf = (page, known = new Set(), slug = asSlug) => {
  const sec = sections(page).find(s => s.heading === 'Open Questions')
  if (!sec) return []
  const out = []
  for (const it of sec.items) {
    if (!it || it.type !== 'markdown') continue
    for (const line of (it.text || '').split('\n')) {
      const m = line.match(TASK_LINE_RE)
      if (!m) continue
      const title = wikilinksIn(m[2]).find(t => t.endsWith('?'))
      if (!title) continue
      out.push({ title, slug: slug(title), ticked: m[1] !== ' ', answered: known.has(slug(title)) })
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

// ---------- the state view ----------
//
// planState(page, known) — everything the status and subject faces show.
//   phases     each "# " section holding at least one checkpoint, Open
//              Questions excepted: {line, done, total}
//   next       index into phases of the first with an unticked checkpoint,
//              or -1 when the plan is complete
//   blockers   of the next phase: its unanswered questions and the red links
//              inside its section
//   questions  every question line, answered by a page existing
//   lints      short sentences, only those triggered (scatter is added by the
//              caller, which has to fetch the other copies)
export const planState = (page, known = new Set(), slug = asSlug) => {
  const phases = sections(page)
    .filter(s => s.heading !== 'Open Questions')
    .map(s => ({ ...s, ...sectionTicks(s) }))
    .filter(s => s.total > 0)
  const next = phases.findIndex(p => p.done < p.total)
  const questions = questionsOf(page, known, slug)
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
  if (total > 0 && done === total && !linkTitles(page).some(t => /Demo$/.test(t)))
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
