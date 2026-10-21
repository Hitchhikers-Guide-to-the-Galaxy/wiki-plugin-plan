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
//             Since 0.9.0 the Plan Tool does not call it: its Do Next Phase
//             places the plan's Terminal Button, and a Claude Code session
//             David watches does the phase (phaseButtonText in core.js).
//   revise  — Revise Plan: the same door, asked to redraft the plan given the
//             answered questions. A job too; nothing written: the client opens
//             the redraft as a ghost with the plan's own title (Phase 8).
//   saveRevision — Save over the plan: the ghost's story written over the
//             plan in place, through its journal (reviseJournal), a recycler
//             copy first; the version it replaces is the plan's _rev<N>.
//             Rewind writes nothing: the client opens the journal's _rev<N>
//             as a ghost beside the plan, and forking it is the rewind.
//   redlink — Red-link (0.7.0): the plan's links with no page behind them,
//             question links and Open Questions excepted, each researched
//             on the web by the door (WebSearch and WebFetch only) and
//             written as a new page, one journaled create each, as a job.
//   job     — how a next, revise or redlink run is getting on, and its report when done.
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
import { fileURLToPath } from 'node:url'

import { ask, door, isModelId, listModels, contextOf, estimateTokens, autoModel, classifyTier, classifierModel, tokensLabel, RESEARCH_TOOLS } from '@fortyfoxes/wiki-claude-door'

import { isPlanTitle, questionsOf, tickAnswered, planMarkdown, choosePhase, reportTitle, proposedTicks, today, asSlug, finishRefusal, writeConclusion, openQuestionsLink, parseProposal, foreignOf, storyFromReply, reviseJournal, namesCopied, linksOf, proposalApplied, proposalItems, PROPOSAL_TITLE, ACTIONS, wikilinksIn, headingOf, revisedStory, writeRevision, revLabel, revSlug, REVISION_KINDS, redLinksOf, parseResearch, researchedPage, planLinks, isUntouchedStub, researchedOverStub, storyAt, planState, autoTier, autoLine, AUTO, AUTO_RULE } from '../src/client/core.js'
import { claim, release, heartbeat } from './wip.js'
import { buildContent, buildSiteContent, buildPageContent, buildResearchContent, answerPages, questionsFor, PROPOSAL_RE, SYSTEM, REVISE_MODES, DIRECTION_CAP } from './prompt.js'

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
    }

    // Phase 7: the page the plan links as [[Open Questions]] on this site,
    // read whole, ticked by the same rule and journaled on that page.
    const link = openQuestionsLink(page)
    let oq = null
    if (link && link.slug !== s) {
      const oqFile = path.join(site, 'pages', link.slug)
      let linked = null
      try {
        linked = JSON.parse(fs.readFileSync(oqFile, 'utf8'))
      } catch {}
      if (linked) {
        const oqSlugs = [...new Set(questionsOf(linked, new Set(), undefined, { whole: true }).map(q => q.slug))]
        const oqWhere = answeredOn(root, origin, oqSlugs)
        for (const [k, v] of oqWhere) where.set(k, v)
        const r = tickAnswered(linked, new Set(oqWhere.keys()), undefined, undefined, { whole: true })
        if (r.ticked.length) writeAtomic(status, oqFile, JSON.stringify(r.page, null, 2))
        oq = { slug: link.slug, title: linked.title || link.title, ticked: r.ticked, unanswered: r.unanswered, written: r.ticked.length > 0, journalEdits: r.page.journal.length - (linked.journal || []).length }
      }
    }
    if (written || (oq && oq.written)) indexReset = resetIndex(status)

    const md = planMarkdown(written ? next : page)
    const assetFile = path.join(site, 'assets', s, `${s}.md`)
    let before = null
    try {
      before = fs.readFileSync(assetFile, 'utf8')
    } catch {}
    writeAtomic(status, assetFile, md)

    const released = release(wip.token)
    const seen = new Set(unanswered.map(q => q.slug))
    return {
      slug: s,
      title: page.title,
      ticked: [...ticked.map(t => ({ ...t, foundOn: where.get(t.slug) })), ...(oq ? oq.ticked.map(t => ({ ...t, foundOn: where.get(t.slug), page: oq.slug })) : [])],
      unanswered: [...unanswered, ...(oq ? oq.unanswered.filter(q => !seen.has(q.slug)).map(q => ({ ...q, page: oq.slug })) : [])],
      page: { written, journalEdits: written ? next.journal.length - (page.journal || []).length : 0 },
      openQuestions: oq ? { slug: oq.slug, title: oq.title, written: oq.written, journalEdits: oq.journalEdits, ticked: oq.ticked.length } : null,
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

// ---------- which model (0.10.0) ----------
//
// Every model question the Plan Tool asks is ONE request: the plan, its
// answers, the skills and linked pages, built fresh from the pages each time
// (buildContent, ≤120 kB). Nothing of an earlier run is carried, so changing
// the model between runs costs nothing extra — there is no conversation to
// load into the new one.
//
// The default is the LLM coop's open models (llm_auto-big: whichever big GPU
// model is already loaded), the farm's PLAN_MODEL when set. A caller may name
// another, any id the door accepts. Red-link researches the web, and only the
// Claude CLI has tools here, so it always goes by a Claude model.
const PLAN_DEFAULT_MODEL = 'openai:llm_auto-big'
const RESEARCH_MODEL = 'claude-opus-5-5'
export const planModel = () => String(process.env.PLAN_MODEL || '').trim() || PLAN_DEFAULT_MODEL
const chooseModel = model => {
  if (model === undefined || model === null || model === '') return planModel()
  if (model === 'auto') return 'auto'
  if (!isModelId(model)) throw problem(400, `not a model this farm can ask: ${String(model).slice(0, 80)} — claude-…, claude-cli:claude-…, ollama:… or openai:…`)
  return model
}
const isClaudeModel = model => /^(claude-cli:)?claude-/.test(model)

// Room to answer in: a redraft of a long plan, and a reasoning model's
// thinking, both come out of it.
const ANSWER_TOKENS = 32000
const LEAST_ANSWER = 4096

/**
 * Ask, having checked the model can hold the question. A model whose window
 * (the door's listModels) is smaller than the question plus room to answer is
 * refused before anything is sent, with the sizes, rather than answering from
 * a silently truncated plan. An unknown window is not refused.
 */
const askPlan = async (model, content, opts = {}) => {
  const need = estimateTokens(opts.system || '') + estimateTokens(content)
  let window = isClaudeModel(model) ? 200000 : null // known; asking the doors would only wait on them
  if (!window) {
    try {
      window = await contextOf(model)
    } catch {}
  }
  const room = window ? window - need : ANSWER_TOKENS
  if (window && room < LEAST_ANSWER) {
    throw problem(
      400,
      `${model} holds about ${window.toLocaleString('en')} tokens and this question is about ${need.toLocaleString('en')}: ` +
        'choose a model with a larger window (⚙ Model Settings) — GLM-5.3 Flash or DeepSeek-V4 on the coop, or Claude',
    )
  }
  const slow = !isClaudeModel(model) || /fable/.test(model) // a cold start on the coop's GPUs takes minutes; Fable thinks for minutes
  return ask(model, content, { timeoutMs: slow ? 15 * 60 * 1000 : RUN_TIMEOUT_MS, ...opts, maxTokens: Math.min(ANSWER_TOKENS, room) })
}

// ---------- Auto (0.11.0) ----------
//
// "auto" is decided per run, after the content is built and measured:
// autoTier (core.js) reads the run's size and answers and says light or big
// (0.12.0); the door's autoModel names a model it reaches now that holds the
// question with AUTO_ROOM to answer in: the coop's router (llm_auto-big, or
// PLAN_AUTO_LIGHT) for light, Claude (Fable 5.1, or PLAN_AUTO_BIG) for big. The pick and its reason go on the
// job as `auto`, and the job's model becomes the model picked. No pick (too
// big for every window) fails the run with the reason, never a silent cut.
const AUTO_ROOM = 16000

// ---------- the classifier call (0.13.0, Auto Model Plan Phase 6) ----------
//
// Before the real call, a coop model that is already loaded reads a short
// summary of the run (autoSummary: its kind, its size, its phases, the
// questions going in, the plan's opening) and says light or big with a
// reason — the door's classifyTier. PLAN_AUTO_CLASSIFIER says what its word
// is worth: `decide` (the default: its tier is sent, the rule's kept beside
// it as `ruled`), `advise` (recorded on the job, the rule decides) or `off`
// (no call). When it does not decide — nothing loaded, the coop down, a
// timeout, neither word — the rule stands and the job says why it was
// skipped. Its tokens are spent on the coop; Phase 7 asks whether they are
// worth it, so both tiers are kept on every job.
const CLASSIFIER_MODES = ['off', 'advise', 'decide']
export const classifierMode = () => {
  const m = String(process.env.PLAN_AUTO_CLASSIFIER || 'decide').toLowerCase()
  return CLASSIFIER_MODES.includes(m) ? m : 'decide'
}
const RUN_NAMES = { revise: 'Revise Plan', site: 'Revise Site', apply: 'Go Ahead, one page', next: 'Do Next Phase' }
const oneLine = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

/** What the classifier reads: a few hundred tokens about the run, never the question itself. */
export const autoSummary = ({ kind = 'revise', page = null, phase = null, questions = [], account = {}, action = '', isPlan = false, title = '' } = {}) => {
  const lines = [`Run: ${RUN_NAMES[kind] || kind}${page ? ` of "${page.title}"` : title ? ` on "${title}"` : ''}`]
  if (kind === 'apply') lines.push(`Action: ${action || 'Amend'}${isPlan ? ' — this page is the plan itself' : ''}`)
  if (page) {
    const st = planState(page)
    const open = st.phases.filter(p => p.done < p.total)
    lines.push(`Phases: ${st.phases.length}, open ${open.length}${open.length ? ` (${open.map(p => `${p.line}: ${p.done}/${p.total} done`).join(', ')})` : ''}`)
    const opener = (page.story || []).find(i => i && i.type === 'markdown' && (i.text || '').trim() && !/^#/.test((i.text || '').trim()))
    if (opener) lines.push(`Opening: ${oneLine(opener.text, 400)}`)
  }
  if (phase) {
    const cps = (phase.checkpoints || []).map(c => (typeof c === 'string' ? c : c.text))
    lines.push(`Phase to do: ${phase.label} — ${cps.length} checkpoint${cps.length === 1 ? '' : 's'}: ${oneLine(cps.join('; '), 600)}`)
  }
  const answered = questions.filter(q => q.answered)
  const fromAccount = !questions.length && Array.isArray(account.answers) ? account.answers.map(a => (typeof a === 'string' ? { title: a } : a)) : []
  const list = answered.length ? answered : fromAccount
  lines.push(`Answered questions going in: ${list.length}${list.length ? '\n' + list.map(q => `- ${q.title}${q.answer ? ` — ${oneLine(q.answer, 160)}` : q.inline ? '' : ' (an answer page)'}`).join('\n') : ''}`)
  const asked = questions.filter(q => q.query).map(q => q.title)
  const askedBack = asked.length ? asked : Array.isArray(account.queries) ? account.queries : []
  if (askedBack.length) lines.push(`Asked back, not answered: ${askedBack.join('; ')}`)
  if (kind === 'site') {
    const shown = account.pages || []
    const brief = account.brief || []
    lines.push(`Pages of the site going in: ${shown.length} in full, ${brief.length} in brief${shown.length ? ` — ${oneLine(shown.map(p => p.title).slice(0, 30).join('; '), 600)}` : ''}`)
  }
  return lines.join('\n')
}

/** Auto's pick for one question: {asked, tier, weight, why, model, note, tokens, ruled, classifier?, line}. */
export const autoPick = async (signals, content, { system = SYSTEM, doors = null, summary = '', classify = classifyTier } = {}) => {
  const need = estimateTokens(system) + estimateTokens(content)
  const ruled = autoTier({ ...signals, tokens: need, bigTokens: +process.env.PLAN_AUTO_BIG_TOKENS || AUTO.bigTokens })
  const list = doors || (await listModels()).doors
  const mode = classifierMode()
  let t = ruled
  let classifier = null
  if (mode !== 'off' && String(summary).trim()) {
    const c = await classify({ summary: `Question: ${tokensLabel(need)} tokens\n${summary}`, doors: list, model: process.env.PLAN_AUTO_CLASSIFIER_MODEL || '' })
    const decided = mode === 'decide' && !!c.tier
    classifier = { mode, tier: c.tier || null, reason: c.reason || '', model: c.model || '', ms: c.ms || 0, ...(c.usage ? { usage: c.usage } : {}), ...(c.skipped ? { skipped: c.skipped } : {}), decided }
    if (decided && c.tier !== ruled.tier) t = { ...ruled, tier: c.tier }
  }
  const r = autoModel({ tier: t.tier, need, doors: list, answer: AUTO_ROOM, light: process.env.PLAN_AUTO_LIGHT || '', big: process.env.PLAN_AUTO_BIG || '' })
  const auto = { asked: t.tier, tier: r.tier, weight: ruled.weight, why: ruled.why, model: r.model, note: r.note || '', tokens: need, ruled: ruled.tier, ...(classifier ? { classifier } : {}) }
  if (!r.model) throw problem(400, `auto found no model for this run (${ruled.why}): ${r.note}`)
  return { ...auto, line: autoLine(auto) }
}

/** What a revise or next run weighs, read off the plan and its questions. */
const planSignals = (kind, site, page, phase) => {
  const { questions } = questionsFor(site, page)
  const st = planState(page)
  return {
    kind,
    answers: questions.filter(q => q.answered).length,
    queries: questions.filter(q => q.query).length,
    openPhases: st.phases.filter(p => p.done < p.total).length,
    checkpoints: phase ? phase.total - phase.done : 0,
  }
}

/** The models the Model Settings page offers: each door's, live, and the farm's default. */
export async function models() {
  const { doors } = await listModels()
  return {
    default: planModel(),
    defaultFrom: process.env.PLAN_MODEL ? 'PLAN_MODEL' : 'the Plan Tool',
    research: RESEARCH_MODEL,
    doors,
    auto: {
      available: true,
      rule: AUTO_RULE + (classifierMode() === 'off' ? '' : ` A loaded coop model reads a summary of the run first and ${classifierMode() === 'decide' ? 'decides' : 'advises'} the tier.`),
      thresholds: AUTO,
      room: AUTO_ROOM,
      classifier: { mode: classifierMode(), model: (classifierModel(doors, process.env.PLAN_AUTO_CLASSIFIER_MODEL || '') || {}).id || null },
    },
  }
}
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
const start = ({ kind, origin, status, slug, site, page, phase, session, title = null, build = null, holdOff = null, meta = null, after = null, run = null, model: chosen = '' }) => {
  forget()
  const scope = `${origin}/${slug}`
  const model = chooseModel(chosen) // before the claim: a bad id is a 400, not a held marker
  const wip = claim({ session, scope, holdOff: holdOff || `${session}: a model is reading the plan; the report opens as a ghost page and nothing is written to the plan` })
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
    reportTitle: title || reportTitle({ kind, planTitle: page.title, phaseLabel: phase ? phase.label : '', date: today() }),
    session,
    model,
    ...(meta ? { meta } : {}),
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
      if (run) {
        j.result = await run(j, model)
        j.status = 'done'
        return
      }
      const { content, account } = build ? build() : buildContent({ kind, page, phase, origin, siteDir: site })
      j.context = account
      let asking = model
      if (model === 'auto') {
        const signals =
          kind === 'site'
            ? { kind, answers: (account.answers || []).length, queries: (account.queries || []).length, pages: (account.pages || []).length + (account.brief || []).length }
            : planSignals(kind, site, page, phase)
        const summary = autoSummary({ kind, page, phase, questions: kind === 'site' ? [] : questionsFor(site, page).questions, account })
        j.auto = await autoPick(signals, content, { summary })
        asking = j.model = j.auto.model
      }
      persist(j)
      const out = await askPlan(asking, content, { system: SYSTEM, allowTools: false })
      const ticks = kind === 'next' ? proposedTicks(out.markdown, phase.checkpoints) : null
      j.result = {
        markdown: out.markdown,
        model: out.model,
        ms: out.ms,
        reportTitle: j.reportTitle,
        ...(j.auto ? { auto: j.auto } : {}),
        ...(ticks ? { proposedTicks: { found: ticks.found, none: ticks.none, listed: ticks.listed, matched: ticks.matched.map(c => c.text) } } : {}),
        ...(kind === 'site' ? { proposal: proposalSummary(out.markdown, page.title, origin) } : {}),
        ...(after ? after(out) : {}),
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

/** What a proposal's markdown holds, read back as the saved page will be: rows by action, untouched, names. */
const proposalSummary = (markdown, planTitle, origin) => {
  const pr = parseProposal({ story: proposalItems({ markdown, planTitle, site: origin }) })
  const actions = {}
  for (const r of pr.rows) actions[r.action] = (actions[r.action] || 0) + 1
  return { rows: pr.rows.length, actions, untouched: pr.untouched.length, names: pr.names.filter(n => !/^none\.?$/i.test(n.name)).length, tone: !!pr.tone }
}

/** Do Next Phase: the plan's next phase (or the one named) to the door, as a job. */
export async function next({ slug, phase, model, origin, status } = {}) {
  const p = readPlan(status, origin, slug)
  const chosen = choosePhase(p.page, phase)
  if (!chosen) {
    if (phase !== undefined && phase !== null && phase !== '') throw problem(400, `${p.page.title} has no phase ${phase} with checkpoints`)
    throw problem(400, `every checkpoint of ${p.page.title} is ticked: there is no next phase to do`)
  }
  const which = chosen.number === null ? chosen.heading : chosen.number
  const session = `Plan Tool: Do Next Phase ${origin}/${p.slug} phase ${which}`
  return start({ kind: 'next', origin, status, slug: p.slug, site: p.site, page: p.page, phase: chosen, session, model })
}

/** A revise run's way and the owner's words, checked: 400 before anything is claimed. */
export const reviseHow = ({ mode, direction } = {}, { saving = false } = {}) => {
  const m = mode === undefined || mode === null || mode === '' ? 'answers' : String(mode)
  if (!REVISE_MODES.includes(m)) throw problem(400, `not a way to revise a plan: ${m.slice(0, 40)}; one of ${REVISE_MODES.join(', ')}`)
  const d = String(direction || '').replace(/\r\n?/g, '\n').trim()
  if (d.length > DIRECTION_CAP) throw problem(400, `the direction is ${d.length.toLocaleString('en')} characters; keep it under ${DIRECTION_CAP.toLocaleString('en')}, or save it as a page and link it from the plan`)
  if (m === 'direction' && !d && !saving) throw problem(400, 'From your direction needs the direction: type it, or speak it through the Voice Tool, then revise')
  return { mode: m, direction: d }
}

/**
 * Revise Plan: the whole plan to the door, asked to redraft it — from the
 * answered questions (the default), from the owner's direction, to catch up
 * with the work done, or to tidy its format (0.15.0, reviseAsk in prompt.js).
 */
export async function revise({ slug, model, mode, direction, origin, status } = {}) {
  const how = reviseHow({ mode, direction })
  const p = readPlan(status, origin, slug)
  const session = `Plan Tool: Revise Plan${how.mode === 'answers' ? '' : ` (${how.mode})`} ${origin}/${p.slug}`
  return start({
    kind: 'revise',
    origin,
    status,
    slug: p.slug,
    site: p.site,
    page: p.page,
    phase: null,
    session,
    model,
    meta: how,
    build: () => buildContent({ kind: 'revise', page: p.page, phase: null, origin, siteDir: p.site, ...how }),
  })
}

// ======================================================================
// Red-link (0.7.0) — the plan's links with no page behind them, researched.
// ======================================================================
//
// redlink reads the plan, finds its red links (redLinksOf in core.js: no page
// with the slug on any site of this farm or of the farms named in
// WIKI_EXTRA_FARMS, and not one of the installed plugins' own pages; question
// links and the Open Questions section left alone) and, as a job, takes them
// one at a time, at most RESEARCH_BATCH a run: the door researches each on
// the web (WebSearch and WebFetch, nothing else) and the page is written at
// once, a new page with one journaled create, never over a page that exists
// by then. One at a time keeps one claude in its memory scope on the Pi5.
// The job's progress names the page in hand; its result lists what was
// written, skipped and failed.

const RESEARCH_BATCH = 6
const RESEARCH_TIMEOUT_MS = 6 * 60 * 1000

/** Slugs that have a page on any site of these farm roots. */
const farmSlugs = roots => {
  const known = new Set()
  for (const root of roots) {
    let sites = []
    try {
      sites = fs.readdirSync(root)
    } catch {
      continue
    }
    for (const s of sites) {
      let pages = []
      try {
        pages = fs.readdirSync(path.join(root, s, 'pages'))
      } catch {
        continue
      }
      for (const p of pages) known.add(p)
    }
  }
  return known
}

// A plugin's own pages (its pages/ folder: About X Plugin, a tool page) are
// served on every site of the farm without being in any site's pages/, so a
// link to one is not red. The installed plugins are found beside the wiki
// package the farm runs (from node's own path, the wiki script, or
// WIKI_PACKAGE_DIR) and beside this plugin, real path and link alike.
const pluginDirs = () => {
  const dirs = new Set()
  if (process.env.WIKI_PACKAGE_DIR) dirs.add(process.env.WIKI_PACKAGE_DIR)
  dirs.add(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'wiki', 'node_modules'))
  try {
    if (process.argv[1]) dirs.add(path.join(path.dirname(fs.realpathSync(process.argv[1])), 'node_modules'))
  } catch {}
  const self = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  dirs.add(path.dirname(self))
  return [...dirs]
}

const pluginPageSlugs = () => {
  const known = new Set()
  for (const dir of pluginDirs()) {
    let names = []
    try {
      names = fs.readdirSync(dir).filter(n => n.startsWith('wiki-plugin-'))
    } catch {
      continue
    }
    for (const n of names) {
      try {
        for (const p of fs.readdirSync(path.join(dir, n, 'pages'))) known.add(p)
      } catch {}
    }
  }
  return known
}

/** Every slug a reader of this farm can open: the farm's sites, the extra farms, the plugins' pages. */
const knownSlugs = (farmRoot, site) => new Set([...farmSlugs(farmRoots(farmRoot, site)), ...pluginPageSlugs()])

const farmRoots = (farmRoot, site) => [farmRoot || path.dirname(site), ...String(process.env.WIKI_EXTRA_FARMS || '').split(/[:,]/).map(s => s.trim()).filter(Boolean)]

/** The page titles of this site, for the door to link to; from the sitemap when there is one. */
const siteTitles = site => {
  try {
    return JSON.parse(fs.readFileSync(path.join(site, 'status', 'sitemap.json'), 'utf8')).map(e => e && e.title).filter(Boolean)
  } catch {
    return []
  }
}

/** Red-link: research each red link of the plan on the web and write its page, as a job. */
export async function redlink({ slug, model, origin, status, farmRoot } = {}) {
  const p = readPlan(status, origin, slug)
  const found = redLinksOf(p.page, knownSlugs(farmRoot, p.site))
  // The plan's links to untouched stubs of Red-link's own on this site count as missing too.
  const stubs = []
  const seen = new Set(found.red.map(r => r.slug))
  for (const l of planLinks(p.page)) {
    const s = asSlug(l.title)
    if (!s || seen.has(s) || l.held || l.title.endsWith('?')) continue
    seen.add(s)
    const page = readJson(path.join(p.site, 'pages', s))
    if (isUntouchedStub(page)) stubs.push({ title: l.title, slug: s, kind: l.kind, context: l.context, section: l.section, stub: true })
  }
  const kept = found.questions.length ? `; ${found.questions.length} question link${found.questions.length === 1 ? ' is' : 's are'} left for their answers` : ''
  if (!found.red.length && !stubs.length) throw problem(400, `${p.page.title} has no red links: every link on it has a page on this farm${kept}`)
  const todo = [...found.red, ...stubs].slice(0, RESEARCH_BATCH)
  const session = `Plan Tool: Red-link ${origin}/${p.slug}`
  return start({
    kind: 'redlink',
    origin,
    status,
    slug: p.slug,
    site: p.site,
    page: p.page,
    phase: null,
    session,
    title: p.page.title,
    meta: { red: todo.map(r => r.title), stubs: todo.filter(r => r.stub).map(r => r.title), more: found.red.length + stubs.length - todo.length, questions: found.questions, held: found.held, existing: found.existing },
    holdOff: `${session}: researching the plan's red links on the web and writing their pages, one at a time`,
    // Research needs tools, and only the Claude CLI has them: a Claude model
    // chosen is used, any other gives way to RESEARCH_MODEL.
    model: model && isModelId(model) && isClaudeModel(model) ? model : RESEARCH_MODEL,
    run: async (j, model) => {
      // Research needs the CLI: the API road has no tools.
      const how = /^claude-(?!cli:)/.test(model) ? `claude-cli:${model}` : model
      const titles = siteTitles(p.site)
      const written = []
      const skipped = []
      const failed = []
      const t0 = Date.now()
      for (const [i, r] of todo.entries()) {
        j.progress = { n: i + 1, of: todo.length, title: r.title }
        persist(j)
        try {
          const { content } = buildResearchContent({ page: p.page, link: r, titles, origin })
          const out = await ask(how, content, { system: SYSTEM, timeoutMs: RESEARCH_TIMEOUT_MS, tools: RESEARCH_TOOLS })
          const { title, body } = parseResearch(out.markdown, r.title)
          if (!body) throw new Error('the model wrote no page')
          const file = path.join(p.site, 'pages', checkSlug(r.slug))
          if (r.stub) {
            // Read again: written over only while it is still the untouched stub.
            const stub = readJson(file)
            if (!isUntouchedStub(stub)) {
              skipped.push({ title: r.title, slug: r.slug, why: 'the stub was edited meanwhile' })
              continue
            }
            const page = researchedOverStub({ stub, title, body, planTitle: p.page.title, model: out.model })
            if (JSON.stringify(storyAt(page)) !== JSON.stringify(page.story)) throw new Error('the journal would not replay to the researched page')
            writeAtomic(status, file, JSON.stringify(page, null, 2))
            written.push({ title, slug: r.slug, ms: out.ms, overStub: true })
            continue
          }
          if (fs.existsSync(file) || knownSlugs(farmRoot, p.site).has(r.slug)) {
            skipped.push({ title: r.title, slug: r.slug, why: 'a page with that slug is on the farm now' })
            continue
          }
          writeAtomic(status, file, JSON.stringify(researchedPage({ title, body, planTitle: p.page.title, model: out.model }), null, 2))
          written.push({ title, slug: r.slug, ms: out.ms })
        } catch (e) {
          failed.push({ title: r.title, slug: r.slug, error: e.message })
        }
        j.done = { written, skipped, failed }
        persist(j)
      }
      const indexReset = written.length ? resetIndex(status) : false
      return { model: how, ms: Date.now() - t0, reportTitle: j.reportTitle, written, skipped, failed, index: { reset: indexReset } }
    },
  })
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


// ======================================================================
// Phase 7 — Revise Site and Go Ahead.
// ======================================================================
//
// reviseSite is a job like next and revise: every answered question's page,
// then every page on the site, to the door, which answers a Revision
// Proposal (the tone shift, a Page | Action | Reason table, the pages it will
// not touch, the names it found). Nothing is written: the client opens it as
// a ghost with Go Ahead and Pause, and Pause saves it as a page.
//
// applyRevision is Go Ahead: the saved proposal page is read back, and every
// Amend, Rewrite and New row, in the table's order with the plan last, goes
// to the door one page at a time; each page comes back whole and is written
// whole, journaled, with the provenance naming the proposal and the answers.
// Never written, whatever the table says: a page deleted (there is no delete
// here at all), an answer page, the Open Questions page, a page forked from
// or credited to another site, a page the proposal lists as Untouched, a
// proposal page. A page that would carry a name whose box on the proposal is
// still unticked, and that it did not carry before, is not written either.
// The farm WIP marker is held for the whole run.

/** A free title for a new proposal: Revision Proposal, else dated, else numbered. */
const proposalTitle = (site, date = today()) => {
  const free = t => !fs.existsSync(path.join(site, 'pages', asSlug(t)))
  if (free(PROPOSAL_TITLE)) return PROPOSAL_TITLE
  const dated = `${PROPOSAL_TITLE} ${date}`
  if (free(dated)) return dated
  for (let n = 2; ; n++) if (free(`${dated} ${n}`)) return `${dated} ${n}`
}

/** Revise Site: the answers and every page of the site to the door, asked for a revision proposal, as a job. */
export async function reviseSite({ slug, model, origin, status } = {}) {
  const p = readPlan(status, origin, slug)
  const { questions } = questionsFor(p.site, p.page)
  if (!questions.some(q => q.answered)) {
    throw problem(400, `no open question of ${p.page.title} is answered on ${origin} yet: answer one, with a page behind its link or "*Answer: …*" on its line, on the plan's Open Questions or the page it links as [[Open Questions]], then revise the site`)
  }
  const session = `Plan Tool: Revise Site ${origin}/${p.slug}`
  return start({
    kind: 'site',
    origin,
    status,
    slug: p.slug,
    site: p.site,
    page: p.page,
    phase: null,
    session,
    title: proposalTitle(p.site),
    holdOff: `${session}: a model is reading the whole site; the proposal opens as a ghost page and nothing is written`,
    build: () => buildSiteContent({ page: p.page, origin, siteDir: p.site }),
    model,
  })
}

const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** The plan a proposal is for: the slug given, else the first page it links whose title is a plan's. */
const planOfProposal = (site, proposal, plan) => {
  if (plan) return checkSlug(plan)
  for (const it of proposal.story || []) {
    for (const t of wikilinksIn(it && it.text)) {
      if (!isPlanTitle(t)) continue
      if (fs.existsSync(path.join(site, 'pages', asSlug(t)))) return asSlug(t)
    }
  }
  throw problem(400, `${proposal.title} links no plan on this site: say which plan it is for`)
}

const count = actions => actions.reduce((n, a) => ({ ...n, [a.type]: (n[a.type] || 0) + 1 }), {})

/** Go Ahead: the saved proposal's rows to the door one page at a time, each written whole and journaled, the plan last; as a job. */
export async function applyRevision({ slug, plan, model: chosen, origin, status } = {}) {
  const s = checkSlug(slug)
  const site = siteDir(status)
  const proposalFile = path.join(site, 'pages', s)
  const peek = readJson(proposalFile)
  if (!peek) throw problem(404, `no page ${s} on ${origin}`)
  const parsed = parseProposal(peek)
  if (!parsed.rows.length) throw problem(400, `${peek.title || s} has no Page | Action | Reason table: it is not a revision proposal`)
  if (proposalApplied(peek)) throw problem(400, `${peek.title} has already been applied; run Revise Site again for a new proposal`)
  const p = readPlan(status, origin, planOfProposal(site, peek, plan))

  forget()
  const session = `plan: revise site ${origin}`
  const model = chooseModel(chosen)
  const wip = claim({ session, scope: origin, holdOff: `Go Ahead is rewriting pages of ${origin} from ${peek.title}, one at a time, the plan last; do not edit them until it is done` })
  const id = crypto.randomBytes(8).toString('hex')
  const j = {
    id,
    origin,
    statusDir: status,
    token: wip.token,
    kind: 'apply',
    slug: p.slug,
    title: p.page.title,
    proposal: { slug: s, title: peek.title },
    session,
    model,
    status: 'running',
    started: Date.now(),
    progress: { n: 0, of: 0, title: '' },
    wip: { session, claimed: wip.claimed, heartbeat: wip.claimed, ...(wip.took ? { tookStaleClaim: wip.took } : {}) },
  }

  // Under the claim: read the proposal and the plan again, and decide each row.
  let work
  try {
    const proposal = readJson(proposalFile)
    const prop = parseProposal(proposal)
    const plan = readJson(path.join(site, 'pages', p.slug))
    const { questions, openQuestions } = questionsFor(site, plan)
    const answerSlugs = new Set(questions.filter(q => q.answered).map(q => q.slug))
    const untouched = new Set(prop.untouched.map(t => asSlug(t)))
    const refused = []
    const kept = []
    const todo = []
    const seen = new Set()
    for (const row of prop.rows) {
      const title = row.page
      const rs = asSlug(title)
      const refuse = why => refused.push({ title, action: row.action, why })
      if (!rs) continue
      if (seen.has(rs)) {
        refuse('listed twice; the first row stands')
        continue
      }
      seen.add(rs)
      if (row.action === 'Keep') {
        kept.push(title)
        continue
      }
      if (!ACTIONS.includes(row.action)) {
        refuse(/delete|remove/i.test(row.action) ? 'a page is never deleted' : `"${row.action}" is not Keep, Amend, Rewrite or New`)
        continue
      }
      if (rs === s || PROPOSAL_RE.test(title)) {
        refuse('a revision proposal is a record, never revised')
        continue
      }
      if (answerSlugs.has(rs)) {
        refuse('an answer page is never written')
        continue
      }
      if (openQuestions && rs === openQuestions.slug) {
        refuse('the Open Questions page is the record of what was asked')
        continue
      }
      if (untouched.has(rs)) {
        refuse('listed under Untouched on the proposal')
        continue
      }
      const file = path.join(site, 'pages', rs)
      const target = readJson(file)
      let action = row.action
      if (target) {
        const foreign = foreignOf(target, origin)
        if (foreign) {
          refuse(`${foreign}: another site's page is never written`)
          continue
        }
        if (action === 'New') action = 'Amend'
      } else if (action !== 'New') {
        refuse(`no page of that title on ${origin}, and the row does not ask for a New one`)
        continue
      } else if (fs.existsSync(file)) {
        refuse('a page is there but cannot be read')
        continue
      }
      todo.push({ title: target ? target.title || title : title, slug: rs, action, asked: row.action, reason: row.reason, isPlan: rs === p.slug })
    }
    // The plan last.
    work = { todo: [...todo.filter(w => !w.isPlan), ...todo.filter(w => w.isPlan)], refused, kept, prop, plan, proposal }
  } catch (e) {
    try {
      release(wip.token)
    } catch {}
    throw e
  }

  const unconfirmed = work.prop.names.filter(n => !n.confirmed && !/^none\.?$/i.test(n.name)).map(n => n.name)
  const confirmed = work.prop.names.filter(n => n.confirmed).map(n => n.name)
  j.progress.of = work.todo.length
  j.account = {
    rows: work.prop.rows.length,
    kept: work.kept,
    refused: work.refused,
    written: [],
    failed: [],
    names: { unconfirmed, confirmed },
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
    let wrote = 0
    try {
      const answers = answerPages(site, work.plan)
      const drawn = answers.pages.map(a => a.title)
      const provenance = `Revised by the Plan Tool (Revise Site) from ${peek.title}, drawing on: ${drawn.join('; ') || 'no answer'}.`
      for (const w of work.todo) {
        j.progress = { n: j.progress.n + 1, of: work.todo.length, title: w.title }
        persist(j)
        const file = path.join(site, 'pages', w.slug)
        const before = readJson(file)
        const bytesBefore = before ? Buffer.byteLength(JSON.stringify(before, null, 2)) : 0
        try {
          const { content } = buildPageContent({
            target: before,
            title: w.title,
            action: w.action,
            reason: w.reason,
            tone: work.prop.tone,
            proposalTitle: peek.title,
            answers: answers.pages,
            unconfirmed,
            isPlan: w.isPlan,
            origin,
          })
          let asking = model
          let auto = null
          if (model === 'auto') {
            auto = await autoPick({ kind: 'apply', answers: answers.pages.length, action: w.action, isPlan: w.isPlan }, content, {
              summary: autoSummary({ kind: 'apply', page: before, title: w.title, action: w.action, isPlan: w.isPlan, account: { answers: answers.pages.map(a => ({ title: a.title, inline: !!a.inline })) } }),
            })
            asking = auto.model
            j.progress = { ...j.progress, auto: auto.line }
            persist(j)
          }
          const out = await askPlan(asking, content, { system: SYSTEM, allowTools: false })
          const old = before || { title: w.title, story: [], journal: [] }
          const story = storyFromReply(old, out.markdown)
          if (!story.some(it => it.type === 'markdown' && String(it.text || '').trim())) throw new Error('the door answered no page')
          const draft = { ...old, story }
          const names = namesCopied(before || { story: [] }, draft, unconfirmed)
          if (names.length) {
            j.account.refused.push({ title: w.title, action: w.asked, why: `name not confirmed: ${names.join(', ')}` })
            persist(j)
            continue
          }
          const date = Date.now()
          let page
          let actions
          if (before) {
            const r = reviseJournal(before.story || [], story, { provenance, date })
            actions = r.actions
            page = { ...before, story: r.story, journal: [...(before.journal || []), ...actions] }
          } else {
            actions = [{ type: 'create', item: { title: w.title, story: story.map(it => ({ ...it })) }, date, provenance }]
            page = { title: w.title, story, journal: actions }
          }
          const body = JSON.stringify(page, null, 2)
          writeAtomic(status, file, body)
          wrote++
          const dropped = before ? linksOf(before).filter(t => !linksOf(page).includes(t)) : []
          const entry = { title: w.title, slug: w.slug, action: w.action, ...(w.asked !== w.action ? { asked: w.asked } : {}), before: bytesBefore, after: Buffer.byteLength(body), journal: count(actions), model: out.model, ms: out.ms, ...(auto ? { auto: auto.line } : {}) }
          if (dropped.length) entry.linksDropped = dropped
          if (w.isPlan) {
            const md = planMarkdown(page)
            writeAtomic(status, path.join(site, 'assets', w.slug, `${w.slug}.md`), md)
            entry.asset = { rendered: true, path: `/assets/${w.slug}/${w.slug}.md`, lines: md.split('\n').length - 1 }
          }
          j.account.written.push(entry)
        } catch (e) {
          j.account.failed.push({ title: w.title, action: w.action, error: e.message })
        }
        persist(j)
      }

      // The proposal says it was applied, so Go Ahead is not offered twice.
      const now = readJson(proposalFile)
      if (now) {
        const n = j.account.written.length
        const text =
          `Applied through the [[Plan Tool]]'s Go Ahead on ${today()}: ${n} page${n === 1 ? '' : 's'} written` +
          (n ? ` (${j.account.written.map(x => `[[${x.title}]]`).join(', ')})` : '') +
          `, ${j.account.refused.length} refused, ${j.account.failed.length} failed, ${j.account.kept.length} kept as they were.`
        const story = now.story || []
        const see = story.findIndex(it => it && it.type === 'markdown' && /^see$/i.test(headingOf(it) || ''))
        const at = see === -1 ? story.length : see
        const item = { type: 'markdown', id: crypto.randomBytes(8).toString('hex'), text }
        story.splice(at, 0, item)
        now.story = story
        now.journal = [...(now.journal || []), { type: 'add', id: item.id, item: { ...item }, after: at > 0 ? story[at - 1].id : null, date: Date.now(), provenance: 'Go Ahead, the Plan Tool (Revise Site).' }]
        writeAtomic(status, proposalFile, JSON.stringify(now, null, 2))
        wrote++
      }
      j.result = { model, written: j.account.written.length, refused: j.account.refused.length, failed: j.account.failed.length, kept: j.account.kept.length }
      j.status = 'done'
    } catch (e) {
      j.status = 'failed'
      j.error = e.message
    } finally {
      clearInterval(beat)
      try {
        if (wrote) j.account.indexReset = resetIndex(status)
      } catch {}
      try {
        j.wip.released = release(wip.token)
      } catch (e) {
        j.wip.releaseError = e.message
      }
      j.finished = Date.now()
      persist(j)
    }
  })()

  return { job: id, status: j.status, kind: 'apply', slug: p.slug, title: p.page.title, proposal: j.proposal, pages: work.todo.map(w => ({ title: w.title, action: w.action })), refused: work.refused, kept: work.kept, model, session, started: j.started }
}


// ======================================================================
// Phase 8 — Save over the plan.
// ======================================================================
//
// Mechanical, like update: no model. It writes one page, the plan, whole and
// journaled (writeRevision in core.js: the journal reconciled first when a
// script wrote the page without entries, then reviseJournal), so the version
// replaced is /view/<slug>_rev<N>, drawn by the wiki from the journal. It
// writes the page as it was to the site's recycler first (where the wiki's
// own fork puts the page it replaces), re-renders the plan's markdown asset
// as Update Plan does and resets the index. Refused: a page forked from or
// credited to another site (foreignOf), and a held WIP marker (409). Rewind
// has no write here at all: the client opens the rev the journal holds as a
// ghost, and the wiki's own fork of it is the rewind.

const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The story a client sent: an array of items, each with a type and an id, the ids distinct. */
const checkStory = story => {
  if (!Array.isArray(story) || !story.length) throw problem(400, 'no story: send the ghost page\'s story to write over the plan')
  const ids = new Set()
  for (const it of story) {
    if (!it || typeof it !== 'object' || typeof it.type !== 'string' || !it.type || typeof it.id !== 'string' || !ITEM_ID.test(it.id)) throw problem(400, 'every item needs a type and an id')
    if (ids.has(it.id)) throw problem(400, `item id ${it.id} is there twice`)
    ids.add(it.id)
  }
  return story
}

/** The plan as it was, to {site}/recycle/<slug>, as the wiki's fork saves it to its recycler. */
const recycle = (status, site, slug, text) => {
  const file = path.join(site, 'recycle', slug)
  writeAtomic(status, file, text)
  return `recycle/${slug}`
}

/** Read under the claim, refuse a foreign page, recycle, write, re-render, reset. */
const writeOver = ({ origin, status, slug, session, holdOff, make }) => {
  const site = siteDir(status)
  const pageFile = path.join(site, 'pages', slug)
  const wip = claim({ session, scope: `${origin}/${slug}`, holdOff })
  try {
    const text = fs.readFileSync(pageFile, 'utf8')
    const page = JSON.parse(text)
    const foreign = foreignOf(page, origin)
    if (foreign) throw problem(400, `${page.title} is ${foreign}: another site's page is never written over; fork it here first`)
    let out
    try {
      out = make(page)
    } catch (e) {
      throw e.status ? e : problem(500, `${e.message}; nothing was written`)
    }
    if (!out.changed) {
      const released = release(wip.token)
      return { slug, title: page.title, written: false, why: 'it would change nothing', wip: { token: wip.token, session, released } }
    }
    const recycled = recycle(status, site, slug, text)
    writeAtomic(status, pageFile, JSON.stringify(out.page, null, 2))
    const indexReset = resetIndex(status)
    const md = planMarkdown(out.page)
    const assetFile = path.join(site, 'assets', slug, `${slug}.md`)
    let before = null
    try {
      before = fs.readFileSync(assetFile, 'utf8')
    } catch {}
    writeAtomic(status, assetFile, md)
    const released = release(wip.token)
    const n = out.previous
    return {
      slug,
      title: page.title,
      written: true,
      previous: { rev: n, title: revLabel(page.title, n), slug: revSlug(page.title, n), path: `/view/${revSlug(page.title, n)}` },
      journal: { reconciled: out.reconcile.length, entries: out.actions.length, count: count(out.actions), length: out.page.journal.length },
      recycled,
      index: { reset: indexReset },
      asset: { rendered: true, path: `/assets/${slug}/${slug}.md`, changed: before !== md, lines: md.split('\n').length - 1 },
      wip: { token: wip.token, session, claimed: wip.claimed, released, ...(wip.took ? { tookStaleClaim: wip.took } : {}) },
    }
  } catch (e) {
    try {
      release(wip.token)
    } catch {}
    throw e
  }
}

/** Save over the plan: the revise ghost's story written over the plan, journaled, the old version its _rev. */
export async function saveRevision({ slug, story, model, kind, mode, direction, origin, status } = {}) {
  const p = readPlan(status, origin, slug)
  const how = kind === undefined || kind === null || kind === '' ? 'revise' : String(kind)
  if (!REVISION_KINDS.includes(how)) throw problem(400, `not a kind of revision: ${kind}; one of ${REVISION_KINDS.join(', ')}`)
  const want = checkStory(revisedStory(checkStory(story)))
  if (!want.some(it => it.type === 'plan')) throw problem(400, `the revision carries no plan item: a plan keeps its status line`)
  return writeOver({
    origin,
    status,
    slug: p.slug,
    session: `Plan Tool: Save over the plan ${origin}/${p.slug}`,
    holdOff: `Save over the plan is writing ${origin}/${p.slug}`,
    make: page => writeRevision(page, want, { model: model || '', kind: how, ...(how === 'revise' ? reviseHow({ mode, direction }, { saving: true }) : {}) }),
  })
}

/**
 * Re-render the plan's markdown asset from the page as it stands, as Update
 * Plan does, and nothing else: the tool calls it after the wiki's own fork of
 * a Rewind ghost lands, since that fork is the wiki's write, not the tool's.
 */
export async function render({ slug, origin, status } = {}) {
  const p = readPlan(status, origin, slug)
  const md = planMarkdown(p.page)
  const assetFile = path.join(p.site, 'assets', p.slug, `${p.slug}.md`)
  let before = null
  try {
    before = fs.readFileSync(assetFile, 'utf8')
  } catch {}
  writeAtomic(status, assetFile, md)
  return { slug: p.slug, title: p.page.title, asset: { rendered: true, path: `/assets/${p.slug}/${p.slug}.md`, changed: before !== md, lines: md.split('\n').length - 1 } }
}
