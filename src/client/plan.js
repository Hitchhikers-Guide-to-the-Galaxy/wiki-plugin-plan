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
import { parse, isPlanTitle, summarise, byRecent, face, planState, audit, forkSites, trashable, TOOL_SLUGS, asSlug as asSlugCopy } from './core.js'

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
`

const shell = (opts, body) =>
  `<style>${STYLE}</style><div class="plan-tool">` +
  (opts.caption ? `<p class="plan-caption">${escapeHtml(opts.caption)}</p>` : '') +
  body +
  `</div>`

const internal = (title, slug, site) =>
  `<a class="internal" href="/${escapeHtml(slug)}.html" data-page-name="${escapeHtml(slug)}" title="${escapeHtml(site)}">${escapeHtml(title)}</a>`

const asSlug = title => (window.wiki && typeof window.wiki.asSlug === 'function' ? window.wiki.asSlug(title) : asSlugCopy(title))

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

const stateHtml = (st, site, heading) => {
  const parts = []
  if (heading) parts.push(`<p class="plan-subject">${internal(st.title, asSlug(st.title), site)}</p>`)

  const q = st.questions.length ? ` · ${st.answered} of ${st.questions.length} questions answered` : ''
  const where = st.complete ? 'complete' : st.next === -1 ? 'no checkpoints' : `next: ${escapeHtml(st.phases[st.next].line)}`
  parts.push(`<p class="plan-summary">${st.done}/${st.total} checkpoints · ${where}${q}</p>`)

  if (st.phases.length) {
    const items = st.phases.map((p, i) => {
      const cls = p.done === p.total ? 'plan-done' : i === st.next ? 'plan-next' : ''
      let li = `<li${cls ? ` class="${cls}"` : ''}>${escapeHtml(p.line)} <span class="plan-ticks">${p.done}/${p.total}</span>`
      if (i === st.next) {
        li += `<span class="plan-next-tag">next</span>`
        const b = []
        for (const x of st.blockers.questions) b.push(`question ${internal(x.title, x.slug, site)}`)
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
    if (open.length) line += ` Unanswered: ${open.map(x => internal(x.title, x.slug, site)).join('; ')}`
    parts.push(`<p class="plan-section">${line}</p>`)
  }

  if (st.lints.length) parts.push(`<ul class="plan-lints">${st.lints.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`)
  return parts.join('')
}

const showState = async ($item, opts, page, site, heading) => {
  const known = await knownSlugs(site)
  const st = planState(page, known, asSlug)
  let scatter = null
  try {
    scatter = await scatterLint(page, site)
  } catch (_) {}
  if (scatter) st.lints.push(scatter)
  $item.html(shell(opts, stateHtml(st, site, heading)))
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
    },
    err => {
      $item.html(shell(opts, `<p class="plan-error">Could not read the sitemap of ${escapeHtml(site)}: ${escapeHtml(err.message)}</p>`))
    },
  )
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
    .then(page => showState($item, opts, page, site, which === 'subject'))
    .catch(err => $item.html(shell(opts, `<p class="plan-error">Could not read ${escapeHtml(titleOfPage($subject))}: ${escapeHtml(err.message)}</p>`)))
    .then(() => attachActions($item, opts))
}

export const bind = ($item, item) => {
  $item.on('dblclick', () => wiki.textEditor($item, item))
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
  $('body').on('new-neighbor-done', again)
}

if (typeof window !== 'undefined') {
  window.plugins = window.plugins || {}
  window.plugins.plan = { emit, bind }
}
