// handlers.js — the Plan API, mounted by the Farm plugin.
//
// wiki-plugin-plan has no server of its own. It declares its operations in
// package.json (fedwiki.api) and the Farm plugin mounts them beneath
// /system/api/plan/, gates the writing ones before they are called (a private
// site, then the wiki's own owner test; 403 otherwise — the Voice Tool's gate,
// applied by the farm, never repeated here) and documents them on the
// generated Plan API page. Each handler is a plain function: values in, value
// out.
//
//   update  — Update Plan, the mechanical write. Ticks the Open Questions whose
//             pages now exist, one journal edit per item ticked; re-renders the
//             plan's markdown asset; resets the site's index. Deterministic, no
//             model call. Claims the farm WIP marker around the write.
//   next    — Do Next Phase, the agentic one (Phase 4). The plan, its next
//             phase, the skills it names and the pages it links go to the
//             Claude door (@fortyfoxes/wiki-claude-door, shared with the Voice
//             Tool); the answer is a phase report, kept in a job. Nothing is
//             written to any page: the client opens the report as a ghost.
//   revise  — Revise Plan: the same door, asked to redraft the plan given the
//             answered questions. A job too; nothing written.
//   job     — how a next or revise run is getting on, and its report when done.
//   finish  — Finish Plan (Phase 5), mechanical like update: when every phase
//             checkpoint is ticked, writes the Conclusion section above # See
//             with the demo link, and adds the demo to the See list.
//
// ES module, as table, pod and lexon write theirs: the farm imports handlers
// with import(), which takes either format. The plan rules come from the same
// module the client bundle is built from (src/client/core.js), so the tool and
// the operation cannot disagree about what a plan or an answered question is.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import { ask, defaultModel } from '@fortyfoxes/wiki-claude-door'

import { isPlanTitle, questionsOf, tickAnswered, planMarkdown, choosePhase, reportTitle, proposedTicks, today, asSlug, finishRefusal, writeConclusion } from '../src/client/core.js'
import { claim, release, heartbeat } from './wip.js'
import { buildContent, SYSTEM } from './prompt.js'

const problem = (status, message) => Object.assign(new Error(message), { status })

const siteDir = status => {
  if (!status) throw problem(500, 'the farm did not say where this site lives')
  return path.dirname(status)
}

/** A page slug as the wiki writes one. No dots, so no climbing out of pages/. */
const checkSlug = slug => {
  const s = String(slug ?? '')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw problem(400, `not a page slug: ${slug}`)
  return s
}

/**
 * Slugs that have a page: this site's, or any sibling site's on this farm.
 * The farm is the server's stand-in for the client's neighbourhood: a
 * question answered on a sister site counts, as it does in the tool.
 */
const answeredOn = (farmRoot, site, slugs) => {
  const where = new Map()
  let sites = []
  try {
    sites = fs.readdirSync(farmRoot, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
  } catch {}
  // This site first, so an answer here is reported as here.
  sites = [site, ...sites.filter(s => s !== site)]
  for (const slug of slugs) {
    for (const s of sites) {
      if (fs.existsSync(path.join(farmRoot, s, 'pages', slug))) {
        where.set(slug, s)
        break
      }
    }
  }
  return where
}

/** Write a file whole or not at all: a temp file in the site's own status/farm-tmp, then rename. */
const writeAtomic = (status, file, body) => {
  const tmpDir = path.join(status, 'farm-tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = path.join(tmpDir, `plan-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`)
  fs.writeFileSync(tmp, body, { flag: 'wx' })
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/**
 * The site rebuilds its sitemap and search index on the next request once
 * the files are gone. Together, always: a site-index.json left without its
 * sitemap.json crashes the farm's index build. The same three files as
 * fedwiki-lib's delete_indexes (INDEX_FILES), sitemap.xml included.
 */
const INDEX_FILES = ['sitemap.json', 'site-index.json', 'sitemap.xml']
const resetIndex = status => {
  const files = INDEX_FILES.map(f => path.join(status, f))
  for (const f of files) fs.rmSync(f, { force: true })
  return files.every(f => !fs.existsSync(f))
}

export async function update({ slug, origin, status, farmRoot } = {}) {
  const s = checkSlug(slug)
  const site = siteDir(status)
  const root = farmRoot || path.dirname(site)
  const pageFile = path.join(site, 'pages', s)

  // Refuse what is not a plan before claiming anything.
  const peek = (() => {
    try {
      return JSON.parse(fs.readFileSync(pageFile, 'utf8'))
    } catch (e) {
      if (e.code === 'ENOENT') throw problem(404, `no page ${s} on ${origin}`)
      throw problem(500, `could not read ${s}: ${e.message}`)
    }
  })()
  if (!isPlanTitle(peek.title)) {
    throw problem(400, `${peek.title || s} is not a plan: a plan's title ends in Plan or Roadmap, and the Plan Index and Current Plan are not plans`)
  }

  const session = `wiki-plugin-plan Update Plan (${origin}/${s})`
  const wip = claim({ session, scope: `${origin}/${s}`, holdOff: `Update Plan is editing ${origin}/${s}` })
  try {
    // Read again under the claim: this is the copy the write is made from.
    const page = JSON.parse(fs.readFileSync(pageFile, 'utf8'))
    const slugs = [...new Set(questionsOf(page).map(q => q.slug))]
    const where = answeredOn(root, origin, slugs)
    const known = new Set(where.keys())

    const { page: next, ticked, unanswered } = tickAnswered(page, known)
    let written = false
    let indexReset = false
    if (ticked.length) {
      writeAtomic(status, pageFile, JSON.stringify(next, null, 2))
      written = true
      indexReset = resetIndex(status)
    }

    const md = planMarkdown(written ? next : page)
    const assetFile = path.join(site, 'assets', s, `${s}.md`)
    let before = null
    try {
      before = fs.readFileSync(assetFile, 'utf8')
    } catch {}
    writeAtomic(status, assetFile, md)

    const released = release(wip.token)
    return {
      slug: s,
      title: page.title,
      ticked: ticked.map(t => ({ ...t, foundOn: where.get(t.slug) })),
      unanswered,
      page: { written, journalEdits: written ? next.journal.length - (page.journal || []).length : 0 },
      index: { reset: indexReset },
      asset: { rendered: true, path: `/assets/${s}/${s}.md`, changed: before !== md, lines: md.split('\n').length - 1 },
      wip: { token: wip.token, session, claimed: wip.claimed, released, ...(wip.took ? { tookStaleClaim: wip.took } : {}) },
    }
  } catch (e) {
    try {
      release(wip.token)
    } catch {}
    throw e
  }
}


// ======================================================================
// Phase 4 — Do Next Phase and Revise Plan, the agentic writes.
// ======================================================================
//
// A model takes minutes, longer than a request should wait, so each run is a
// job: the operation claims the WIP marker and answers {job} at once; the run
// goes on in this process and the client polls job.json. audionote's jobs Map
// pattern (its api/handlers.js): the farm's handler host (sweet-server's node
// sidecar, wiki-plugin-farm in the node farm) is one long-lived process that
// imports this module once, so the Map lives between calls. It is not
// immortal: sweet-server kills and respawns the sidecar when any call times
// out. So each job is also written to {status}/farm-tmp/plan-jobs/<id>.json at
// every change, and a job found only on disk, still marked running, is
// reported as failed: the process that ran it is gone.

const jobs = new Map()
const JOB_TTL_MS = 24 * 60 * 60 * 1000
const RUN_TIMEOUT_MS = 7 * 60 * 1000
const HEARTBEAT_MS = 60 * 1000
const JOB_ID = /^[a-f0-9]{16}$/

const jobDir = status => path.join(status, 'farm-tmp', 'plan-jobs')

const forget = () => {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, j] of jobs) if (j.finished && j.finished < cutoff) jobs.delete(id)
}

// What a caller may see: the WIP token stays in the process.
const visible = j => {
  const { origin: _o, statusDir: _s, token: _t, ...rest } = j
  return rest
}

const persist = j => {
  try {
    const dir = jobDir(j.statusDir)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = path.join(dir, `.${j.id}-${crypto.randomBytes(4).toString('hex')}`)
    fs.writeFileSync(tmp, JSON.stringify({ ...visible(j), origin: j.origin }, null, 1))
    fs.renameSync(tmp, path.join(dir, `${j.id}.json`))
  } catch {} // the Map is the record; the file is the safety net
}

/** Read a plan page off this site, refusing what is not one, before anything is claimed. */
const readPlan = (status, origin, slug) => {
  const s = checkSlug(slug)
  const site = siteDir(status)
  let page
  try {
    page = JSON.parse(fs.readFileSync(path.join(site, 'pages', s), 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') throw problem(404, `no page ${s} on ${origin}`)
    throw problem(500, `could not read ${s}: ${e.message}`)
  }
  if (!isPlanTitle(page.title)) {
    throw problem(400, `${page.title || s} is not a plan: a plan's title ends in Plan or Roadmap, and the Plan Index and Current Plan are not plans`)
  }
  return { slug: s, site, page }
}

/**
 * Claim, then run in the background: build the content, ask the door, keep
 * the answer. The claim is synchronous, so a held marker is this call's 409;
 * everything after it is the job's, and the marker is released in a finally
 * whatever happens. The heartbeat keeps the claim fresh while the model works.
 */
const start = ({ kind, origin, status, slug, site, page, phase, session }) => {
  forget()
  const scope = `${origin}/${slug}`
  const wip = claim({ session, scope, holdOff: `${session}: a model is reading the plan; the report opens as a ghost page and nothing is written to the plan` })
  const model = defaultModel('claude-opus-5-5')
  const id = crypto.randomBytes(8).toString('hex')
  const j = {
    id,
    origin,
    statusDir: status,
    token: wip.token,
    kind,
    slug,
    title: page.title,
    phase: phase ? { label: phase.label, heading: phase.heading, number: phase.number, checkpoints: phase.checkpoints.map(c => c.text) } : null,
    reportTitle: reportTitle({ kind, planTitle: page.title, phaseLabel: phase ? phase.label : '', date: today() }),
    session,
    model,
    status: 'running',
    started: Date.now(),
    wip: { session, claimed: wip.claimed, heartbeat: wip.claimed, ...(wip.took ? { tookStaleClaim: wip.took } : {}) },
  }
  jobs.set(id, j)
  persist(j)

  const beat = setInterval(() => {
    try {
      j.wip.heartbeat = heartbeat(wip.token)
      persist(j)
    } catch (e) {
      j.wip.heartbeatError = e.message
    }
  }, HEARTBEAT_MS)
  if (beat.unref) beat.unref()

  ;(async () => {
    try {
      const { content, account } = buildContent({ kind, page, phase, origin, siteDir: site })
      j.context = account
      persist(j)
      const out = await ask(model, content, { system: SYSTEM, timeoutMs: RUN_TIMEOUT_MS, allowTools: false })
      const ticks = kind === 'next' ? proposedTicks(out.markdown, phase.checkpoints) : null
      j.result = {
        markdown: out.markdown,
        model: out.model,
        ms: out.ms,
        reportTitle: j.reportTitle,
        ...(ticks ? { proposedTicks: { found: ticks.found, none: ticks.none, listed: ticks.listed, matched: ticks.matched.map(c => c.text) } } : {}),
      }
      j.status = 'done'
    } catch (e) {
      j.status = 'failed'
      j.error = e.message
    } finally {
      clearInterval(beat)
      try {
        j.wip.released = release(wip.token)
      } catch (e) {
        j.wip.releaseError = e.message
      }
      j.finished = Date.now()
      persist(j)
    }
  })()

  return { job: id, status: j.status, kind, slug, title: page.title, phase: j.phase, reportTitle: j.reportTitle, model, session, started: j.started }
}

/** Do Next Phase: the plan's next phase (or the one named) to the door, as a job. */
export async function next({ slug, phase, origin, status } = {}) {
  const p = readPlan(status, origin, slug)
  const chosen = choosePhase(p.page, phase)
  if (!chosen) {
    if (phase !== undefined && phase !== null && phase !== '') throw problem(400, `${p.page.title} has no phase ${phase} with checkpoints`)
    throw problem(400, `every checkpoint of ${p.page.title} is ticked: there is no next phase to do`)
  }
  const which = chosen.number === null ? chosen.heading : chosen.number
  const session = `Plan Tool: Do Next Phase ${origin}/${p.slug} phase ${which}`
  return start({ kind: 'next', origin, status, slug: p.slug, site: p.site, page: p.page, phase: chosen, session })
}

/** Revise Plan: the whole plan to the door, asked to redraft it given the answered questions. */
export async function revise({ slug, origin, status } = {}) {
  const p = readPlan(status, origin, slug)
  const session = `Plan Tool: Revise Plan ${origin}/${p.slug}`
  return start({ kind: 'revise', origin, status, slug: p.slug, site: p.site, page: p.page, phase: null, session })
}

/** A run as the asking site may see it. Another site's jobs are not found, not forbidden. */
export async function job({ id, origin, status } = {}) {
  const key = String(id || '')
  if (!JOB_ID.test(key)) throw problem(400, `not a job id: ${id}`)
  const j = jobs.get(key)
  if (j) {
    if (j.origin !== origin) throw problem(404, 'no such job here')
    return visible(j)
  }
  let disk = null
  try {
    disk = JSON.parse(fs.readFileSync(path.join(jobDir(status), `${key}.json`), 'utf8'))
  } catch {}
  if (!disk || disk.origin !== origin) throw problem(404, 'no such job here')
  const { origin: _o, ...rest } = disk
  if (rest.status === 'running') {
    return { ...rest, status: 'failed', error: 'the farm process running this job has gone (restarted?) — its WIP claim goes stale after 30 minutes without a heartbeat; run it again', finished: rest.finished || null }
  }
  return rest
}


// ======================================================================
// Phase 5 — Finish Plan, the closing write.
// ======================================================================
//
// Mechanical, like update: no model. Refused (400) unless every phase
// checkpoint is ticked and the demo names a page on this site or a sibling
// site of this farm. Under the WIP marker it writes the Conclusion section
// (writeConclusion in core.js: above # See, or replacing the body of an
// existing Conclusion), adds the demo to the See list, journals each item as
// the wiki would, re-renders the markdown asset and resets the index.

export async function finish({ slug, conclusion, demo, origin, status, farmRoot } = {}) {
  const p = readPlan(status, origin, slug)
  const root = farmRoot || path.dirname(p.site)
  const refuse = page => {
    const why = finishRefusal(page, { conclusion, demo })
    if (why) throw problem(400, why)
  }
  refuse(p.page)
  const title = String(demo).trim()
  const demoSlug = asSlug(title)
  const foundOn = demoSlug ? answeredOn(root, origin, [demoSlug]).get(demoSlug) : undefined
  if (!foundOn) throw problem(400, `no page "${title}" on ${origin} or a sibling site of this farm: make the demo page first, then finish the plan`)

  const pageFile = path.join(p.site, 'pages', p.slug)
  const session = `wiki-plugin-plan Finish Plan (${origin}/${p.slug})`
  const wip = claim({ session, scope: `${origin}/${p.slug}`, holdOff: `Finish Plan is writing the Conclusion of ${origin}/${p.slug}` })
  try {
    // Read again under the claim, and check again: this is the copy written.
    const page = JSON.parse(fs.readFileSync(pageFile, 'utf8'))
    refuse(page)
    const out = writeConclusion(page, { conclusion, demo: title })
    writeAtomic(status, pageFile, JSON.stringify(out.page, null, 2))
    const indexReset = resetIndex(status)

    const md = planMarkdown(out.page)
    const assetFile = path.join(p.site, 'assets', p.slug, `${p.slug}.md`)
    let before = null
    try {
      before = fs.readFileSync(assetFile, 'utf8')
    } catch {}
    writeAtomic(status, assetFile, md)

    const released = release(wip.token)
    return {
      slug: p.slug,
      title: page.title,
      demo: { title, slug: demoSlug, foundOn },
      conclusion: out.conclusion,
      see: out.see,
      actions: out.actions,
      page: { written: true, journalEntries: out.actions.length },
      index: { reset: indexReset },
      asset: { rendered: true, path: `/assets/${p.slug}/${p.slug}.md`, changed: before !== md, lines: md.split('\n').length - 1 },
      wip: { token: wip.token, session, claimed: wip.claimed, released, ...(wip.took ? { tookStaleClaim: wip.took } : {}) },
    }
  } catch (e) {
    try {
      release(wip.token)
    } catch {}
    throw e
  }
}
