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
// subject is true only for an explicit SUBJECT line; face() below decides
// what a bare item does from the page it sits on. SKILLS does not change the
// face: a status item that names skills is still the status line.
export const COMMANDS = ['SUBJECT', 'SITE', 'LIMIT', 'SKILLS']

export const parse = text => {
  const out = { subject: false, site: null, limit: null, skills: [], caption: '', commands: 0 }
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
// Every unticked Open Questions task line whose ?-link has a page behind it
// (known, the slugs that exist) is ticked, "- [ ]" to "- [x]", in that item's
// text. One journal edit per item changed, shaped as the wiki itself journals
// an edit: {type, id, item, date}, no site. Returns a new page; the one given
// is not touched.
export const tickAnswered = (page, known = new Set(), slug = asSlug, now = () => Date.now()) => {
  const out = JSON.parse(JSON.stringify(page || {}))
  out.story = Array.isArray(out.story) ? out.story : []
  out.journal = Array.isArray(out.journal) ? out.journal : []
  const sec = sections(out).find(s => s.heading === 'Open Questions')
  const ticked = []
  if (sec) {
    for (const it of sec.items) {
      if (!it || it.type !== 'markdown' || !it.id) continue
      let changed = false
      const lines = String(it.text || '').split('\n').map(line => {
        const m = line.match(TASK_LINE_RE)
        if (!m || m[1] !== ' ') return line
        const title = wikilinksIn(m[2]).find(t => t.endsWith('?'))
        if (!title || !known.has(slug(title))) return line
        changed = true
        ticked.push({ id: it.id, title, slug: slug(title) })
        return line.replace('[ ]', '[x]')
      })
      if (!changed) continue
      it.text = lines.join('\n')
      out.journal.push({ type: 'edit', id: it.id, item: { ...it }, date: now() })
    }
  }
  const unanswered = questionsOf(out, known, slug)
    .filter(q => !q.answered)
    .map(({ title, slug }) => ({ title, slug }))
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

/** "<Plan Title> Phase N Report" for Do Next Phase; "<Plan Title> Revision <YYYY-MM-DD>" for Revise Plan. */
export const reportTitle = ({ kind, planTitle, phaseLabel = '', date = today() }) =>
  kind === 'revise' ? `${planTitle} Revision ${date}` : `${planTitle} ${phaseLabel} Report`

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
