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
// Everything shown is read from page JSON: the lineup's own copy of a page,
// /system/sitemap.json, {slug}.json and the neighbourhood's sitemaps. There is
// no server and no storage of its own.
import { parse, isPlanTitle, summarise, byRecent, face, planState, audit, forkSites, trashable, TOOL_SLUGS, asSlug as asSlugCopy, reportItems, linkAfter, lastEdit, WAITING_FOR_KEY, demoCandidate, boardEntries, compareIndex, openQuestionsLink, proposalItems, proposalApplied, parseProposal, wikilinksIn, PROPOSAL_TITLE, reviseItems, lastRevision, revLabel, revSlug, storyAt } from './core.js'

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

// The last revision the Plan Tool wrote over the plan (Phase 8): when, by
// which model, and the version it replaced, its _rev, a click away. Rewind
// sits beside it for the owner (attachUpdate).
const revisedHtml = (rev, title) => {
  if (!rev) return ''
  const day = rev.date ? new Date(rev.date).toISOString().slice(0, 10) : ''
  const what = rev.kind === 'rewind' ? `Rewound ${day} to ${escapeHtml(revLabel(title, rev.to))}` : `Revised ${day}${rev.model ? ` by ${escapeHtml(rev.model)}` : ''}`
  const link = `<a href="/view/${escapeHtml(revSlug(title, rev.previous, asSlug))}" class="plan-rev" data-rev="${rev.previous}" title="Open the plan as it was before, drawn from its journal">${escapeHtml(revLabel(title, rev.previous))}</a>`
  return `<p class="plan-revised">${what} · the version it replaced: ${link}</p>`
}

const stateHtml = (st, site, heading, folded = false, rev = null) => {
  const parts = []
  if (heading) parts.push(`<p class="plan-subject">${internal(st.title, asSlug(st.title), site)}</p>`)

  const q = st.questions.length ? ` · ${st.answered} of ${st.questions.length} questions answered` : ''
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
    const open = st.questions.filter(x => !x.answered)
    let line = `${st.answered} of ${st.questions.length} questions answered, a page behind the link; ${st.ticked} ticked on the page.`
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
  const $box = $(
    `<div class="plan-update"><button class="plan-update-go" title="Update Plan ticks what the answers settled and re-renders the plan's markdown asset; no model, written on the page">Update Plan</button>` +
      (next ? ` <button class="plan-next-go" title="Ask the Claude door for a report on ${escapeHtml(next)}: it opens as a ghost page, nothing is written to the plan">Do Next Phase</button>` : '') +
      ` <button class="plan-revise-go" title="Revise Plan asks the model to redraft the plan from its answers, on a ghost with the plan's own title; Save overwrites the plan with a rewindable journal">Revise Plan</button>` +
      (page && (openQuestionsLink(page, asSlug) || (st && st.answered > 0))
        ? ` <button class="plan-site-go" title="Ask the Claude door for a Revision Proposal for the whole site from the answered questions: it opens as a ghost page with Go Ahead and Pause, and nothing is written until Go Ahead">Revise Site</button>`
        : '') +
      (st && st.complete ? ` <button class="plan-finish-go" title="Every checkpoint is ticked: write the plan's Conclusion section and its demo link">Finish Plan</button>` : '') +
      `<span class="plan-answer"></span><span class="plan-agent"></span><span class="plan-finish"></span></div>`,
  )
  const last = answerOf($item)
  if (last) $box.find('.plan-answer').toggleClass('plan-refused', !!last.refused).html(last.html)
  else if (SAVED.has(slug)) $box.find('.plan-answer').toggleClass('plan-refused', !!SAVED.get(slug).refused).html(SAVED.get(slug).html)
  $item.find('.plan-tool').append($box)
  const rev = page ? lastRevision(page) : null
  if (rev) $item.find('.plan-revised').append(` <button class="plan-rewind" data-rev="${rev.previous}" title="Write ${escapeHtml(revLabel(page.title, rev.previous))} back over the plan as one more journaled revision: the journal only grows, so a rewind can itself be rewound">Rewind</button>`)
  $box.on('click', '.plan-update-go', e => {
    e.preventDefault()
    runUpdate($item, $subject, slug, $box)
  })
  $box.on('click', '.plan-next-go', e => {
    e.preventDefault()
    runAgent($item, $subject, slug, 'next')
  })
  $box.on('click', '.plan-revise-go', e => {
    e.preventDefault()
    runAgent($item, $subject, slug, 'revise')
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

const AGENT_NAME = { next: 'Do Next Phase', revise: 'Revise Plan', site: 'Revise Site' }
const AGENT_PATH = { next: 'next', revise: 'revise', site: 'revise-site' }
const POLL_MS = 3000
const sleep = ms => new Promise(r => setTimeout(r, ms))
const agentOf = $item => ($item[0] && $item[0].planAgent) || null
const busy = A => !!A && (A.state === 'posting' || A.state === 'running' || A.state === 'saving' || A.state === 'applying')
const secs = ms => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

const ghostIsOpen = A => !!(A && A.$ghost && A.$ghost.hasClass('ghost') && document.contains(A.$ghost[0]))

function paintAgent($item) {
  const A = agentOf($item)
  const $line = $item.find('.plan-agent')
  $item.find('.plan-next-go, .plan-revise-go, .plan-site-go').prop('disabled', busy(A))
  if (!A || !$line.length) return
  const name = AGENT_NAME[A.kind]
  const what = A.phase ? ` on ${escapeHtml(A.phase.label)}` : ''
  const model = A.model ? ` with ${escapeHtml(String(A.model).replace(/^claude-cli:/, ''))}` : ''
  let html = ''
  if (A.state === 'posting') html = `${name}: asking the farm…`
  else if (A.state === 'running') html = `${name}${what}${model}: the model is reading the ${A.kind === 'site' ? 'answers and every page of the site' : 'plan'}… ${secs(Date.now() - A.started)}`
  else if (A.state === 'refused' || A.state === 'failed') html = escapeHtml(A.line)
  else if (A.kind === 'site' && (A.state === 'done' || A.state === 'saving')) {
    const open = ghostIsOpen(A)
    const s = A.result.proposal || {}
    const rows = Object.entries(s.actions || {})
      .map(([k, n]) => `${n} ${escapeHtml(k)}`)
      .join(', ')
    html =
      `Revise Site: ${escapeHtml(A.reportTitle)} by ${escapeHtml(String(A.result.model).replace(/^claude-cli:/, ''))} in ${secs(A.result.ms || 0)}` +
      (rows ? `, ${s.rows} pages (${rows}), ${s.untouched || 0} untouched, ${s.names || 0} names to confirm` : '') +
      (open ? `; open as a ghost page, nothing written.` : `; its ghost page is closed.`) +
      ` <button class="plan-go" ${A.state === 'saving' ? 'disabled' : ''} title="Save the proposal as a page, then rewrite the pages it names one at a time through the door, the plan last">Go Ahead</button>` +
      ` <button class="plan-pause" ${A.state === 'saving' ? 'disabled' : ''} title="Save the proposal as a page and link it from the plan; nothing else is written">Pause</button>` +
      (A.line ? ` <span class="plan-refused">${escapeHtml(A.line)}</span>` : '')
  } else if (A.state === 'applying') {
    const P = A.progress || {}
    html = `Go Ahead from ${escapeHtml(A.proposalTitle)}` + (P.of ? `: page ${P.n || 0} of ${P.of}${P.title ? `, ${escapeHtml(P.title)}` : ''}` : ': starting') + `… ${secs(Date.now() - A.applyStarted)}`
  } else if (A.state === 'applied') html = A.html
  else if (A.kind === 'revise' && (A.state === 'done' || A.state === 'saving')) {
    const open = ghostIsOpen(A)
    html =
      `Revise Plan: a redraft of ${escapeHtml(A.title)} by ${escapeHtml(String(A.result.model).replace(/^claude-cli:/, ''))} in ${secs(A.result.ms || 0)}, ` +
      (open ? `open as a ghost with the plan's own title; nothing is written until Save.` : `its ghost is closed; Save still writes it.`) +
      ` <button class="plan-save-over" ${A.state === 'saving' ? 'disabled' : ''} title="Save overwrites the plan in place with a rewindable journal: the version it replaces stays one click back as its _rev, and Rewind brings it back">Save over the plan</button>` +
      (A.line ? ` <span class="plan-refused">${escapeHtml(A.line)}</span>` : '')
  } else if (A.state === 'done' || A.state === 'saving') {
    const open = ghostIsOpen(A)
    html =
      `${name}${what}: ${escapeHtml(A.title)} report by ${escapeHtml(String(A.result.model).replace(/^claude-cli:/, ''))} in ${secs(A.result.ms || 0)}, ` +
      (open ? `open as the ghost page <b>${escapeHtml(A.reportTitle)}</b>; nothing is written to the plan.` : `its ghost page is closed.`) +
      (A.ticks ? ` ${escapeHtml(A.ticks)}` : '') +
      ` <button class="plan-save" ${A.state === 'saving' ? 'disabled' : ''} title="Save the ghost as a page on this site and link it from the plan">Save and link it</button>` +
      (A.line ? ` <span class="plan-refused">${escapeHtml(A.line)}</span>` : '')
  } else if (A.state === 'saved') html = A.html + (A.kind === 'site' && A.savedSlug ? ` <button class="plan-go" data-proposal="${escapeHtml(A.savedSlug)}" title="Rewrite the pages the saved proposal names, one at a time through the door, the plan last; names still unticked on it are not copied">Go Ahead</button>` : '')
  $line.toggleClass('plan-refused', A.state === 'refused' || A.state === 'failed').html(html)
}

const apiError = (res, body) => `${res.status}: ${(body && body.error) || `the farm answered ${res.status}`}`

async function runAgent($item, $subject, slug, kind) {
  if (busy(agentOf($item))) return
  SAVED.delete(slug)
  const A = { kind, slug, state: 'posting', started: Date.now(), line: '', $subject }
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
      body: JSON.stringify({ slug }),
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
    if (j.status === 'failed') Object.assign(A, { state: 'failed', line: `${AGENT_NAME[kind]} failed: ${j.error}` })
    else if (j.status === 'done') {
      A.result = j.result
      A.reportTitle = j.result.reportTitle || A.reportTitle
      const t = j.result.proposedTicks
      if (t) A.ticks = !t.found ? 'The report has no Proposed Ticks section.' : t.none ? 'It proposes no ticks.' : `It proposes ${t.listed.length} tick${t.listed.length === 1 ? '' : 's'}, listed on the report; none was made.`
      if (kind === 'revise') {
        try {
          A.plan = await getJSON(`/${slug}.json`)
        } catch (_) {
          A.plan = $subject.data('data')
        }
      }
      A.state = 'done'
      openReport($item, A)
    }
    paintAgent($item)
  }
  paintAgent($item)
}

// The report's items, once: the ghost reopens with the same ids.
const itemsOf = A =>
  A.items ||
  (A.items =
    A.kind === 'site'
      ? proposalItems({ markdown: A.result.markdown, planTitle: A.title, site: location.host, model: A.result.model })
      : A.kind === 'revise'
        ? reviseItems({ page: A.plan, markdown: A.result.markdown, model: A.result.model })
        : reportItems({ kind: A.kind, markdown: A.result.markdown, planTitle: A.title, phaseLabel: A.phase ? A.phase.label : '', model: A.result.model }))

function openReport($item, A) {
  const $from = $item.parents('.page').first()
  A.$ghost = openGhost($from, A.reportTitle, itemsOf(A))
  if (A.kind === 'revise') guardGhost(A.$ghost, 'Save over the plan: overwrite it in place with a rewindable journal', () => saveOver($item, A.$subject))
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
// farm writes it over the plan through the journal; Rewind POSTs a rev number
// to rewind.json, which writes that rev back the same way. Either way the
// plan is then opened fresh in its place in the lineup, its status line
// saying when it was revised and linking the version replaced, its _rev.

// What the last Save or Rewind said, by plan slug: the plan reopens as a new
// element, so the line is kept here, not on the element.
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
  if (toolAfter) setTimeout(() => wiki.doInternalLink('Plan Tool', $('.page').last()), 600)
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
  if (!A || A.kind !== 'revise' || !A.result || A.state === 'saving') return
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
    out = await postJSON('save-revision.json', { slug: A.slug, story: itemsOf(A), model: A.result.model })
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

async function rewindTo($item, $subject, n) {
  const slug = slugOf($subject)
  const $line = $item.find('.plan-answer')
  $item.find('.plan-rewind').prop('disabled', true)
  $line.removeClass('plan-refused').text(`Rewinding to rev ${n}…`)
  let out
  try {
    out = await postJSON('rewind.json', { slug, rev: n })
  } catch (err) {
    $item.find('.plan-rewind').prop('disabled', false)
    return $line.addClass('plan-refused').text(`Could not reach the farm: ${err.message}`)
  }
  if (!out.res.ok || !out.body.written) {
    $item.find('.plan-rewind').prop('disabled', false)
    return $line.addClass('plan-refused').text(out.res.ok ? `Nothing written: ${out.body.why}` : apiError(out.res, out.body))
  }
  SAVED.set(slug, { html: savedHtml(`Rewound to ${revLabel(out.body.title, n)}`, out.body) })
  // A _rev ghost of this plan in the lineup is now out of date.
  $(`.page.ghost[id^="${slug}_rev"]`).each((_i, p) => closeGhost($(p)))
  reopenPlan($item, $subject)
}

// The _rev drawn as wiki-client draws one from a journal click: the journal
// replayed to entry n (storyAt, revision.js's create), shown as a ghost with
// the id <slug>_rev<n>, to the right of the page this item sits on. Its fork
// flag rewinds, journaled, rather than replacing the plan with the rev.
async function openRev($item, $subject, n) {
  const page = await getJSON(`${baseFor(siteOfPage($subject))}/${slugOf($subject)}.json`)
  const journal = (page.journal || []).slice(0, n + 1)
  const rev = { title: page.title, story: storyAt(page, n), journal }
  const $from = $item.parents('.page').first()
  wiki.showResult(wiki.newPage(rev), { $page: $from, rev: n })
  const $rev = $from.nextAll('.page').first()
  if (isHere($subject) && ownerHere() !== false) guardGhost($rev, `Rewind: write ${revLabel(page.title, n)} back over the plan, journaled`, () => rewindTo($item, $subject, n))
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
      body: JSON.stringify({ slug, plan: planSlug }),
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
        .map(x => `<li>${link(x.title, x.slug)} ${escapeHtml(x.action)} · ${kb(x.before)} → ${kb(x.after)}` + (x.linksDropped ? ` · links dropped: ${escapeHtml(x.linksDropped.join(', '))}` : '') + '</li>')
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
  if (r.ticked.length) parts.push(`Ticked ${r.ticked.length}: ${r.ticked.map(t => internal(t.title, t.slug, t.foundOn || site)).join('; ')}`)
  else parts.push('Nothing to tick')
  if (r.unanswered.length) parts.push(`still unanswered: ${r.unanswered.map(q => internal(q.title, q.slug, site)).join('; ')}`)
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

// ---------- the item ----------

// Which face, and the page whose state it reads.
const resolve = ($item, opts) => {
  const $page = $item.parents('.page').first()
  const $left = opts.subject && $page.length ? leftSubject($page) : null
  const which = face(opts, { ownTitle: $page.length ? titleOfPage($page) : null, leftTitle: $left ? titleOfPage($left) : null })
  return { which, $subject: which === 'status' ? $page : which === 'subject' ? $left : null }
}

export const emit = ($item, item) => {
  const opts = parse(item.text)
  const { which, $subject } = resolve($item, opts)
  const what = which === 'list' ? `the plans on ${escapeHtml(opts.site || location.host)}` : `${escapeHtml(titleOfPage($subject))}`
  $item.html(shell(opts, `<p class="plan-meta">Reading ${what}…</p>`))
}

const render = ($item, item) => {
  const opts = parse(item.text)
  const { which, $subject } = resolve($item, opts)
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

export const bind = ($item, item) => {
  $item.on('dblclick', () => wiki.textEditor($item, item))
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
    if ($subject) rewindTo($item, $subject, parseInt(e.currentTarget.getAttribute('data-rev'), 10))
  })
  render($item, item)
  // The neighbourhood's sitemaps arrive after the page renders, and a page
  // that exists only on a neighbour is red until its sitemap is in. Read again
  // when one lands, a little after the last; drop the handler once this item
  // has left the page.
  let timer = null
  // The list face reads only its own site, so it does not listen.
  if (resolve($item, parse(item.text)).which === 'list') return
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
  window.plugins.plan = { emit, bind }
}
