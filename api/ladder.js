// ladder.js — what happens when a model fails (0.16.0).
//
// David, 2026-10-22: a coop model "sometimes fails — presumably too slow or
// too big a context. … rather than simply failing the tool should escalate up
// the ladder and try a more competent model — for now skip straight to Claude
// Max — but code this so we can get more sophisticated about the routing
// ourselves later." And every failure goes on a wiki page the coop can read.
//
// Two parts, kept apart so either can grow alone:
//   nextRung()     which model to ask after one failed. Today: anything off
//                  Claude climbs to the first rung of PLAN_LADDER not yet
//                  tried (default Claude Fable through the Claude Code CLI,
//                  the farm's Max account); Claude is the top. Later routing
//                  — by failure kind, run size, cost, the coop's own state —
//                  changes this function and nothing else.
//   logFailures()  every failed call, as a line in
//                  {status}/farm-tmp/model-failures.jsonl and, for the coop's
//                  models, as one journaled item on the page Coop Model
//                  Failures on PLAN_FAILURE_SITE (default coop.private.fish)
//                  on the same farm. It never throws: a log that cannot be
//                  written must not fail the run it describes.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const DEFAULT_LADDER = ['claude-cli:claude-fable-5-1']
export const FAILURE_TITLE = 'Coop Model Failures'
export const FAILURE_SLUG = 'coop-model-failures'

/** The rungs above the coop, lowest first: PLAN_LADDER (comma or space separated), `off` for none. */
export const ladder = (env = process.env) => {
  const v = String(env.PLAN_LADDER ?? '').trim()
  if (/^(off|none)$/i.test(v)) return []
  return v ? v.split(/[\s,]+/).filter(Boolean) : DEFAULT_LADDER
}

export const isClaude = model => /^(claude-cli:)?claude-/.test(String(model || ''))
export const isCoop = model => /^(openai|ollama):/.test(String(model || ''))

/** What kind of failure an error is, read off the door's words. */
export const failureKind = err => {
  const m = String((err && err.message) || err || '')
  if (/holds about [\d,]+ tokens/.test(m)) return 'window'
  if (/no router for requested model|model_not_found|unknown model|not_found/i.test(m)) return 'no such model'
  if (/\(length\)|spent all [\d,]+ max_tokens/.test(m)) return 'length'
  if (/timed? ?out|HEADERS_TIMEOUT|aborted|AbortError/i.test(m)) return 'timeout'
  if (/could not be reached|fetch failed|ECONN|ENOTFOUND|EHOSTUNREACH|socket/i.test(m)) return 'unreachable'
  if (/\b5\d\d\b|upstream/i.test(m)) return 'server'
  if (/no answer|empty/i.test(m)) return 'empty'
  return 'other'
}

/**
 * The model to ask after `model` failed with `error`, or null to give up.
 * `tried` is every model this call has asked; `run` says what the call is
 * ({kind, tokens}) for the routing to come. A refusal by the farm's gate is
 * not the model's failure and never climbs.
 */
export const nextRung = ({ model, error = null, tried = [], rungs = ladder(), run = {} } = {}) => {
  void run
  if (error && (error.status === 401 || error.status === 403 || error.status === 409)) return null
  if (isClaude(model)) return null
  for (const r of rungs) if (r !== model && !tried.includes(r)) return r
  return null
}

const secs = ms => {
  const s = Math.round((ms || 0) / 1000)
  return s < 90 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
const short = model => String(model || '').replace(/^claude-cli:/, '')
const pageUrl = (origin, slug) => `${/\.localhost$|^localhost/.test(origin) ? 'http' : 'https'}://${origin}/view/${slug}`

/** What came after a failure, in words: the next rung's answer, its failure, or the end of the ladder. */
export const thenText = (to, outcome) => {
  if (!to) return 'nothing above it on the ladder: the run failed'
  if (!outcome) return `escalated to ${short(to)}`
  return outcome.ok ? `escalated to ${short(to)}, which answered in ${secs(outcome.ms)}` : `escalated to ${short(to)}, which failed too (${outcome.kind})`
}

/** One failure as the line on the page. */
export const failureText = r =>
  `${r.when} · ${r.model} · ${r.run} of [${pageUrl(r.origin, r.slug)} ${r.title}] on ${r.origin} · about ${Math.round((r.tokens || 0) / 1000)}k tokens in (${Math.round((r.bytes || 0) / 1024)} kB) · ${r.kind} after ${secs(r.ms)}: ${String(r.error || '').replace(/\s+/g, ' ').slice(0, 400)} · ${r.then}.`

const randomId = () => crypto.randomBytes(8).toString('hex')

const OPENER =
  "Each failed call a [[Plan Tool]] run made to a model on the LLM coop, logged by the farm as it happens, so the coop can see what fails and why. After a failure the run moves up the ladder to a stronger model (Claude Fable today), and the same line says whether that answered. Times are the farm's local time; sizes are the question sent, the plan and the pages it links."

const newPage = date => {
  const story = [
    { type: 'paragraph', id: randomId(), text: OPENER },
    { type: 'markdown', id: randomId(), text: '# Failures\n> Oldest first; one line per failed call.' },
  ]
  return { title: FAILURE_TITLE, story, journal: [{ type: 'create', item: { title: FAILURE_TITLE, story: story.map(i => ({ ...i })) }, date, provenance: 'Started by the Plan Tool ladder (wiki-plugin-plan 0.16.0).' }] }
}

const atomic = (tmpDir, file, body) => {
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmp = path.join(tmpDir, `ladder-${Date.now()}-${randomId()}.part`)
  fs.writeFileSync(tmp, body, { flag: 'wx' })
  fs.renameSync(tmp, file)
}

/**
 * Log failed calls. `status` is the status folder of the site the run was
 * on; the page goes on `site` (a folder beside it on the same farm). Answers
 * {jsonl, page, why} saying where each went; never throws.
 */
export const logFailures = ({ status, records, site = process.env.PLAN_FAILURE_SITE || 'coop.private.fish', date = Date.now() } = {}) => {
  const out = { jsonl: null, page: null, site, why: '' }
  if (!status || !Array.isArray(records) || !records.length) return out
  try {
    const file = path.join(status, 'farm-tmp', 'model-failures.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n')
    out.jsonl = file
  } catch (e) {
    out.why = `jsonl: ${e.message}`
  }
  const coop = records.filter(r => isCoop(r.model))
  if (!coop.length) return out
  try {
    const farmRoot = path.dirname(path.dirname(status))
    const dir = path.join(farmRoot, site)
    if (!/^[a-z0-9.-]+$/.test(site) || !fs.existsSync(path.join(dir, 'pages'))) {
      out.why = `${out.why ? out.why + '; ' : ''}no site ${site} on this farm, so no page`
      return out
    }
    const file = path.join(dir, 'pages', FAILURE_SLUG)
    let page
    try {
      page = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      page = newPage(date)
    }
    page.story = Array.isArray(page.story) ? page.story : []
    page.journal = Array.isArray(page.journal) ? page.journal : []
    for (const r of coop) {
      const item = { type: 'markdown', id: randomId(), text: failureText(r) }
      const after = page.story.length ? page.story[page.story.length - 1].id : null
      page.story.push(item)
      page.journal.push({ type: 'add', id: item.id, item: { ...item }, after, date, provenance: `Plan Tool ladder: ${r.run} on ${r.origin}.` })
    }
    atomic(path.join(dir, 'status', 'farm-tmp'), file, JSON.stringify(page, null, 2))
    for (const f of ['sitemap.json', 'site-index.json', 'sitemap.xml']) fs.rmSync(path.join(dir, 'status', f), { force: true })
    out.page = file
  } catch (e) {
    out.why = `${out.why ? out.why + '; ' : ''}page: ${e.message}`
  }
  return out
}
