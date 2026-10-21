// wiki-plugin-plan — the Plan Tool's item.
//
// One item type, three faces, decided by its text and where it sits (face() in
// core.js):
//   status   a bare item on a plan page shows that page's own state — the
//            status line a plan carries at its top.
//   subject  SUBJECT looks left: when the nearest real page to the left is a
//            plan, the item shows that plan's state, headed by its title.
//   list     otherwise (SITE, no plan to the left, or a bare item on a page
//            that is not a plan) it lists every plan on a site, newest journal
//            edit first, each with its ticks and open questions (Phase 1).
//
// A plan item's text is STATUS (DEFAULT_TEXT) from 0.5.0: an item saved with
// empty text is removed by wiki-client, so an empty status line was one
// unchanged save from deletion. Empty text still reads as the status line,
// and its editor opens with STATUS already in it (editText below).
//
// Everything shown is read from page JSON: the lineup's own copy of a page,
// /system/sitemap.json, {slug}.json and the neighbourhood's sitemaps. There is
// no server and no storage of its own.
import { parse, isPlanTitle, summarise, byRecent, face, planState, audit, forkSites, trashable, TOOL_SLUGS, asSlug as asSlugCopy, reportItems, linkAfter, lastEdit, WAITING_FOR_KEY, demoCandidate, boardEntries, compareIndex, openQuestionsLink, proposalItems, proposalApplied, parseProposal, wikilinksIn, PROPOSAL_TITLE, reviseItems, lastRevision, revLabel, revSlug, rewindPage, DEFAULT_TEXT, choosePhase, reportTitle, phaseButtonText, buttonPlacement, buttonSession, planContext, phasesOf, modelLabel, windowLabel, autoLine, AUTO_RULE, REVISE_WAYS, reviseHowText } from './core.js'

const FETCHES_AT_ONCE = 6

const escapeHtml = text =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// localhost sites are served over plain http; everything else https — the
// same rule as plan-index.py's scheme_for.
const baseFor = site => {
  if (!site || site === location.host) return ''
  const local = site === 'localhost' || site.endsWith('.localhost') || /^localhost:\d+$/.test(site) || /\.localhost:\d+$/.test(site)
  return `${local ? 'http:' : 'https:'}//${site}`
}

const getJSON = async url => {
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.json()
}

// Read pages a few at a time: a plan site may carry a hundred plans.
const readAll = async (base, entries) => {
  const rows = new Array(entries.length)
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const i = next++
      let page = null
      try {
        page = await getJSON(`${base}/${entries[i].slug}.json`)
      } catch (_) {}
      rows[i] = summarise(entries[i], page)
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCHES_AT_ONCE, entries.length) }, worker))
  return rows
}

export const plansOf = async site => {
  const base = baseFor(site)
  const sitemap = await getJSON(`${base}/system/sitemap.json`)
  const entries = (Array.isArray(sitemap) ? sitemap : []).filter(e => e && e.slug && isPlanTitle(e.title))
  const rows = await readAll(base, entries)
  return rows.sort(byRecent)
}

const STYLE = `
.plan-tool .plan-caption{margin:0 0 6px}
.plan-tool .plan-meta{color:#777;font-size:80%;margin:0 0 6px}
.plan-tool ol,.plan-tool ul{margin:0;padding-left:1.8em}
.plan-tool li{margin:2px 0}
.plan-tool .plan-ticks,.plan-tool .plan-questions{color:#555;font-size:85%;margin-left:.4em;white-space:nowrap}
.plan-tool .plan-questions{color:#a35a00}
.plan-tool .plan-error{color:#a00}
.plan-tool .plan-subject{font-weight:bold;margin:0 0 4px}
.plan-tool .plan-summary{margin:0 0 6px}
.plan-tool a.plan-fold{color:#777;text-decoration:none;margin-right:.35em;font-size:90%;cursor:pointer}
.plan-tool.plan-folded .plan-detail{display:none}
.plan-tool li.plan-done{color:#888}
.plan-tool li.plan-next{font-weight:bold}
.plan-tool .plan-next-tag{background:#f6d6c4;border-radius:3px;font-size:75%;font-weight:normal;margin-left:.4em;padding:0 4px}
.plan-tool .plan-blockers{font-weight:normal;font-size:90%;color:#555;margin:2px 0 4px}
.plan-tool .plan-section{margin:8px 0 2px;font-size:90%;color:#555}
.plan-tool .plan-lints li{color:#a35a00;font-size:90%}
.plan-tool .plan-actions{border-top:1px solid #ddd;color:#555;font-size:85%;margin-top:10px;padding-top:6px}
.plan-tool .plan-actions button{font-size:inherit;margin:0 2px}
.plan-tool .plan-actions .plan-trash-yes{background:#c33;border:1px solid #a22;border-radius:3px;color:#fff}
.plan-tool .plan-actions-note{color:#a35a00}
.plan-tool .plan-update{margin-top:8px;font-size:85%;color:#555}
.plan-tool .plan-update button{font-size:inherit}
.plan-tool .plan-update button.plan-icon{font-size:140%;line-height:1.1;min-width:1.8em;padding:1px 5px;margin:0 1px;border:1px solid #ccc;border-radius:4px;background:#fafafa;cursor:pointer}
.plan-tool .plan-update button.plan-icon:hover{background:#eef4ff;border-color:#9ab}
.plan-tool .plan-update .plan-sep{display:inline-block;width:1px;height:1.2em;background:#ddd;vertical-align:middle;margin:0 5px}
.plan-tool a.plan-model{color:#555;text-decoration:none;border:1px solid #ccc;border-radius:10px;padding:1px 7px;margin-left:4px;white-space:nowrap;cursor:pointer;font-size:95%}
.plan-tool a.plan-model:hover{background:#eef4ff;border-color:#9ab}
.plan-tool .plan-models h4{margin:10px 0 2px;font-size:90%;color:#333}
.plan-tool .plan-models .plan-door-note{color:#777;font-size:80%;margin:0 0 3px}
.plan-tool .plan-models label{display:block;margin:2px 0;cursor:pointer}
.plan-tool .plan-models .plan-model-facts{color:#777;font-size:80%;margin-left:.3em}
.plan-tool .plan-models .plan-model-warm{color:#2a6}
.plan-tool .plan-models .plan-chosen{font-weight:bold}
.plan-tool .plan-answer{margin-left:.4em}
.plan-tool .plan-answer.plan-refused{color:#a00}
.plan-tool .plan-agent{display:block;margin-top:4px}
.plan-tool .plan-agent.plan-refused{color:#a00}
.plan-tool .plan-agent .plan-save{margin-left:.4em}
.plan-tool .plan-agent .plan-go{margin-left:.4em;font-weight:bold}
.plan-tool .plan-agent .plan-pause{margin-left:.2em}
.plan-tool .plan-agent ul{margin:2px 0 4px}
.plan-tool .plan-revised{color:#555;font-size:85%;margin:0 0 6px}
.plan-tool .plan-revised button{font-size:inherit;margin-left:.4em}
.plan-rev-note{color:#a35a00;font-size:85%;margin:0 0 6px}
.plan-tool a.plan-ask{font-size:80%;margin-left:.3em;color:#2a6;text-decoration:none;border:1px solid #9c9;border-radius:3px;padding:0 3px}
.plan-tool .plan-finish{display:block;margin-top:6px}
.plan-tool .plan-finish textarea{width:100%;box-sizing:border-box;font-size:inherit;margin:2px 0}
.plan-tool .plan-finish input{width:70%;font-size:inherit}
.plan-tool .plan-finish-note{display:block;margin-top:4px}
.plan-tool .plan-finish-note.plan-refused{color:#a00}
.plan-tool .plan-index-check{border-top:1px solid #ddd;color:#555;font-size:85%;margin-top:10px;padding-top:6px}
.plan-tool .plan-index-check button{font-size:inherit}
.plan-tool .plan-index-report p{margin:4px 0}
.plan-tool .plan-index-report ul{margin:0 0 4px}
.plan-tool .plan-index-report .plan-refused{color:#a00}
.plan-tool .plan-revise .plan-refused{color:#a00}
.plan-tool .plan-ways{margin:4px 0 8px}
.plan-tool .plan-way{display:block;border:1px solid #ddd;border-radius:5px;padding:5px 8px 5px 26px;margin:4px 0;cursor:pointer;position:relative;background:#fff}
.plan-tool .plan-way input{position:absolute;left:7px;top:8px;margin:0}
.plan-tool .plan-way:hover{border-color:#9ab;background:#f7faff}
.plan-tool .plan-way.plan-chosen{border-color:#2a63bd;background:#eef4ff}
.plan-tool .plan-way-name{display:block;font-weight:bold}
.plan-tool .plan-way-what{display:block;font-size:85%;color:#444;margin-top:1px}
.plan-tool .plan-way-fact{display:block;font-size:80%;color:#a35a00;margin-top:2px}
.plan-tool .plan-direction{margin:6px 0;font-size:90%}
.plan-tool .plan-direction-label{font-weight:bold;margin-bottom:2px}
.plan-tool .plan-direction-need{font-weight:normal;color:#777;font-size:90%}
.plan-tool .plan-direction-text{width:100%;box-sizing:border-box;font-size:inherit;font-family:inherit;resize:vertical;border:1px solid #ccc;border-radius:4px;padding:4px}
.plan-tool .plan-direction-main .plan-direction-text{border-color:#2a63bd;min-height:7em}
.plan-tool .plan-direction-row{display:flex;align-items:center;gap:8px;margin-top:3px}
.plan-tool .plan-direction-count{color:#777;font-size:85%}
.plan-tool .plan-speak{font-size:inherit;border:1px solid #9c9;border-radius:4px;background:#f6fbf6;cursor:pointer;padding:2px 8px}
.plan-tool .plan-revise-row{display:flex;align-items:center;gap:6px;margin:8px 0 2px;flex-wrap:wrap}
.plan-tool .plan-revise-run{font-size:100%;padding:4px 12px;border-radius:5px;border:1px solid #2559a8;background:linear-gradient(#3a7ce0,#2a63bd);color:#fff;cursor:pointer}
.plan-tool .plan-revise-run:disabled{background:#c9d4e6;border-color:#b5c2d6;cursor:default}
.plan-tool .plan-revise .plan-agent{font-size:85%;color:#555}
.plan-tool .plan-revise .plan-agent button{font-size:inherit}
.plan-tool .plan-revise-how{margin-top:8px}
`

const shell = (opts, body) =>
  `<style>${STYLE}</style><div class="plan-tool">` +
  (opts.caption ? `<p class="plan-caption">${escapeHtml(opts.caption)}</p>` : '') +
  body +
  `</div>`

const internal = (title, slug, site) =>
  `<a class="internal" href="/${escapeHtml(slug)}.html" data-page-name="${escapeHtml(slug)}" title="${escapeHtml(site)}">${escapeHtml(title)}</a>`

const asSlug = title => (typeof window !== 'undefined' && window.wiki && typeof window.wiki.asSlug === 'function' ? window.wiki.asSlug(title) : asSlugCopy(title))

// ---------- look left ----------
//
// COPIED from wiki-plugin-audionote's leftSubject (client/voice.js): the
// nearest page to the left that is neither a ghost nor a tool page. Opened from
// the ☰ menu the lineup reads plan | Selected Plugin Pages | Plan Tool, so the
// immediate neighbour is the menu, not the subject.
const slugOf = $page => ($page.attr('id') || '').split('_rev')[0]
export function leftSubject($self) {
  let $host = $self.prev('.page')
  while ($host.length && ($host.hasClass('ghost') || TOOL_SLUGS.has(slugOf($host)))) $host = $host.prev('.page')
  return $host.length ? $host : null
}

const siteOfPage = $page => $page.data('site') || location.host
const titleOfPage = $page => (($page.data('data') || {}).title || $page.find('.header h1').first().text() || '').trim()

// ---------- what the neighbourhood knows ----------

const neighbourSites = () => (window.wiki && window.wiki.neighborhoodObject && window.wiki.neighborhoodObject.sites) || {}

// Slugs that exist: the plan's own site's sitemap plus every neighbourhood
// sitemap — audionote's redLinks rule (client/voice.js).
const knownSlugs = async site => {
  const known = new Set()
  try {
    for (const p of await getJSON(`${baseFor(site)}/system/sitemap.json`)) if (p && p.slug) known.add(p.slug)
  } catch (_) {}
  for (const info of Object.values(neighbourSites())) for (const p of (info && info.sitemap) || []) if (p && p.slug) known.add(p.slug)
  return known
}

// The scatter lint: the same title in another neighbourhood site's sitemap,
// with no fork lineage between the copies (plan-lint.py's audit, in core.js).
const scatterLint = async (page, site) => {
  const want = String(page.title || '').trim().toLowerCase()
  const copies = [{ site, forks: forkSites(page) }]
  for (const [other, info] of Object.entries(neighbourSites())) {
    if (other === site) continue
    const hit = ((info && info.sitemap) || []).find(p => p && String(p.title || '').trim().toLowerCase() === want)
    if (!hit) continue
    let forks = new Set()
    try {
      forks = forkSites(await getJSON(`${baseFor(other)}/${hit.slug}.json`))
    } catch (_) {}
    copies.push({ site: other, forks })
  }
  if (copies.length < 2) return null
  const { scattered } = audit(copies)
  if (!scattered.length) return null
  const others = copies.filter(c => c.site !== site).map(c => c.site)
  return `Same title on ${others.join(', ')} with no fork lineage between the copies.`
}

// ---------- the state view (status and subject faces) ----------

// Answer a question (Phase 5): hand the red link to the Voice Tool rather than
// reimplement it. The title goes in sessionStorage under WAITING_FOR_KEY,
// where the Voice Tool (wiki-plugin-audionote client/main.js, findRed) reads
// it when it paints its "a page it is waiting for" select: if the title is
// among the red links of the page it speaks to, it is chosen and applied as
// the title, and the key is removed either way. The Voice Tool opens to the
// right of the page this item sits on: the Plan Tool's own page on the subject
// face, so the plan stays in the lineup (the Voice Tool looks past tool pages,
// plan-tool among them), or the plan page itself on the status face.
const askLink = q =>
  ` <a href="#" class="plan-ask" data-title="${escapeHtml(q.title)}" title="Open the Voice Tool to the right with this question chosen as the page it is waiting for">Answer</a>`

const askVoiceTool = ($item, title) => {
  try {
    sessionStorage.setItem(WAITING_FOR_KEY, title)
  } catch (_) {}
  const $from = $item.parents('.page').first()
  wiki.doInternalLink('Voice Tool', $from.length ? $from : null)
}

// The view folds (Phase 8): the summary line stays, with a toggle at its
// head, and the middle, phases, questions and lints, sits in .plan-detail,
// hidden while the shell carries .plan-folded. The status face starts folded,
// so a plan's status line is one line plus its buttons; the subject face, on
// the Plan Tool's own page, starts open. A click on the toggle is remembered
// per item id in FOLD for the session, across re-emits.
const FOLD = new Map()
const foldGlyph = folded => (folded ? '▸' : '▾')

// The last revision the Plan Tool saved over the plan (Phase 8): when, by
// which model, and the version it replaced, its _rev in the journal, a click
// away. Rewind opens that rev beside the plan as a ghost with the plan's own
// title; forking it is the rewind, and nothing else writes.
const revisedHtml = (rev, title) => {
  if (!rev) return ''
  const day = rev.date ? new Date(rev.date).toISOString().slice(0, 10) : ''
  const label = revLabel(title, rev.previous)
  const link = `<a href="/view/${escapeHtml(revSlug(title, rev.previous, asSlug))}" class="plan-rev" data-rev="${rev.previous}" title="Open the plan as it was before, from its journal">${escapeHtml(label)}</a>`
  const rewind = ` <button class="plan-rewind" data-rev="${rev.previous}" title="Open ${escapeHtml(label)} beside the plan as a ghost with the plan's title: fork it to rewind, or close it; nothing is written until you fork">Rewind</button>`
  // A rewind the plugin wrote before Rewind became a ghost to fork (0.4.0 drafts) still reads as one.
  const by = rev.model ? ` by ${escapeHtml(rev.model)}` : ''
  const way = rev.mode ? `, ${escapeHtml(reviseHowText(rev.mode))}` : ''
  const what = rev.kind === 'rewind' && Number.isInteger(rev.to) ? `Rewound ${day} to ${escapeHtml(revLabel(title, rev.to))}` : rev.kind === 'terms' || rev.kind === 'redlink' ? `Linked terms ${day}${by}` : `Revised ${day}${way}${way && by ? ',' : ''}${by}`
  return `<p class="plan-revised">${what} · the version it replaced: ${link}${rewind}</p>`
}

const stateHtml = (st, site, heading, folded = false, rev = null) => {
  const parts = []
  if (heading) parts.push(`<p class="plan-subject">${internal(st.title, asSlug(st.title), site)}</p>`)

  const q = st.questions.length ? ` · ${st.answered} of ${st.questions.length} questions answered${st.queried ? `, ${st.queried} asked back` : ''}` : ''
  const where = st.complete ? 'complete' : st.next === -1 ? 'no checkpoints' : `next: ${escapeHtml(st.phases[st.next].line)}`
  const blocks = st.next === -1 ? 0 : st.blockers.questions.length + st.blockers.redLinks.length
  const extra = (blocks ? ` · ${blocks} blocker${blocks === 1 ? '' : 's'}` : '') + (st.lints.length ? ` · ${st.lints.length} lint${st.lints.length === 1 ? '' : 's'}` : '')
  const toggle = `<a href="#" class="plan-fold" title="Show or hide the phases, questions and lints">${foldGlyph(folded)}</a>`
  parts.push(`<p class="plan-summary">${toggle}${st.done}/${st.total} checkpoints · ${where}${q}${extra}</p>`)
  parts.push(revisedHtml(rev, st.title))
  parts.push('<div class="plan-detail">')

  if (st.phases.length) {
    const items = st.phases.map((p, i) => {
      const cls = p.done === p.total ? 'plan-done' : i === st.next ? 'plan-next' : ''
      let li = `<li${cls ? ` class="${cls}"` : ''}>${escapeHtml(p.line)} <span class="plan-ticks">${p.done}/${p.total}</span>`
      if (i === st.next) {
        li += `<span class="plan-next-tag">next</span>`
        const b = []
        for (const x of st.blockers.questions) b.push(`question ${internal(x.title, x.slug, site)}${askLink(x)}`)
        for (const x of st.blockers.redLinks) b.push(`red link ${internal(x.title, x.slug, site)}`)
        li += `<div class="plan-blockers">${b.length ? `Blocked by ${b.join('; ')}` : 'Nothing blocks it.'}</div>`
      }
      return li + '</li>'
    })
    parts.push(`<ol class="plan-phases">${items.join('')}</ol>`)
  }

  if (st.questions.length) {
    const open = st.questions.filter(x => !x.answered && !x.query)
    const queried = st.questions.filter(x => x.query)
    const inline = st.answeredInline || 0
    const how = inline === st.answered ? 'written on the line' : inline ? `${st.answered - inline} by a page behind the link, ${inline} written on the line` : 'a page behind the link'
    let line = `${st.answered} of ${st.questions.length} questions answered${st.answered ? `, ${how}` : ''}; ${st.ticked} ticked on the page.`
    if (queried.length) line += ` Asked back, not answered: ${queried.map(x => `${internal(x.title, x.slug, site)} (<i>${escapeHtml(x.query)}</i>)${askLink(x)}`).join('; ')}.`
    if (open.length) line += ` Unanswered: ${open.map(x => internal(x.title, x.slug, site) + askLink(x)).join('; ')}`
    parts.push(`<p class="plan-section">${line}</p>`)
  }

  if (st.lints.length) parts.push(`<ul class="plan-lints">${st.lints.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`)
  parts.push('</div>')
  return parts.join('')
}

export { stateHtml }

// The page the plan links as [[Open Questions]], on the plan's own site (Phase 7).
const linkedQuestions = async (page, site) => {
  const link = openQuestionsLink(page, asSlug)
  if (!link || link.slug === asSlug(page.title || '')) return null
  try {
    return await getJSON(`${baseFor(site)}/${link.slug}.json`)
  } catch (_) {
    return null
  }
}

const showState = async ($item, opts, page, site, heading, $subject, key = null) => {
  const known = await knownSlugs(site)
  const linked = await linkedQuestions(page, site)
  const st = planState(page, known, asSlug, linked)
  let scatter = null
  try {
    scatter = await scatterLint(page, site)
  } catch (_) {}
  if (scatter) st.lints.push(scatter)
  const folded = FOLD.has(key) ? FOLD.get(key) : !heading
  $item.html(shell(opts, stateHtml(st, site, heading, folded, lastRevision(page))))
  $item.find('.plan-tool').toggleClass('plan-folded', folded)
  attachUpdate($item, opts, $subject, st, page)
}

// ---------- Update Plan (Phase 3) ----------
//
// The button POSTs to the Plan API's update operation on the plan's own
// origin, where the farm gates it (a private site, the owner's rights) and the
// handler ticks the answered questions, journals each item, re-renders the
// markdown asset and resets the index, holding the farm WIP marker meanwhile.
// The status line is this item: after the call the page JSON is read again and
// the face re-rendered from it, with the ticked items re-emitted in the lineup.
//
// Shown only where the viewer may write — audionote's isHere/ownerHere
// (client/voice.js): the plan is on this origin, where the owner's cookie is,
// and the security plugin has not said this viewer is not the owner. A
// browser-local draft ('local') is left out: the write would land on the
// server's copy, not the one on screen.
const isHere = $page => {
  const site = $page.data('site')
  return !site || site === location.host || site === location.hostname || site === 'origin'
}
const ownerHere = () => (typeof window.isOwner === 'boolean' ? window.isOwner : undefined)

// The last answer, kept on the element: a re-emit (renderFrom) rebuilds the
// item's html, and the line should survive it.
const answerOf = $item => ($item[0] && $item[0].planAnswer) || null

const attachUpdate = ($item, opts, $subject, st = null, page = null) => {
  if (!$subject || !$subject.length || !isHere($subject) || ownerHere() === false) return
  if ($subject.hasClass('ghost') || $subject.hasClass('local')) return
  const slug = slugOf($subject)
  const next = st && st.next !== -1 ? st.phases[st.next].line : ''
  // One row of icons (0.10.0): the name and what it does are the tooltip, so
  // the row stays one line. Left of the bar, no model; right of it, the model
  // the ⚙ chip names, which opens Model Settings beside the plan.
  const icon = (cls, glyph, name, what) => `<button class="plan-icon ${cls}" aria-label="${name}" title="${name} — ${what}">${glyph}</button>`
  const $box = $(
    `<div class="plan-update">` +
      icon('plan-update-go', '⟳', 'Update Plan', "ticks what the answers settled and re-renders the plan's markdown asset; no model, written on the page") +
      (st && st.complete ? icon('plan-finish-go', '✓', 'Finish Plan', "every checkpoint is ticked: write the plan's Conclusion section and its demo link") : '') +
      (next ? icon('plan-next-go', '▶', 'Do Next Phase', `put the plan's Do Phase button just after ${escapeHtml(next)}: clicking it opens a Claude Code session on this laptop and types the phase in, and you watch and approve the work there`) : '') +
      `<span class="plan-sep"></span>` +
      icon('plan-revise-go', '✎', 'Revise Plan', "opens the Revise Plan tool beside the plan: choose how the model redrafts it — from the answers, from your direction (typed or spoken), to catch up with the work, or tidy only; the redraft is a ghost with the plan's own title, and forking it saves it over the plan through the journal") +
      (page && (openQuestionsLink(page, asSlug) || (st && st.answered > 0))
        ? icon('plan-site-go', '⧉', 'Revise Site', 'the model proposes a revision of the whole site from the answered questions: a ghost page with Go Ahead and Pause, nothing written until Go Ahead')
        : '') +
      icon('plan-redlink-go', '⌕', 'Red-link', "researches each link on the plan that has no page behind it, on the web, and writes its page; question links are left for their answers; always Claude, which alone has web search here") +
      modelChip() +
      `<span class="plan-answer"></span><span class="plan-agent"></span><span class="plan-finish"></span></div>`,
  )
  const last = answerOf($item)
  if (last) $box.find('.plan-answer').toggleClass('plan-refused', !!last.refused).html(last.html)
  else if (SAVED.has(slug)) $box.find('.plan-answer').toggleClass('plan-refused', !!SAVED.get(slug).refused).html(SAVED.get(slug).html)
  $item.find('.plan-tool').append($box)

  $box.on('click', '.plan-update-go', e => {
    e.preventDefault()
    runUpdate($item, $subject, slug, $box)
  })
  $box.on('click', '.plan-model', e => {
    e.preventDefault()
    wiki.doInternalLink(MODEL_SETTINGS, $item.parents('.page').first())
  })
  paintChips()
  $box.on('click', '.plan-next-go', e => {
    e.preventDefault()
    placeButton($item, $subject, slug, $box)
  })
  $box.on('click', '.plan-revise-go', e => {
    e.preventDefault()
    wiki.doInternalLink(REVISE_PLAN, $item.parents('.page').first())
  })
  $box.on('click', '.plan-redlink-go', e => {
    e.preventDefault()
    runAgent($item, $subject, slug, 'redlink')
  })
  $box.on('click', '.plan-site-go', e => {
    e.preventDefault()
    runAgent($item, $subject, slug, 'site')
  })
  $box.on('click', '.plan-save, .plan-pause', e => {
    e.preventDefault()
    saveAndLink($item, $subject)
  })
  $box.on('click', '.plan-save-over', e => {
    e.preventDefault()
    saveOver($item, $subject)
  })
  $box.on('click', '.plan-go', e => {
    e.preventDefault()
    goAhead($item, $subject, slug, e.currentTarget.getAttribute('data-proposal'))
  })
  paintAgent($item)
  if (page) offerSavedProposal($item, $subject, page)
  if (st && st.complete) attachFinish($item, $subject, slug, $box, page)
}

// ---------- Finish Plan (Phase 5) ----------
//
// Shown only when every phase checkpoint is ticked (planState) and the viewer
// may write (attachUpdate's rule). The button opens a form in the tool: the
// conclusion, and the demo page's title, prefilled with the first title the
// plan links that ends in Demo. Write Conclusion POSTs to the Plan API's
// finish operation, which refuses unless the plan is complete and the demo
// page exists, then writes the Conclusion above See and the demo into See.
// The farm's answer carries the journal actions it wrote; they are applied to
// the plan in the lineup (each add inserted, each edit re-emitted) and the
// page data replaced by a fresh read, so the page shows what the file holds.
// The form lives on the element ($item[0].planFinish): a re-render repaints it.
const finishOf = $item => ($item[0] && $item[0].planFinish) || null

function paintFinish($item, page) {
  const F = finishOf($item)
  const $box = $item.find('.plan-finish')
  if (!$box.length) return
  if (!F) return $box.empty()
  const note = F.line ? `<span class="plan-finish-note${F.refused ? ' plan-refused' : ''}">${F.html || escapeHtml(F.line)}</span>` : ''
  if (!F.open) return $box.html(note)
  $box.html(
    `<textarea class="plan-finish-text" rows="5" placeholder="The conclusion: what the plan delivered. Each paragraph becomes its own item."></textarea>` +
      `Demo page <input type="text" class="plan-finish-demo" placeholder="the title of the page that shows it">` +
      `<br><button class="plan-finish-write" ${F.state === 'posting' ? 'disabled' : ''}>Write Conclusion</button> <button class="plan-finish-cancel">Cancel</button>` +
      note,
  )
  $box.find('.plan-finish-text').val(F.text)
  $box.find('.plan-finish-demo').val(F.demo)
}

function attachFinish($item, $subject, slug, $box, page) {
  paintFinish($item, page)
  $box.on('click', '.plan-finish-go', e => {
    e.preventDefault()
    const F = finishOf($item) || {}
    $item[0].planFinish = { ...F, text: F.text || '', demo: F.demo || demoCandidate(page || $subject.data('data')), open: true, state: 'open', refused: false, line: '', html: '' }
    paintFinish($item, page)
  })
  $box.on('input', '.plan-finish-text', e => (finishOf($item).text = e.target.value))
  $box.on('input', '.plan-finish-demo', e => (finishOf($item).demo = e.target.value))
  $box.on('click', '.plan-finish-cancel', e => {
    e.preventDefault()
    Object.assign(finishOf($item), { open: false, line: '', html: '' })
    paintFinish($item, page)
  })
  $box.on('click', '.plan-finish-write', e => {
    e.preventDefault()
    runFinish($item, $subject, slug, page)
  })
}

// One item's element, as wiki-client draws it, then the plugin emitted.
const drawItem = ($page, item) => $('<div />', { class: `item ${item.type}`, 'data-id': item.id }).data('item', item).data('pageElement', $page)

const applyActions = ($page, actions) => {
  const $story = $page.find('.story:first')
  for (const a of actions || []) {
    if (a.type === 'add') {
      const $new = drawItem($page, a.item)
      const $anchor = a.after ? $story.children(`.item[data-id="${a.after}"]`) : $()
      if ($anchor.length) $anchor.after($new)
      else if (a.after === null) $story.prepend($new)
      else $story.append($new)
      wiki.doPlugin($new, a.item)
    } else if (a.type === 'edit') {
      const $old = $story.children(`.item[data-id="${a.id}"]`)
      if (!$old.length) continue
      const $new = drawItem($page, a.item)
      $old.replaceWith($new)
      wiki.doPlugin($new, a.item)
    } else if (a.type === 'remove') $story.children(`.item[data-id="${a.id}"]`).remove()
  }
}

async function runFinish($item, $subject, slug, page) {
  const F = finishOf($item)
  if (!F || F.state === 'posting') return
  Object.assign(F, { state: 'posting', refused: false, line: 'Writing the Conclusion…', html: '' })
  paintFinish($item, page)
  let res
  let body = null
  try {
    res = await fetch('/system/api/plan/finish.json', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-cache',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ slug, conclusion: F.text, demo: F.demo }),
    })
    body = await res.json().catch(() => null)
  } catch (err) {
    Object.assign(F, { state: 'refused', refused: true, line: `Could not reach the farm: ${err.message}` })
    return paintFinish($item, page)
  }
  if (!res.ok) {
    // The farm's own words, verbatim: the 403 gate, a 400 rule, the 409 holder.
    Object.assign(F, { state: 'refused', refused: true, line: apiError(res, body) })
    return paintFinish($item, page)
  }
  const site = siteOfPage($subject)
  const demo = internal(body.demo.title, body.demo.slug, body.demo.foundOn || site)
  Object.assign(F, {
    state: 'done',
    open: false,
    refused: false,
    line: 'written',
    html:
      `${body.conclusion.replaced ? 'Replaced' : 'Wrote'} the Conclusion, ${body.conclusion.items} items above See, ending “The demo is ${demo}.”` +
      ` · ${body.see.added ? 'added the demo to See' : 'See already linked it'}` +
      ` · ${body.page.journalEntries} journal entries` +
      (body.asset && body.asset.rendered ? ` · <a href="${escapeHtml(body.asset.path)}" target="_blank">markdown</a> re-rendered` : ''),
  })
  // The plan in the lineup: the farm's actions drawn, then the fresh file as its data.
  try {
    applyActions($subject, body.actions)
    const fresh = await getJSON(`/${slug}.json`)
    const raw = $subject.data('data')
    if (raw && typeof raw === 'object') {
      raw.story = fresh.story
      raw.journal = fresh.journal
    } else $subject.data('data', fresh)
  } catch (_) {}
  if (document.body.contains($item[0])) render($item, $item.data('item') || {})
}

// ---------- Do Next Phase (0.9.0): the plan's Terminal Button ----------
//
// Do Next Phase does not ask a model for anything. It writes the plan's one
// Terminal Button (phaseButtonText in core.js) just after the next phase's
// last checkpoint, through the wiki's own add, edit and move, so the item on
// the site is byte-for-byte what the terminal service checks before it lets
// a non-local page type into a session. The click on that button is David's:
// it opens the terminal on this laptop, boots claude in the plan's session
// and types the brief in, and every step is approved there.

const TERMINAL_HEALTH = ['http://terminal.localhost/terminal/health', 'http://terminal.localhost:4288/terminal/health']

const terminalHealth = async () => {
  for (const url of TERMINAL_HEALTH) {
    try {
      const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2500) })
      if (r.ok) return await r.json()
    } catch (_) {}
  }
  return null
}

async function placeButton($item, $subject, slug, $box) {
  // The line is kept on the element, as Update Plan's is: the add re-renders
  // the items to the plan's right, this tool among them, and attachUpdate
  // paints planAnswer back into the new box.
  const say = (html, refused = false) => {
    $item[0].planAnswer = { refused, html }
    $item.find('.plan-answer').toggleClass('plan-refused', refused).html(html)
  }
  if (ownerHere() === false) return say(escapeHtml(`Log in to ${location.host} as its owner: Do Next Phase writes the plan's Do Phase button.`), true)
  $item.find('.plan-next-go').prop('disabled', true)
  try {
    say('Do Next Phase: placing the button…')
    let plan
    try {
      plan = await getJSON(`/${slug}.json`)
    } catch (_) {
      plan = $subject.data('data')
    }
    const phase = choosePhase(plan)
    if (!phase) return say('Every checkpoint is ticked: there is no next phase.', true)
    const report = reportTitle({ kind: 'next', planTitle: plan.title, phaseLabel: phase.label })
    // Fresh session per phase unless the plan's status item says CONTEXT carry;
    // a fresh one is pointed at the report of the phase before.
    const carry = planContext(plan) === 'carry'
    const before = phasesOf(plan).filter(p => p.number !== null && phase.number !== null && p.number < phase.number).pop()
    const previousReport = before ? reportTitle({ kind: 'next', planTitle: plan.title, phaseLabel: before.label }) : ''
    const session = buttonSession(slug, phase, { carry })
    const nextPhase = phasesOf(plan).find(p => p.number !== null && phase.number !== null && p.number > phase.number) || null
    const text = phaseButtonText({ title: plan.title, slug, base: location.origin, phase, reportTitle: report, carry, previousReport, nextPhase })
    const want = buttonPlacement(plan, phase, text)
    const $story = $subject.find('.story:first')
    let id
    if (want.add) {
      id = await addItem($subject, want.after, { type: 'terminal', id: randomId(), text })
    } else {
      id = want.existing.id
      const $it = $story.children(`.item[data-id="${id}"]`)
      if (want.move) {
        const $anchor = $story.children(`.item[data-id="${want.after}"]`)
        if ($anchor.length && $it.length) $anchor.after($it)
        const order = $story.children('.item').map((_, el) => $(el).data('id')).get()
        await putAndWait($subject, { type: 'move', id, order })
      }
      if (want.edit) {
        const item = { ...want.existing, text }
        if ($it.length) {
          $it.data('item', item).empty()
          wiki.doPlugin($it, item)
        }
        await putAndWait($subject, { type: 'edit', id, item })
      }
    }
    const did = want.add ? 'added' : want.edit || want.move ? `${[want.edit && 'rewritten', want.move && 'moved'].filter(Boolean).join(' and ')}` : 'already in place'
    const $button = $story.children(`.item[data-id="${id}"]`)
    if ($button.length && $button[0].scrollIntoView) $button[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    const health = await terminalHealth()
    const ready = health
      ? ` The terminal service on this laptop answers.`
      : ` <span class="plan-refused">The terminal service on this laptop did not answer this page. It runs only on the laptop, and a page from ${escapeHtml(location.host)} also needs the site listed in ~/.config/wiki-plugin-terminal/trust.json and the padlock opened on the button.</span>`
    say(
      `Do ${escapeHtml(phase.label)} is on the plan (${escapeHtml(did)}), just after its last checkpoint. ` +
        `Click it: it opens a Claude Code session on this laptop (${escapeHtml(session)}, ${carry ? 'carrying the conversation of earlier phases, as the plan says CONTEXT carry' : 'a fresh one for this phase; put CONTEXT carry on the plan item to keep one conversation'}) and types the phase in. You watch the work and approve each step there; ` +
        `the session ticks what it verified, writes ${internal(report, asSlug(report), location.host)} and moves the button on.` +
        ready,
    )
  } catch (err) {
    say(escapeHtml(`Could not place the button: ${err.message}`), true)
  } finally {
    $item.find('.plan-next-go').prop('disabled', false)
  }
}

// ---------- Do Next Phase and Revise Plan (Phase 4) ----------
//
// Each button POSTs to the Plan API on the plan's own origin (next.json or
// revise.json), where the farm gates it and the handler claims the WIP marker
// and starts a job: the plan, the phase, the skills it names and the pages it
// links go to the shared Claude door. The tool polls job.json every three
// seconds, the elapsed time in its line, and on success opens the answer as a
// GHOST PAGE to the right — a phase report or a redraft, each point its own
// item — written nowhere. "Save and link it" then makes the ghost a real page
// on the plan's site and adds one [[link]] item to the plan, the Voice Tool's
// "Save page & link it" (wiki-plugin-audionote client/main.js), by the same
// means: the ghost's own fork flag, then a journaled add.
//
// The run's state lives on the element ($item[0].planAgent), so a re-render
// (a neighbour's sitemap landing, Update Plan's re-emit) repaints it.

const AGENT_NAME = { next: 'Do Next Phase', revise: 'Revise Plan', site: 'Revise Site', redlink: 'Red-link' }
const AGENT_PATH = { next: 'next', revise: 'revise', site: 'revise-site', redlink: 'redlink' }
// The kinds whose ghost has the plan's own title and is saved over the plan.
const OVER = new Set(['revise'])
const POLL_MS = 3000
const sleep = ms => new Promise(r => setTimeout(r, ms))
const agentOf = $item => ($item[0] && $item[0].planAgent) || null
const busy = A => !!A && (A.state === 'posting' || A.state === 'running' || A.state === 'saving' || A.state === 'applying')
const secs = ms => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const ghostIsOpen = A => !!(A && A.$ghost && A.$ghost.hasClass('ghost') && document.contains(A.$ghost[0]))

// Who answered, for the status line: the model, or Auto's pick with its reason
// ("auto → glm-5.3-flash-pp: 34k tokens, 3 answers").
const byWhom = (A, model) => (A.auto && A.auto.model ? escapeHtml(autoLine(A.auto)) : `by ${escapeHtml(String(model || '').replace(/^claude-cli:/, ''))}`)

function paintAgent($item) {
  const A = agentOf($item)
  const $line = $item.find('.plan-agent')
  $item.find('.plan-next-go, .plan-revise-go, .plan-site-go, .plan-redlink-go, .plan-revise-run').prop('disabled', busy(A))
  if (!A || !$line.length) return
  const name = A.kind === 'revise' && A.how ? `Revise Plan, ${reviseHowText(A.how.mode)}` : AGENT_NAME[A.kind]
  const what = A.phase ? ` on ${escapeHtml(A.phase.label)}` : ''
  const model = A.auto && A.auto.model ? `, ${escapeHtml(autoLine(A.auto))}` : A.model === 'auto' ? ', auto choosing the model' : A.model ? ` with ${escapeHtml(String(A.model).replace(/^claude-cli:/, ''))}` : ''
  let html = ''
  if (A.state === 'posting') html = `${name}: asking the farm…`
  else if (A.state === 'running' && A.kind === 'redlink') {
    const P = A.progress
    html = P ? `Red-link${model}: researching page ${P.n} of ${P.of}, ${escapeHtml(P.title)}, on the web… ${secs(Date.now() - A.started)}` : `Red-link${model}: finding the red links… ${secs(Date.now() - A.started)}`
  } else if (A.state === 'running') html = `${name}${what}${model}: the model is reading the ${A.kind === 'site' ? 'answers and every page of the site' : 'plan'}… ${secs(Date.now() - A.started)}`
  else if (A.state === 'refused' || A.state === 'failed') html = escapeHtml(A.line)
  else if (A.kind === 'site' && (A.state === 'done' || A.state === 'saving')) {
    const open = ghostIsOpen(A)
    const s = A.result.proposal || {}
    const rows = Object.entries(s.actions || {})
      .map(([k, n]) => `${n} ${escapeHtml(k)}`)
      .join(', ')
    html =
      `Revise Site: ${escapeHtml(A.reportTitle)} ${byWhom(A, A.result.model)}, in ${secs(A.result.ms || 0)}` +
      (rows ? `, ${s.rows} pages (${rows}), ${s.untouched || 0} untouched, ${s.names || 0} names to confirm` : '') +
      (open ? `; open as a ghost page, nothing written.` : `; its ghost page is closed.`) +
      ` <button class="plan-go" ${A.state === 'saving' ? 'disabled' : ''} title="Save the proposal as a page, then rewrite the pages it names one at a time through the door, the plan last">Go Ahead</button>` +
      ` <button class="plan-pause" ${A.state === 'saving' ? 'disabled' : ''} title="Save the proposal as a page and link it from the plan; nothing else is written">Pause</button>` +
      (A.line ? ` <span class="plan-refused">${escapeHtml(A.line)}</span>` : '')
  } else if (A.state === 'applying') {
    const P = A.progress || {}
    html = `Go Ahead from ${escapeHtml(A.proposalTitle)}` + (P.of ? `: page ${P.n || 0} of ${P.of}${P.title ? `, ${escapeHtml(P.title)}` : ''}` : ': starting') + (P.auto ? `, ${escapeHtml(P.auto)}` : '') + `… ${secs(Date.now() - A.applyStarted)}`
  } else if (A.state === 'applied') html = A.html
  else if (A.kind === 'redlink' && A.state === 'done') {
    const R = A.result || {}
    const M = A.meta || { questions: [], more: 0 }
    const link = x => internal(x.title, x.slug, location.host)
    const w = R.written || []
    html =
      `Red-link wrote ${w.length} page${w.length === 1 ? '' : 's'}, each researched on the web by ${escapeHtml(String(R.model || '').replace(/^claude-cli:/, ''))}, in ${secs(R.ms || 0)}${w.length ? `: ${w.map(x => link(x) + (x.overStub ? ' (over its stub)' : '')).join(', ')}` : ''}.` +
      ((R.skipped || []).length ? ` Skipped, a page is there now: ${R.skipped.map(x => escapeHtml(x.title)).join(', ')}.` : '') +
      ((R.failed || []).length ? ` <span class="plan-refused">Failed: ${R.failed.map(x => `${escapeHtml(x.title)} (${escapeHtml(x.error)})`).join('; ')}.</span>` : '') +
      ((M.questions || []).length ? ` ${M.questions.length} question link${M.questions.length === 1 ? ' is' : 's are'} left for their answers.` : '') +
      (M.more ? ` ${M.more} more red link${M.more === 1 ? '' : 's'}: press Red-link again.` : '')
  } else if (A.kind === 'revise' && (A.state === 'done' || A.state === 'saving')) {
    const open = ghostIsOpen(A)
    html =
      `${name}: a redraft of ${escapeHtml(A.title)} ${byWhom(A, A.result.model)}, in ${secs(A.result.ms || 0)}, ` +
      (open ? `open as a ghost with the plan's own title; nothing is written until you fork it or Save.` : `its ghost is closed; Save still writes it.`) +
      ` <button class="plan-save-over" ${A.state === 'saving' ? 'disabled' : ''} title="Save overwrites the plan in place with a rewindable journal: the version it replaces stays in the journal as its _rev, and Rewind opens it beside the plan to fork back">Save over the plan</button>` +
      (A.line ? ` <span class="plan-refused">${escapeHtml(A.line)}</span>` : '')
  } else if (A.state === 'done' || A.state === 'saving') {
    const open = ghostIsOpen(A)
    html =
      `${name}${what}: ${escapeHtml(A.title)} report ${byWhom(A, A.result.model)}, in ${secs(A.result.ms || 0)}, ` +
      (open ? `open as the ghost page <b>${escapeHtml(A.reportTitle)}</b>; nothing is written to the plan.` : `its ghost page is closed.`) +
      (A.ticks ? ` ${escapeHtml(A.ticks)}` : '') +
      ` <button class="plan-save" ${A.state === 'saving' ? 'disabled' : ''} title="Save the ghost as a page on this site and link it from the plan">Save and link it</button>` +
      (A.line ? ` <span class="plan-refused">${escapeHtml(A.line)}</span>` : '')
  } else if (A.state === 'saved') html = A.html + (A.kind === 'site' && A.savedSlug ? ` <button class="plan-go" data-proposal="${escapeHtml(A.savedSlug)}" title="Rewrite the pages the saved proposal names, one at a time through the door, the plan last; names still unticked on it are not copied">Go Ahead</button>` : '')
  $line.toggleClass('plan-refused', A.state === 'refused' || A.state === 'failed').html(html)
}

const apiError = (res, body) => `${res.status}: ${(body && body.error) || `the farm answered ${res.status}`}`

async function runAgent($item, $subject, slug, kind, how = null) {
  if (busy(agentOf($item))) return
  SAVED.delete(slug)
  const A = { kind, slug, state: 'posting', started: Date.now(), line: '', $subject, ...(how ? { how } : {}) }
  $item[0].planAgent = A
  paintAgent($item)
  let res
  let body = null
  try {
    res = await fetch(`/system/api/plan/${AGENT_PATH[kind]}.json`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-cache',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ slug, ...(chosenModel() ? { model: chosenModel() } : {}), ...(how || {}) }),
    })
    body = await res.json().catch(() => null)
  } catch (err) {
    Object.assign(A, { state: 'failed', line: `Could not reach the farm: ${err.message}` })
    return paintAgent($item)
  }
  // The farm's own words, verbatim: the 403 gate, the 409 WIP holder, a 400.
  if (!res.ok) {
    Object.assign(A, { state: 'refused', line: apiError(res, body) })
    return paintAgent($item)
  }
  Object.assign(A, { state: 'running', job: body.job, title: body.title, phase: body.phase, reportTitle: body.reportTitle, model: body.model })
  paintAgent($item)

  let misses = 0
  while (A.state === 'running') {
    await sleep(POLL_MS)
    let j = null
    try {
      const r = await fetch(`/system/api/plan/job.json?id=${encodeURIComponent(A.job)}`, { credentials: 'include', cache: 'no-cache', headers: { Accept: 'application/json' } })
      const b = await r.json().catch(() => null)
      if (!r.ok) {
        Object.assign(A, { state: 'failed', line: apiError(r, b) })
        break
      }
      j = b
      misses = 0
    } catch (err) {
      if (++misses > 5) Object.assign(A, { state: 'failed', line: `Lost the farm while waiting: ${err.message}` })
      paintAgent($item)
      continue
    }
    A.progress = j.progress || null
    if (j.auto) A.auto = j.auto
    if (j.status === 'failed') Object.assign(A, { state: 'failed', line: `${AGENT_NAME[kind]} failed: ${j.error}` })
    else if (j.status === 'done') {
      A.result = j.result
      A.meta = j.meta || null
      A.reportTitle = j.result.reportTitle || A.reportTitle
      const t = j.result.proposedTicks
      if (t) A.ticks = !t.found ? 'The report has no Proposed Ticks section.' : t.none ? 'It proposes no ticks.' : `It proposes ${t.listed.length} tick${t.listed.length === 1 ? '' : 's'}, listed on the report; none was made.`
      if (OVER.has(kind)) {
        try {
          A.plan = await getJSON(`/${slug}.json`)
        } catch (_) {
          A.plan = $subject.data('data')
        }
      }
      A.state = 'done'
      if (kind === 'redlink') setTimeout(() => document.body.contains($item[0]) && render($item, $item.data('item') || {}), 1500)
      else openReport($item, A)
    }
    paintAgent($item)
  }
  paintAgent($item)
}

// The report's items, once: the ghost reopens with the same ids.
const itemsOf = A => {
  if (A.items) return A.items
  return (A.items =
    A.kind === 'site'
      ? proposalItems({ markdown: A.result.markdown, planTitle: A.title, site: location.host, model: A.result.model })
      : A.kind === 'revise'
        ? reviseItems({ page: A.plan, markdown: A.result.markdown, model: A.result.model, ...(A.how || {}) })
        : reportItems({ kind: A.kind, markdown: A.result.markdown, planTitle: A.title, phaseLabel: A.phase ? A.phase.label : '', model: A.result.model }))
}

function openReport($item, A) {
  const $from = $item.parents('.page').first()
  A.$ghost = openGhost($from, A.reportTitle, itemsOf(A))
  if (OVER.has(A.kind)) guardGhost(A.$ghost, 'Save over the plan: overwrite it in place with a rewindable journal', () => saveOver($item, A.$subject))
}

// A ghost with the plan's own slug (the revision) or a _rev of it is never
// saved the wiki's way: its fork flag would replace the plan with the ghost
// and a fresh journal. The flag runs the tool's journaled write instead, and
// the ghost's items and title are not edited in place (edit the plan after
// Save). Capturing listeners on the ghost run before wiki-client's own,
// which are delegated from .main.
function guardGhost($ghost, title, onSave) {
  const el = $ghost && $ghost[0]
  if (!el || el.planGuarded) return
  el.planGuarded = true
  el.addEventListener(
    'click',
    e => {
      if (!e.target.closest('.fork-page')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onSave()
    },
    true,
  )
  el.addEventListener(
    'dblclick',
    e => {
      if (!e.target.closest('.item') && !e.target.closest('h1')) return
      e.preventDefault()
      e.stopImmediatePropagation()
    },
    true,
  )
  $ghost.find('h1 .title').removeAttr('contenteditable')
  $ghost.find('.fork-page').attr('title', title)
}

// COPIED from wiki-plugin-audionote client/voice.js (openGhost, ghostTitle,
// pageExists, saveGhost, putAndWait, addItem, randomId): the Voice Tool's
// ghost page and its save, reused rather than reinvented.
//
// A ghost carries a journal of exactly one `create`. wiki-client reads that as
// "a page about to be made": its title can be edited in place, and its fork
// flag saves it as a real page under whatever the title then says.
function openGhost($fromPage, title, items) {
  const story = items.map(i => ({ ...i }))
  const page = wiki.newPage({ title, story, journal: [{ type: 'create', item: { title, story: items.map(i => ({ ...i })) }, date: Date.now() }] })
  wiki.showResult(page, { $page: $fromPage })
  return $fromPage.nextAll('.page').first()
}

const ghostTitle = $ghost => $ghost.find('h1 .title').text().trim().replace(/\s+/g, ' ') || $ghost.find('h1').text().trim().replace(/\s+/g, ' ')

async function pageExists(title) {
  try {
    return (await fetch(`/${asSlug(title)}.json`, { method: 'HEAD', cache: 'no-cache' })).ok
  } catch {
    return false
  }
}

function saveGhost($ghost) {
  return new Promise((resolve, reject) => {
    // wiki-client draws the fork flag only for someone who may write here
    if (!$ghost.find('.fork-page').length) return reject(new Error(`log in to ${location.host} as its owner to save a page here`))
    const done = () => {
      clearTimeout(fallback)
      $(document).off('ajaxComplete', handler)
      resolve()
    }
    const fallback = setTimeout(done, 4000)
    const handler = (e, xhr, settings) => (settings.url || '').includes('/action') && done()
    $(document).on('ajaxComplete', handler)
    // Settle a title edited on the ghost first, as the flag handler would.
    const pageObject = window.wiki && wiki.lineup && wiki.lineup.atKey ? wiki.lineup.atKey($ghost.data('key')) : null
    if (pageObject) {
      const newtitle = ghostTitle($ghost)
      if (newtitle && newtitle !== pageObject.getTitle()) {
        $ghost.attr('id', asSlug(newtitle))
        pageObject.setCreateTitle(newtitle)
        $ghost.find('h1 .title').removeAttr('contenteditable')
      }
    }
    $ghost.find('.fork-page').first().trigger('click')
  })
}

// The wiki server applies each action with an unserialised read-modify-write
// of the page file: one put at a time, ajaxComplete signals the landing.
function putAndWait($page, action) {
  return new Promise(resolve => {
    const fallback = setTimeout(() => {
      $(document).off('ajaxComplete', handler)
      resolve()
    }, 3000)
    const handler = (e, xhr, settings) => {
      if ((settings.url || '').includes('/action')) {
        clearTimeout(fallback)
        $(document).off('ajaxComplete', handler)
        resolve()
      }
    }
    $(document).on('ajaxComplete', handler)
    wiki.pageHandler.put($page, action)
  })
}

const randomId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('')

/** Add one item after `afterId`, in the DOM and on the server: the add the wiki journals. */
async function addItem($page, afterId, item) {
  const $story = $page.find('.story:first')
  const $anchor = afterId ? $story.children(`.item[data-id="${afterId}"]`) : $()
  const $new = $('<div />', { class: `item ${item.type}`, 'data-id': item.id }).data('item', item).data('pageElement', $page)
  if ($anchor.length) $anchor.after($new)
  else if (afterId === null) $story.prepend($new)
  else $story.append($new)
  wiki.doPlugin($new, item)
  await putAndWait($page, { type: 'add', id: item.id, item, after: afterId })
  return item.id
}

// Save the ghost as a page on the plan's site, then link it from the plan: a
// report's link right after its phase's last checkpoint item, a revision's at
// the end of the See section (linkAfter in core.js). Proposed ticks stay on
// the report; nothing on the plan is ticked.
async function saveAndLink($item, $subject) {
  const A = agentOf($item)
  if (!A || !A.result || A.state === 'saving') return null
  const fail = message => {
    A.state = 'done'
    A.line = message
    paintAgent($item)
    return null
  }
  if (ownerHere() === false) return fail(`log in to ${location.host} as its owner to save a page here`)
  if (!ghostIsOpen(A)) openReport($item, A)
  const title = ghostTitle(A.$ghost) || A.reportTitle
  if (await pageExists(title)) return fail(`“${title}” already exists here — change the title on the ghost and save again`)
  A.state = 'saving'
  A.line = ''
  paintAgent($item)
  try {
    await saveGhost(A.$ghost)
    const plan = $subject.data('data') || (await getJSON(`/${slugOf($subject)}.json`))
    const phase = A.phase ? (A.phase.number !== null && A.phase.number !== undefined ? A.phase.number : A.phase.heading) : null
    const asList = A.kind === 'revise' || A.kind === 'site'
    const after = linkAfter(plan, { kind: asList ? 'revise' : A.kind, phase })
    const text = asList ? `- [[${title}]]` : `[[${title}]]`
    await addItem($subject, after, { type: 'markdown', id: randomId(), text })
    const where = asList ? 'at the end of its See section' : `after the last checkpoint of ${A.phase.label}`
    A.state = 'saved'
    A.savedSlug = asSlug(title)
    A.savedTitle = title
    A.html =
      A.kind === 'site'
        ? `Paused: saved ${internal(title, asSlug(title), location.host)} and linked it from the plan, ${escapeHtml(where)}. Nothing else was written. Tick the names that may travel on it, then Go Ahead.`
        : `Saved ${internal(title, asSlug(title), location.host)} and linked it from the plan, ${escapeHtml(where)}. Nothing was ticked.`
  } catch (err) {
    return fail(`Could not save it: ${err.message}`)
  }
  paintAgent($item)
  return title
}

// ---------- Save over the plan, the _rev and Rewind (Phase 8) ----------
//
// Save over the plan POSTs the ghost's story to save-revision.json, where the
// farm writes it over the plan through the journal; the plan is then opened
// fresh in its place in the lineup, its status line saying when it was
// revised and linking the version replaced, its _rev. Rewind writes nothing.

// What the last Save said, by plan slug: the plan reopens as a new element,
// so the line is kept here, not on the element.
const SAVED = new Map()

const savedHtml = (verb, body) => {
  const c = body.journal.count || {}
  const counts = Object.entries(c)
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
  return (
    `${verb}: ${body.journal.entries} journal entries${counts ? ` (${escapeHtml(counts)})` : ''}` +
    (body.journal.reconciled ? `, after ${body.journal.reconciled} that bring the journal level with the page` : '') +
    ` · the version it replaced: <a href="${escapeHtml(body.previous.path)}" class="plan-rev" data-rev="${body.previous.rev}">${escapeHtml(body.previous.title)}</a>` +
    (body.asset && body.asset.rendered ? ` · <a href="${escapeHtml(body.asset.path)}" target="_blank">markdown</a> ${body.asset.changed ? 're-rendered' : 'unchanged'}` : '')
  )
}

const postJSON = async (path, payload) => {
  const res = await fetch(`/system/api/plan/${path}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-cache',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  return { res, body }
}

// The plan opened fresh where it stands: everything from it on closes, and it
// opens again from the farm; the Plan Tool after it too, when that is where
// the button was.
function reopenPlan($item, $subject) {
  const title = titleOfPage($subject)
  const $tool = $item.parents('.page').first()
  const toolAfter = $tool.length && $tool[0] !== $subject[0]
  const $prev = $subject.prev('.page')
  if (window.wiki && wiki.pageHandler) wiki.pageHandler.context = ['view']
  if ($prev.length) wiki.doInternalLink(title, $prev)
  else {
    const key = $subject.data('key')
    $subject.nextAll('.page').remove()
    if (wiki.lineup) {
      wiki.lineup.removeAllAfterKey(key)
      wiki.lineup.removeKey(key)
    }
    $subject.remove()
    wiki.doInternalLink(title, null)
  }
  // The Plan Tool opens again after the plan; the Revise Plan page does not:
  // the plan's own status line now says what was saved.
  if (toolAfter && slugOf($tool) === 'plan-tool') setTimeout(() => wiki.doInternalLink('Plan Tool', $('.page').last()), 600)
}

const closeGhost = $ghost => {
  if (!$ghost || !$ghost.length) return
  try {
    if (wiki.lineup) wiki.lineup.removeKey($ghost.data('key'))
  } catch (_) {}
  $ghost.remove()
}

async function saveOver($item, $subject) {
  const A = agentOf($item)
  if (!A || !OVER.has(A.kind) || !A.result || A.state === 'saving') return
  const fail = line => {
    A.state = 'done'
    A.line = line
    paintAgent($item)
  }
  if (ownerHere() === false) return fail(`log in to ${location.host} as its owner to save over the plan`)
  A.state = 'saving'
  A.line = ''
  paintAgent($item)
  let out
  try {
    out = await postJSON('save-revision.json', { slug: A.slug, story: itemsOf(A), model: A.result.model, kind: A.kind, ...(A.how || {}) })
  } catch (err) {
    return fail(`Could not reach the farm: ${err.message}`)
  }
  if (!out.res.ok) return fail(apiError(out.res, out.body))
  if (!out.body.written) return fail(`Nothing written: ${out.body.why}`)
  SAVED.set(A.slug, { html: savedHtml('Saved over the plan', out.body) })
  $item[0].planAgent = null
  closeGhost(A.$ghost)
  reopenPlan($item, $subject)
}

// The link: the rev as the wiki itself opens one from the journal, the
// action at index n clicked on the plan's journal; failing that, the same
// page drawn by showResult with the rev's id.
async function openRev($item, $subject, n) {
  const $action = $subject.find('.journal .action').not('.separator').eq(n)
  if ($action.length) return void $action.trigger('click')
  const page = await getJSON(`${baseFor(siteOfPage($subject))}/${slugOf($subject)}.json`)
  const rev = rewindPage(page, n)
  if (!rev) throw new Error(`${page.title} has no rev ${n}`)
  wiki.showResult(wiki.newPage(rev), { $page: $subject, rev: n })
}

// Rewind: the rev the journal holds (rewindPage: wiki-client's revision.js
// replay, as /view/<slug>_rev<n> draws it) opened beside the plan as a ghost
// with the plan's own title, its journal up to that entry. The tool writes
// nothing. The ghost's own fork flag is the rewind, the wiki's fork of a
// revision; closing it leaves the plan as it is. The note under the title is
// drawn on the page, not in its story, so a fork never carries it. Its id is
// the plan's slug, not <slug>_rev<n>: wiki-client deletes the page when a
// _rev0 is forked.
async function openRewind($item, $subject, n) {
  const page = await getJSON(`${baseFor(siteOfPage($subject))}/${slugOf($subject)}.json`)
  const rev = rewindPage(page, n)
  if (!rev) throw new Error(`${page.title} has no rev ${n}`)
  const $from = $item.parents('.page').first()
  wiki.showResult(wiki.newPage(rev), { $page: $from })
  const $ghost = $from.nextAll('.page').first()
  $ghost.find('h1 .title').removeAttr('contenteditable')
  const at = page.journal[n] && page.journal[n].date ? `, ${new Date(page.journal[n].date).toISOString().slice(0, 10)}` : ''
  $ghost
    .find('.header')
    .first()
    .append(`<p class="plan-rev-note">Revision ${n} of ${internal(page.title, slugOf($subject), location.host)} from the journal${escapeHtml(at)}; fork it to rewind.</p>`)
  $ghost.find('.fork-page').attr('title', `Fork ${revLabel(page.title, n)} over ${page.title}: the rewind`)
  // The fork is the wiki's; once it lands, the markdown asset follows it, as
  // after Save. Listened for, never intercepted.
  const slug = slugOf($subject)
  $ghost[0].addEventListener('click', e => {
    if (!e.target.closest('.fork-page')) return
    const landed = (_e, _xhr, settings) => {
      if (!(settings.url || '').includes(`/page/${slug}/action`)) return
      $(document).off('ajaxComplete', landed)
      postJSON('render.json', { slug }).catch(() => {})
    }
    $(document).on('ajaxComplete', landed)
  })
}

// ---------- Go Ahead (Phase 7) ----------
//
// From the ghost: save it first, as Pause does, then go ahead. From a saved
// proposal (after Pause, or one the plan links that has not been applied):
// go ahead on that page. Either way the button POSTs the proposal's slug and
// the plan's to apply-revision.json, and the tool polls the job, its line
// saying which page of how many is with the door. The pages are written on
// the farm, whole and journaled; the account comes back with each page's
// bytes before and after, and each refusal and why. The plan in the lineup
// takes the fresh file as its data; the other pages open fresh from their links.
async function goAhead($item, $subject, planSlug, proposalSlug) {
  let A = agentOf($item)
  if (busy(A)) return
  let slug = proposalSlug
  let title = null
  if (!slug) {
    if (!A || A.kind !== 'site' || !A.result) return
    title = await saveAndLink($item, $subject)
    if (!title) return
    slug = asSlug(title)
  }
  if (!A || A.kind !== 'site') {
    A = { kind: 'site', slug: planSlug, state: 'saved', started: Date.now(), line: '' }
    $item[0].planAgent = A
  }
  title = title || A.savedTitle || (A.offered && A.offered.title) || slug
  Object.assign(A, { state: 'applying', proposalTitle: title, applyStarted: Date.now(), progress: null, line: '' })
  paintAgent($item)
  const fail = line => {
    Object.assign(A, { state: 'saved', html: `<span class="plan-refused">${escapeHtml(line)}</span>`, savedSlug: slug, savedTitle: title })
    paintAgent($item)
  }
  let res
  let body = null
  try {
    res = await fetch('/system/api/plan/apply-revision.json', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-cache',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ slug, plan: planSlug, ...(chosenModel() ? { model: chosenModel() } : {}) }),
    })
    body = await res.json().catch(() => null)
  } catch (err) {
    return fail(`Could not reach the farm: ${err.message}`)
  }
  if (!res.ok) return fail(apiError(res, body))
  A.applyJob = body.job
  A.progress = { n: 0, of: body.pages.length, title: '' }
  paintAgent($item)
  const timer = setInterval(() => A.state === 'applying' && paintAgent($item), 1000)
  let misses = 0
  let j = null
  while (A.state === 'applying') {
    await sleep(POLL_MS)
    try {
      const r = await fetch(`/system/api/plan/job.json?id=${encodeURIComponent(A.applyJob)}`, { credentials: 'include', cache: 'no-cache', headers: { Accept: 'application/json' } })
      const b = await r.json().catch(() => null)
      if (!r.ok) {
        clearInterval(timer)
        return fail(apiError(r, b))
      }
      j = b
      misses = 0
    } catch (err) {
      if (++misses > 5) {
        clearInterval(timer)
        return fail(`Lost the farm while waiting: ${err.message}`)
      }
      continue
    }
    A.progress = j.progress
    if (j.status !== 'running') break
    paintAgent($item)
  }
  clearInterval(timer)
  A.state = 'applied'
  A.html = appliedHtml(j, title, slug)
  // The plan in the lineup takes the fresh file as its data.
  try {
    const fresh = await getJSON(`/${planSlug}.json`)
    const raw = $subject.data('data')
    if (raw && typeof raw === 'object') {
      raw.story = fresh.story
      raw.journal = fresh.journal
    } else $subject.data('data', fresh)
  } catch (_) {}
  paintAgent($item)
}

const kb = n => (n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`)

function appliedHtml(j, title, slug) {
  const a = (j && j.account) || {}
  const link = (t, s) => internal(t, s || asSlug(t), location.host)
  const parts = []
  if (j.status === 'failed') parts.push(`<span class="plan-refused">Go Ahead failed: ${escapeHtml(j.error || 'unknown')}</span>`)
  const w = a.written || []
  parts.push(`Go Ahead from ${link(title, slug)}: ${w.length} page${w.length === 1 ? '' : 's'} written, ${(a.refused || []).length} refused, ${(a.failed || []).length} failed, ${(a.kept || []).length} kept.`)
  if (w.length)
    parts.push(
      `<ul>${w
        .map(x => `<li>${link(x.title, x.slug)} ${escapeHtml(x.action)} · ${kb(x.before)} → ${kb(x.after)}` + (x.auto ? ` · ${escapeHtml(x.auto)}` : '') + (x.linksDropped ? ` · links dropped: ${escapeHtml(x.linksDropped.join(', '))}` : '') + '</li>')
        .join('')}</ul>`,
    )
  if ((a.refused || []).length) parts.push(`Refused: <ul>${a.refused.map(x => `<li>${escapeHtml(x.title)} — ${escapeHtml(x.why)}</li>`).join('')}</ul>`)
  if ((a.failed || []).length) parts.push(`Failed: <ul>${a.failed.map(x => `<li>${escapeHtml(x.title)} — ${escapeHtml(x.error)}</li>`).join('')}</ul>`)
  parts.push(`Each page was written whole with a journal edit naming the answers; open it from its link, or <a href="${escapeHtml(location.href)}" onclick="location.reload();return false">reload the lineup</a>, to see it fresh.`)
  return parts.join(' ')
}

// A proposal the plan links in See, saved and not yet applied, offers Go
// Ahead after a reload: Pause is a pause, not an end.
async function offerSavedProposal($item, $subject, page) {
  const A = agentOf($item)
  if (busy(A) || (A && (A.state === 'saved' || A.state === 'applied'))) return
  const titles = []
  for (const it of page.story || []) for (const t of wikilinksIn(it && it.text)) if (t.startsWith(PROPOSAL_TITLE)) titles.push(t)
  const title = titles[titles.length - 1]
  if (!title) return
  let p
  try {
    p = await getJSON(`/${asSlug(title)}.json`)
  } catch (_) {
    return
  }
  if (proposalApplied(p) || !parseProposal(p).rows.length) return
  const $line = $item.find('.plan-agent')
  if (!$line.length || $line.children().length || $line.text().trim()) return
  $item[0].planAgent = { kind: 'site', slug: slugOf($subject), state: 'saved', savedSlug: asSlug(title), savedTitle: title, offered: { title }, html: `${internal(title, asSlug(title), location.host)} is saved and not yet applied.` }
  paintAgent($item)
}

const answerHtml = (r, site) => {
  const parts = []
  // Questions end in "?", so the parts are set apart with a dot, not ended with a full stop.
  if (r.ticked.length) parts.push(`Ticked ${r.ticked.length}: ${r.ticked.map(t => internal(t.title, t.slug, t.foundOn || site) + (t.by === 'inline' ? ' (answered on its line)' : '')).join('; ')}`)
  else parts.push('Nothing to tick')
  if (r.unanswered.length) parts.push(`still unanswered: ${r.unanswered.map(q => internal(q.title, q.slug, site) + (q.query ? ' (asked back)' : '')).join('; ')}`)
  if (r.asset && r.asset.rendered) parts.push(`<a href="${escapeHtml(r.asset.path)}" target="_blank">markdown</a> ${r.asset.changed ? 're-rendered' : 'unchanged'}`)
  return parts.join(' · ')
}

const runUpdate = async ($item, $subject, slug, $box) => {
  SAVED.delete(slug)
  const $answer = $box.find('.plan-answer').removeClass('plan-refused').text('Updating…')
  $box.find('.plan-update-go').prop('disabled', true)
  const site = siteOfPage($subject)
  let res
  let body = null
  try {
    res = await fetch('/system/api/plan/update.json', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-cache',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ slug }),
    })
    body = await res.json().catch(() => null)
  } catch (err) {
    $box.find('.plan-update-go').prop('disabled', false)
    return $answer.addClass('plan-refused').text(`Could not reach the farm: ${err.message}`)
  }
  if (!res.ok) {
    // The farm's own words, verbatim: the 403 gate, the 409 WIP holder.
    const text = (body && body.error) || `the farm answered ${res.status}`
    $item[0].planAnswer = { refused: true, html: escapeHtml(`${res.status}: ${text}`) }
    $box.find('.plan-update-go').prop('disabled', false)
    return $answer.addClass('plan-refused').text(`${res.status}: ${text}`)
  }
  $item[0].planAnswer = { refused: false, html: answerHtml(body, site) }

  // Read the page again and put it in the lineup: the subject's own data, then
  // each ticked item re-emitted, which re-renders everything to its right.
  let fresh = null
  try {
    fresh = await getJSON(`/${slug}.json`)
  } catch (_) {}
  if (fresh && Array.isArray(fresh.story)) {
    const raw = $subject.data('data')
    if (raw && typeof raw === 'object') {
      raw.story = fresh.story
      raw.journal = fresh.journal
    } else $subject.data('data', fresh)
    const ids = new Set(body.ticked.map(t => t.id))
    let from = -1
    for (const it of fresh.story) {
      if (!it || !ids.has(it.id)) continue
      const $it = $subject.find(`.item[data-id="${it.id}"]`).first()
      if (!$it.length) continue
      $it.data('item', it)
      const i = $('.item').index($it)
      if (from === -1 || i < from) from = i
    }
    const self = $('.item').index($item)
    if (from !== -1 && window.wiki && typeof wiki.renderFrom === 'function') {
      await wiki.renderFrom(from)
      if (self >= from) return // re-emitted with the rest, answer and all
    }
  }
  render($item, $item.data('item') || {})
}

// The page JSON of a page in the lineup: the lineup's own copy, or the file.
const pageJson = async $page => {
  const data = $page.data('data')
  if (data && Array.isArray(data.story)) return data
  return getJSON(`${baseFor(siteOfPage($page))}/${slugOf($page)}.json`)
}

// ---------- page actions ----------
//
// The tool can act on the page to its left as well as read it. The first
// action is Trash Page: the server's own DELETE, which moves the page to the
// site's recycler, where the Recycled Pages page (shipped by the recycler
// plugin) lists it and a fork brings it back. It is here because the usual
// delete, forking the creation ghost, fails on a page whose journal starts
// with a fork: that action opens the remote copy, not revision 0 (trashable()
// in core.js says who qualifies).
const RECYCLED = `<a class="internal" href="/recycled-pages.html" data-page-name="recycled-pages" title="origin">Recycled Pages</a>`

const pageStateOf = $page => ({
  site: $page.data('site') || null,
  host: location.host,
  ghost: $page.hasClass('ghost'),
  local: $page.hasClass('local'),
  recycler: $page.hasClass('recycler'),
  id: $page.attr('id') || '',
})

const attachActions = ($item, opts) => {
  if (!opts.subject) return
  const $page = $item.parents('.page').first()
  const $left = $page.length ? leftSubject($page) : null
  if (!$left || !$left.length) return
  const title = titleOfPage($left)
  const slug = slugOf($left)
  const can = trashable(pageStateOf($left))
  const $box = $('<div class="plan-actions"></div>')
  const draw = () => {
    if (can.ok) {
      $box.html(`<span>Page to the left: <b>${escapeHtml(title)}</b></span> <button class="plan-trash">Trash Page</button> <span class="plan-actions-note"></span> · ${RECYCLED}`)
    } else {
      $box.html(`<span>Page to the left: <b>${escapeHtml(title)}</b>, ${escapeHtml(can.why)}.</span> · ${RECYCLED}`)
    }
  }
  draw()
  $item.find('.plan-tool').append($box)
  if (!can.ok) return
  $box.on('click', '.plan-trash', e => {
    e.preventDefault()
    $box.find('.plan-trash').replaceWith(
      `<span class="plan-confirm">Move <b>${escapeHtml(title)}</b> to the recycler? <button class="plan-trash-yes">Trash</button> <button class="plan-trash-no">Keep</button></span>`,
    )
  })
  $box.on('click', '.plan-trash-no', e => {
    e.preventDefault()
    draw()
  })
  $box.on('click', '.plan-trash-yes', async e => {
    e.preventDefault()
    $box.find('.plan-confirm').remove()
    const note = $box.find('.plan-actions-note').text('Trashing…')
    try {
      const res = await fetch(`/${slug}.json`, { method: 'DELETE', cache: 'no-cache', mode: 'same-origin', credentials: 'include' })
      if (res.status === 401 || res.status === 403) throw new Error('not allowed, log in as the site owner first')
      if (!res.ok) throw new Error(`the server said ${res.status}`)
    } catch (err) {
      note.text(`Could not trash it: ${err.message}.`)
      $box.find('.plan-actions-note').before(' <button class="plan-trash">Trash Page</button>')
      return
    }
    // What wiki-client's own delete does next: forget the page in the
    // neighbourhood's sitemap and index, and take it out of the lineup.
    try {
      const key = $left.data('key')
      const pageObject = wiki.lineup && wiki.lineup.atKey ? wiki.lineup.atKey(key) : null
      if (pageObject && wiki.neighborhoodObject) {
        wiki.neighborhoodObject.deleteFromSitemap(pageObject)
        wiki.neighborhoodObject.deleteFromIndex(pageObject)
      }
      $left.remove()
      if (wiki.lineup && wiki.lineup.removeKey) wiki.lineup.removeKey(key)
    } catch (_) {}
    $box.html(`<span>Trashed <b>${escapeHtml(title)}</b>. It is in ${RECYCLED}: open it there and fork it to bring it back.</span>`)
  })
}

// ---------- the list face (Phase 1) ----------

const row = (r, site) => {
  const link = internal(r.title, r.slug, site)
  if (!r.read) return `<li>${link} <span class="plan-ticks">unreadable</span></li>`
  const ticks = `<span class="plan-ticks">${r.done}/${r.total}</span>`
  const questions = r.questions > 0 ? `<span class="plan-questions">${r.questions} open question${r.questions === 1 ? '' : 's'}</span>` : ''
  return `<li>${link} ${ticks}${questions ? ' ' + questions : ''}</li>`
}

const showList = ($item, opts, note = '') => {
  const site = opts.site || location.host
  return plansOf(site).then(
    rows => {
      const shown = opts.limit ? rows.slice(0, opts.limit) : rows
      const of = shown.length < rows.length ? `${shown.length} of ${rows.length}` : `${rows.length}`
      const meta = `<p class="plan-meta">${note}${of} plan${rows.length === 1 ? '' : 's'} on ${escapeHtml(site)}, newest edit first — ticks done/total</p>`
      const list = shown.length ? `<ol>${shown.map(r => row(r, site)).join('')}</ol>` : `<p class="plan-meta">No page here has a title ending in Plan or Roadmap.</p>`
      $item.html(shell(opts, meta + list))
      $item[0].planRows = rows
      attachIndexCheck($item, site)
    },
    err => {
      $item.html(shell(opts, `<p class="plan-error">Could not read the sitemap of ${escapeHtml(site)}: ${escapeHtml(err.message)}</p>`))
    },
  )
}

// ---------- Check Plan Index (Phase 5) ----------
//
// Read-only. The board the laptop skill writes (fedwiki-plan-index's
// plan-index.py, run by fedwiki-update-planning): the Plan Index page, and
// Backlog Plans where the site has one, since the script keeps the numbers
// fresh there too. Its plan lines and reference items are read
// (boardEntries) and compared with every plan the list read, by the board's
// own count, every task line on the page (compareIndex). The report says
// what the next run of the skill would change. Nothing is written.
const indexOf = $item => ($item[0] && $item[0].planIndex) || null
const shortDate = ms => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never')

const indexReportHtml = (r, site, { written, boards, live }) => {
  const link = x => internal(x.title, x.slug, site)
  const list = (head, xs, each) => (xs.length ? `<p>${head} (${xs.length}):</p><ul>${xs.map(x => `<li>${each(x)}</li>`).join('')}</ul>` : '')
  const parts = [
    `<p>${escapeHtml(boards.join(' and '))} on ${escapeHtml(site)}, last written ${escapeHtml(written)}: ${r.listed} plan${r.listed === 1 ? '' : 's'} on the board, ${live} live here; ${r.unchanged} unchanged.</p>`,
  ]
  const moved = r.missing.length + r.gone.length + r.moved.length + r.complete.length
  if (!moved && !r.unreadable.length) parts.push('<p>Nothing has moved: the board matches every plan.</p>')
  parts.push(list('Missing from the index', r.missing, x => `${link(x)}${x.to ? ` <span class="plan-ticks">${escapeHtml(x.to)}</span>` : ' <span class="plan-ticks">unreadable</span>'}`))
  parts.push(list('On the index but no longer here', r.gone, x => `${escapeHtml(x.title)} <span class="plan-ticks">was ${escapeHtml(x.from)}</span>`))
  parts.push(list('Moved', r.moved, x => `${link(x)} <span class="plan-ticks">${escapeHtml(x.from)} → ${escapeHtml(x.to)}</span>`))
  parts.push(list('Newly complete', r.complete, x => `${link(x)} <span class="plan-ticks">${escapeHtml(x.to)}</span>`))
  parts.push(list('Could not be read', r.unreadable, link))
  if (r.elsewhere) parts.push(`<p>${r.elsewhere} reference item${r.elsewhere === 1 ? '' : 's'} to plans on other sites were not compared; the tool reads this site only.</p>`)
  parts.push(`<p>The index is written by the laptop skill <code>fedwiki-update-planning</code>; this check writes nothing.</p>`)
  return parts.join('')
}

function attachIndexCheck($item, site) {
  const $box = $(`<div class="plan-index-check"><button class="plan-index-go" title="Compare the Plan Index with the plans on this site, and say what moved; nothing is written">Check Plan Index</button> <span class="plan-index-note"></span><div class="plan-index-report"></div></div>`)
  const last = indexOf($item)
  if (last) $box.find('.plan-index-report').html(last)
  $item.find('.plan-tool').append($box)
  $box.on('click', '.plan-index-go', async e => {
    e.preventDefault()
    const $report = $box.find('.plan-index-report')
    $box.find('.plan-index-note').text('Reading the Plan Index…')
    const base = baseFor(site)
    let html
    try {
      const index = await getJSON(`${base}/plan-index.json`)
      let backlog = null
      try {
        backlog = await getJSON(`${base}/backlog-plans.json`)
      } catch (_) {}
      const rows = $item[0].planRows || (await plansOf(site))
      const r = compareIndex(boardEntries(index, backlog), rows, asSlug)
      const boards = [index.title || 'Plan Index', ...(backlog ? [backlog.title || 'Backlog Plans'] : [])]
      html = indexReportHtml(r, site, { written: shortDate(lastEdit(index)), boards, live: rows.length })
    } catch (err) {
      html = `<p class="plan-refused">Could not read the Plan Index of ${escapeHtml(site)}: ${escapeHtml(err.message)}</p>`
    }
    $item[0].planIndex = html
    $box.find('.plan-index-note').text('')
    $report.html(html)
  })
}

// ---------- which model (0.10.0) ----------
//
// The model Revise Plan, Revise Site and Go Ahead ask is chosen on the Model
// Settings page (a plan item with MODELS, shipped as a page of this plugin)
// and kept in this browser, per site. Nothing chosen means the farm's
// default: the LLM coop (openai:llm_auto-big), or the farm's PLAN_MODEL.
// Every run is one request built fresh from the pages, so changing model
// between runs carries no conversation and costs nothing extra.
const MODEL_KEY = 'plan:model'
const MODEL_SETTINGS = 'Model Settings'
const chosenModel = () => {
  try {
    return localStorage.getItem(MODEL_KEY) || ''
  } catch {
    return ''
  }
}
const chooseModel = id => {
  try {
    if (id) localStorage.setItem(MODEL_KEY, id)
    else localStorage.removeItem(MODEL_KEY)
  } catch {}
  paintChips()
}
// models.json once a session: the farm's default (for the chip) and the doors
let MODELS = null
const modelsNow = (fresh = false) => {
  if (!MODELS || fresh) MODELS = getJSON('/system/api/plan/models.json').catch(err => ({ error: err.message }))
  return MODELS
}
const modelChip = () =>
  `<a class="plan-model" title="Which model ✎ and ⧉ ask — open Model Settings to change it"><span aria-hidden="true">⚙</span> <span class="plan-model-name">${escapeHtml(chosenModel() ? modelLabel(chosenModel()) : 'farm default')}</span></a>`
const paintChips = () => {
  const mine = chosenModel()
  const set = text => $('.plan-tool .plan-model-name').text(text)
  if (mine) return set(modelLabel(mine))
  set('farm default')
  modelsNow().then(m => m && m.default && !chosenModel() && set(modelLabel(m.default)))
}

const modelRow = (name, m, chosen) => {
  const facts = [
    m.contextLength ? `${windowLabel(m.contextLength)} context` : '',
    m.selector && m.routesTo ? `routes to ${modelLabel(m.routesTo).replace(/^coop · /, '')} now` : '',
    m.loaded === true ? '<span class="plan-model-warm">loaded</span>' : m.loaded === false ? 'cold — the first run waits while it loads' : '',
    m.reasoning ? 'reasons' : '',
  ].filter(Boolean)
  return (
    `<label class="${m.id === chosen ? 'plan-chosen' : ''}"><input type="radio" name="${name}" value="${escapeHtml(m.id)}"${m.id === chosen ? ' checked' : ''}> ` +
    `${escapeHtml(m.name || modelLabel(m.id))}<span class="plan-model-facts">${facts.join(' · ')}</span></label>`
  )
}

const DOORS = {
  openai: ['Coop', "open models on the LLM coop's GPUs: no per-use cost; the big ones hold a whole site"],
  claude: ['Claude', "on the farm's Claude account: the strongest reasoning, and it counts against that account's limits"],
  ollama: ['Ollama', 'a small model on a machine nearby: for short questions, not a whole plan'],
}

async function showModels($item, opts, item) {
  const name = `plan-model-${item.id}`
  const paint = m => {
    const chosen = chosenModel()
    const doors = (m.doors || [])
      .map(d => {
        const [title, note] = DOORS[d.door] || [d.door, '']
        const rows = d.models.length
          ? d.models.map(x => modelRow(name, x, chosen)).join('')
          : `<p class="plan-door-note plan-refused">${escapeHtml(d.error || 'no models')}</p>`
        return `<h4>${escapeHtml(title)}</h4><p class="plan-door-note">${escapeHtml(note)}</p>${rows}`
      })
      .join('')
    $item.html(
      shell(
        opts,
        `<div class="plan-models">` +
          `<p class="plan-meta">The model ✎ Revise Plan, ⧉ Revise Site and Go Ahead ask, kept in this browser for ${escapeHtml(location.host)}.</p>` +
          (m.error ? `<p class="plan-error">Could not ask the farm which models it reaches: ${escapeHtml(m.error)}</p>` : '') +
          `<label class="${chosen ? '' : 'plan-chosen'}"><input type="radio" name="${name}" value=""${chosen ? '' : ' checked'}> Farm default` +
          (m.default ? `<span class="plan-model-facts">${escapeHtml(modelLabel(m.default))}, set by ${escapeHtml(m.defaultFrom || 'the farm')}</span>` : '') +
          `</label>` +
          (m.auto && m.auto.available
            ? `<label class="${chosen === 'auto' ? 'plan-chosen' : ''}"><input type="radio" name="${name}" value="auto"${chosen === 'auto' ? ' checked' : ''}> Auto` +
              `<span class="plan-model-facts">${escapeHtml(m.auto.rule || AUTO_RULE)}</span></label>`
            : '') +
          doors +
          (m.research ? `<p class="plan-meta">⌕ Red-link always researches with ${escapeHtml(modelLabel(m.research))}: only Claude has web search here.</p>` : '') +
          `<p class="plan-meta"><a href="#" class="plan-models-refresh">Ask the doors again</a></p>` +
          `</div>`,
      ),
    )
    $item.find(`input[name="${name}"]`).on('change', e => {
      chooseModel(e.target.value)
      paint(m)
    })
    $item.find('.plan-models-refresh').on('click', e => {
      e.preventDefault()
      modelsNow(true).then(paint)
    })
  }
  paint(await modelsNow())
}

// ---------- the Revise Plan page (0.15.0) ----------
//
// ✎ on a plan's status line opens this page beside the plan instead of
// starting a run: a plan item with REVISE, shipped as a page of this plugin,
// that looks left for the plan. It offers the four ways (REVISE_WAYS in
// core.js, reviseAsk in api/prompt.js) with what each does, a box for the
// owner's direction, typed or spoken through the Voice Tool, the model chip,
// and Revise. The run is runAgent's, so the redraft opens to the right as a
// ghost with the plan's own title, and its fork flag saves it over the plan
// through the journal (guardGhost → saveOver), the old version its _rev.
//
// The form's choice and text are kept per plan in sessionStorage, so a
// re-render or a trip to the Voice Tool loses nothing. The Voice Tool hands a
// spoken direction back by the plan.direction event, or failing that by
// sessionStorage (DIRECTION_KEY), read when this page renders.
const REVISE_PLAN = 'Revise Plan'
const RETURN_KEY = 'audionote.returnTo' // read by the Voice Tool (wiki-plugin-audionote 0.10.0)
const DIRECTION_EVENT = 'plan:direction'
const DIRECTION_KEY = slug => `plan.direction:${location.host}/${slug}`
const FORM_KEY = slug => `plan.revise:${location.host}/${slug}`

const WAY_GLYPH = { answers: '⟲', direction: '🎙', correct: '✓', tidy: '¶' }
const WAY_WHAT = {
  answers: 'Weave in what the answered questions decided. Only what an answer justifies changes; a question answered with a question is reworded so it says plainly what is being decided.',
  direction: 'Say or type how the plan should change — add or drop a phase, split or merge, reorder, change the approach, correct a mistake. The model carries out your words; the answers still stand unless you say otherwise.',
  correct: 'Check the plan against its phase reports, demos and linked pages: tick what they show done, reword steps that were done differently, correct stale facts. No new work is added.',
  tidy: 'The house format only — one heading level with straps, one checkpoint per item, questions as red links. Nothing the plan says changes. A small job: the coop model does it well.',
}

const readForm = slug => {
  try {
    return JSON.parse(sessionStorage.getItem(FORM_KEY(slug)) || 'null') || {}
  } catch {
    return {}
  }
}
const keepForm = (slug, f) => {
  try {
    sessionStorage.setItem(FORM_KEY(slug), JSON.stringify(f))
  } catch {}
}
const takeVoiced = slug => {
  try {
    const t = sessionStorage.getItem(DIRECTION_KEY(slug))
    if (t !== null) sessionStorage.removeItem(DIRECTION_KEY(slug))
    return t
  } catch {
    return null
  }
}
// Spoken words join what is typed already, a blank line between.
const joinDirection = (had, more) => [String(had || '').trim(), String(more || '').trim()].filter(Boolean).join('\n\n')

// What the plan offers each way, from its state: shown beneath the way.
const wayFacts = (page, st) => {
  const qs = st.questions || []
  const titles = (page.story || []).flatMap(it => wikilinksIn(String((it && it.text) || '')))
  const records = [...new Set(titles.filter(t => /\b(Report|Demo)$/.test(t)))]
  return {
    answers: qs.length
      ? `${st.answered} of ${qs.length} question${qs.length === 1 ? '' : 's'} answered${st.queried ? `, ${st.queried} asked back` : ''}${st.answered ? '' : ' — nothing yet for this way to work from'}`
      : 'the plan has no open questions — nothing for this way to work from',
    direction: '',
    correct: records.length ? `${records.length} report or demo page${records.length === 1 ? '' : 's'} linked, besides the plan's other links` : "no report or demo page linked: it checks against the plan's other links only",
    tidy: '',
  }
}

const reviseRefusal = $subject => {
  if (!$subject) return null
  if (!isHere($subject)) return 'is on another site: open it on its own site to revise it there'
  if ($subject.hasClass('ghost')) return 'is a ghost, not a saved page'
  if ($subject.hasClass('local')) return 'is a local draft in this browser, not saved on the site'
  if (ownerHere() === false) return `can be revised only by the owner of ${location.host}: log in first`
  return null
}

async function showRevise($item, opts, item) {
  const { $subject, $left } = resolve($item, opts)
  const $page = $item.parents('.page').first()
  if (!$subject) {
    const what = $left ? `The page to the left, <b>${escapeHtml(titleOfPage($left))}</b>, is not a plan.` : 'There is no page to the left.'
    return $item.html(shell(opts, `<p class="plan-meta">${what} Open this page from a plan: press ✎ on the plan's status line, and it opens here beside it.</p>`))
  }
  const title = titleOfPage($subject)
  const slug = slugOf($subject)
  const link = internal(title, slug, siteOfPage($subject))
  let page
  try {
    page = await pageJson($subject)
  } catch (err) {
    return $item.html(shell(opts, `<p class="plan-error">Could not read ${escapeHtml(title)}: ${escapeHtml(err.message)}</p>`))
  }
  const site = siteOfPage($subject)
  const st = planState(page, await knownSlugs(site), asSlug, await linkedQuestions(page, site))
  const facts = wayFacts(page, st)
  const refused = reviseRefusal($subject)
  const name = `plan-way-${item.id}`
  const form = readForm(slug)
  const voiced = takeVoiced(slug)
  if (voiced) Object.assign(form, { direction: joinDirection(form.direction, voiced), mode: !form.mode || form.mode === 'answers' ? 'direction' : form.mode })
  const mode = REVISE_WAYS[form.mode] ? form.mode : 'answers'
  keepForm(slug, { ...form, mode })

  const way = key =>
    `<label class="plan-way${key === mode ? ' plan-chosen' : ''}"><input type="radio" name="${name}" value="${key}"${key === mode ? ' checked' : ''}>` +
    `<span class="plan-way-name">${WAY_GLYPH[key]} ${escapeHtml(REVISE_WAYS[key].label)}</span>` +
    `<span class="plan-way-what">${escapeHtml(WAY_WHAT[key])}</span>` +
    (facts[key] ? `<span class="plan-way-fact">${escapeHtml(facts[key])}</span>` : '') +
    `</label>`

  $item.html(
    shell(
      opts,
      `<div class="plan-revise">` +
        `<p class="plan-subject">Revise ${link}</p>` +
        (refused ? `<p class="plan-refused">${escapeHtml(title)} ${escapeHtml(refused)}.</p>` : '') +
        `<div class="plan-ways">${Object.keys(REVISE_WAYS).map(way).join('')}</div>` +
        `<div class="plan-direction">` +
        `<div class="plan-direction-label">Your direction <span class="plan-direction-need"></span></div>` +
        `<textarea class="plan-direction-text" rows="5" placeholder="For example: merge Phases 2 and 3; drop the Taiga wiki pull, it moves to its own plan; add a phase for the 4 November meeting, after Phase 1."></textarea>` +
        `<div class="plan-direction-row"><button class="plan-speak" title="Open the Voice Tool beside this page with the question Direction for ${escapeHtml(title)}: speak (or type), then press its ↩ Use as the direction button and the words land in this box">🎙 Speak it…</button>` +
        `<span class="plan-direction-count"></span></div>` +
        `</div>` +
        `<div class="plan-revise-row"><button class="plan-revise-run" title="Ask the model for the redraft. It opens to the right as a ghost with the plan's own title; nothing is written until you fork it">✎ Revise</button>${modelChip()}</div>` +
        `<span class="plan-agent"></span>` +
        `<p class="plan-meta plan-revise-how">The redraft opens to the right as a ghost page with the plan's own title, its first line saying how it was made. Read it, compare, close it, or revise again. Fork it to adopt it: it is saved over ${escapeHtml(title)} in place through the journal, one entry per change, each saying how the plan was revised, and the version it replaced is one click back from the plan's status line (Rewind).</p>` +
        `</div>`,
    ),
  )

  const $text = $item.find('.plan-direction-text').val(form.direction || '')
  const paintForm = () => {
    const f = readForm(slug)
    const m = REVISE_WAYS[f.mode] ? f.mode : 'answers'
    const text = String(f.direction || '').trim()
    $item.find('.plan-way').each((_, el) => el.classList.toggle('plan-chosen', el.querySelector('input').value === m))
    $item
      .find('.plan-direction-need')
      .text(m === 'direction' ? '— needed for this way' : '— optional: added to the chosen way, and it takes precedence')
    $item.find('.plan-direction').toggleClass('plan-direction-main', m === 'direction')
    $item.find('.plan-direction-count').text(text ? `${text.length.toLocaleString('en')} characters` : '')
    const busyNow = busy(agentOf($item))
    $item.find('.plan-revise-run').prop('disabled', !!refused || busyNow || (m === 'direction' && !text))
    $item.find('.plan-revise-run').text(`✎ Revise, ${reviseHowText(m)}`)
  }
  const update = patch => {
    keepForm(slug, { ...readForm(slug), ...patch })
    paintForm()
  }
  $item.find(`input[name="${name}"]`).on('change', e => update({ mode: e.target.value }))
  $text.on('input', () => update({ direction: $text.val() }))
  $item.find('.plan-speak').on('click', e => {
    e.preventDefault()
    const question = `Direction for ${title}`
    try {
      sessionStorage.setItem(WAITING_FOR_KEY, question)
      sessionStorage.setItem(RETURN_KEY, JSON.stringify({ title: question, event: DIRECTION_EVENT, key: DIRECTION_KEY(slug), slug, site: location.host, plan: title, label: '↩ Use as the direction' }))
    } catch (_) {}
    wiki.doInternalLink('Voice Tool', $page)
  })
  $item.find('.plan-revise-run').on('click', e => {
    e.preventDefault()
    const f = readForm(slug)
    const how = { mode: REVISE_WAYS[f.mode] ? f.mode : 'answers', direction: String(f.direction || '').trim() }
    runAgent($item, $subject, slug, 'revise', how).then(paintForm)
    paintForm()
  })
  $item.find('.plan-revise').on('click', '.plan-save-over', e => {
    e.preventDefault()
    saveOver($item, $subject)
  })
  $item.find('.plan-model').on('click', e => {
    e.preventDefault()
    wiki.doInternalLink(MODEL_SETTINGS, $page)
  })
  // The Voice Tool's ↩ Use as the direction, while this page is open.
  if ($item[0].planVoiced) window.removeEventListener(DIRECTION_EVENT, $item[0].planVoiced)
  const onVoiced = ev => {
    if (!document.body.contains($item[0])) return window.removeEventListener(DIRECTION_EVENT, onVoiced)
    const d = (ev && ev.detail) || {}
    if (d.slug !== slug || (d.site && d.site !== location.host)) return
    takeVoiced(slug) // handed over here, so not again on the next render
    const f = readForm(slug)
    const text = joinDirection(f.direction, d.text)
    keepForm(slug, { ...f, direction: text, mode: !f.mode || f.mode === 'answers' ? 'direction' : f.mode })
    $text.val(text)
    $item.find(`input[name="${name}"][value="${readForm(slug).mode}"]`).prop('checked', true)
    paintForm()
    $text[0].scrollIntoView({ block: 'nearest' })
  }
  $item[0].planVoiced = onVoiced
  window.addEventListener(DIRECTION_EVENT, onVoiced)
  paintChips()
  paintForm()
  paintAgent($item)
}

// ---------- the item ----------

// Which face, and the page whose state it reads.
const resolve = ($item, opts) => {
  const $page = $item.parents('.page').first()
  const $left = (opts.subject || opts.revise) && $page.length ? leftSubject($page) : null
  const which = face(opts, { ownTitle: $page.length ? titleOfPage($page) : null, leftTitle: $left ? titleOfPage($left) : null })
  const leftPlan = $left && isPlanTitle(titleOfPage($left)) ? $left : null
  return { which, $subject: which === 'status' ? $page : which === 'subject' ? $left : which === 'revise' ? leftPlan : null, $left }
}

export const emit = ($item, item) => {
  const opts = parse(item.text)
  const { which, $subject } = resolve($item, opts)
  const what = which === 'models' ? 'the models this farm can ask' : which === 'revise' ? ($subject ? escapeHtml(titleOfPage($subject)) : 'the page to the left') : which === 'list' ? `the plans on ${escapeHtml(opts.site || location.host)}` : `${escapeHtml(titleOfPage($subject))}`
  $item.html(shell(opts, `<p class="plan-meta">Reading ${what}…</p>`))
}

const render = ($item, item) => {
  const opts = parse(item.text)
  const { which, $subject } = resolve($item, opts)
  if (which === 'models') return showModels($item, opts, item)
  if (which === 'revise') return showRevise($item, opts, item)
  if (which === 'list') {
    const note = opts.subject ? 'Nothing to the left is a plan, so: ' : ''
    return showList($item, opts, note).then(() => attachActions($item, opts))
  }
  const site = siteOfPage($subject)
  return pageJson($subject)
    .then(page => showState($item, opts, page, site, which === 'subject', $subject, item.id))
    .catch(err => $item.html(shell(opts, `<p class="plan-error">Could not read ${escapeHtml(titleOfPage($subject))}: ${escapeHtml(err.message)}</p>`)))
    .then(() => attachActions($item, opts))
}

// The editor, from a double click or from the factory (factory.json says
// editor: true, so wiki-client calls plugins.plan.editor when Plan is chosen).
// An item with empty text opens with STATUS in the textarea, as a suffix, so
// the text it started with is still empty: saving it as it stands writes
// STATUS, journaled as an edit, and only a deliberate deletion of the text
// removes the item.
const editText = ($item, item) => {
  const empty = !String(item.text || '').trim()
  wiki.textEditor($item, item, empty ? { suffix: DEFAULT_TEXT } : {})
}
export const editor = editText

export const bind = ($item, item) => {
  $item.on('dblclick', () => editText($item, item))
  // Answer: one delegated handler per element, however often it is bound.
  $item.off('click.planask').on('click.planask', '.plan-ask', e => {
    e.preventDefault()
    e.stopPropagation()
    askVoiceTool($item, e.currentTarget.getAttribute('data-title'))
  })
  // The fold toggle: flip the shell's class, remember the choice for this item.
  $item.off('click.planfold').on('click.planfold', '.plan-fold', e => {
    e.preventDefault()
    e.stopPropagation()
    const $tool = $item.find('.plan-tool')
    const folded = !$tool.hasClass('plan-folded')
    $tool.toggleClass('plan-folded', folded)
    $(e.currentTarget).text(foldGlyph(folded))
    FOLD.set(item.id, folded)
  })
  // The version a revision replaced, and Rewind (Phase 8).
  $item.off('click.planrev').on('click.planrev', '.plan-rev', e => {
    e.preventDefault()
    e.stopPropagation()
    const { $subject } = resolve($item, parse(item.text))
    if ($subject) openRev($item, $subject, parseInt(e.currentTarget.getAttribute('data-rev'), 10)).catch(err => $item.find('.plan-answer').addClass('plan-refused').text(`Could not open it: ${err.message}`))
  })
  $item.off('click.planrewind').on('click.planrewind', '.plan-rewind', e => {
    e.preventDefault()
    e.stopPropagation()
    const { $subject } = resolve($item, parse(item.text))
    if ($subject) openRewind($item, $subject, parseInt(e.currentTarget.getAttribute('data-rev'), 10)).catch(err => $item.find('.plan-answer').addClass('plan-refused').text(`Could not open it: ${err.message}`))
  })
  render($item, item)
  // The neighbourhood's sitemaps arrive after the page renders, and a page
  // that exists only on a neighbour is red until its sitemap is in. Read again
  // when one lands, a little after the last; drop the handler once this item
  // has left the page.
  let timer = null
  // The list face reads only its own site, so it does not listen; the Revise
  // Plan form would lose what is being typed in it.
  const which = resolve($item, parse(item.text)).which
  if (which === 'list' || which === 'revise') return
  const again = () => {
    if (!document.body.contains($item[0])) return $('body').off('new-neighbor-done', again)
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (document.body.contains($item[0])) render($item, item)
    }, 400)
  }
  // A re-emit (renderFrom, Update Plan) calls bind again on the same element:
  // drop the handler the last bind left, so they do not pile up.
  if ($item[0].planAgain) $('body').off('new-neighbor-done', $item[0].planAgain)
  $item[0].planAgain = again
  $('body').on('new-neighbor-done', again)
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins.plan = { emit, bind, editor }
}
