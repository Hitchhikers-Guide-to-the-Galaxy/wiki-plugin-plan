#!/usr/bin/env node
// stress-classifier.mjs — the classifier call under load, against the live
// coop, on real plans of the laptop farm (Auto Model Plan, Phase 6).
//
//   node scripts/stress-classifier.mjs [out.json] [--plans N] [--burst N] [--repeat N]
//
// For each plan: the real question (buildContent, as Revise Plan would send
// it), its size, the deterministic tier (autoTier) and the summary the
// classifier reads (autoSummary); then classifyTier for real. Three passes:
// serial over the plans, a concurrent burst, and the same summary repeated
// for consistency. Nothing is written to any page; no plan model is asked.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { classifyTier, listModels, estimateTokens, classifierModel } from '@fortyfoxes/wiki-claude-door'
import { buildContent, questionsFor, SYSTEM } from '../api/prompt.js'
import { autoSummary } from '../api/handlers.js'
import { autoTier, planState, AUTO } from '../src/client/core.js'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  return i === -1 ? dflt : +args[i + 1]
}
const out = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a)) || path.join(os.tmpdir(), 'stress-classifier.json')
const PLANS = flag('--plans', 24)
const BURST = flag('--burst', 8)
const REPEAT = flag('--repeat', 5)
const FARM = path.join(os.homedir(), 'Music/Guides/Private')

// every plan page on the private farm: a page with a `plan` item and a phase heading
const plans = []
for (const site of fs.readdirSync(FARM).filter(d => d.endsWith('.localhost'))) {
  const dir = path.join(FARM, site, 'pages')
  if (!fs.existsSync(dir)) continue
  for (const slug of fs.readdirSync(dir)) {
    try {
      const page = JSON.parse(fs.readFileSync(path.join(dir, slug), 'utf8'))
      const story = Array.isArray(page.story) ? page.story : []
      if (!story.some(i => i && i.type === 'plan') || !story.some(i => /^#+\s*Phase \d/m.test(i?.text || ''))) continue
      plans.push({ site, slug, page, siteDir: path.join(FARM, site) })
    } catch {}
  }
}
plans.sort((a, b) => JSON.stringify(b.page).length - JSON.stringify(a.page).length)
// a spread of sizes: every k-th plan from largest to smallest
const step = Math.max(1, Math.floor(plans.length / PLANS))
const sample = plans.filter((_, i) => i % step === 0).slice(0, PLANS)

const prepare = p => {
  const { questions } = questionsFor(p.siteDir, p.page)
  const st = planState(p.page)
  const { content } = buildContent({ kind: 'revise', page: p.page, phase: null, origin: p.site, siteDir: p.siteDir })
  const tokens = estimateTokens(SYSTEM) + estimateTokens(content)
  const signals = { kind: 'revise', answers: questions.filter(q => q.answered).length, queries: questions.filter(q => q.query).length, openPhases: st.phases.filter(x => x.done < x.total).length }
  const rule = autoTier({ ...signals, tokens, bigTokens: AUTO.bigTokens })
  const summary = `Question: ${tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : tokens} tokens\n` + autoSummary({ kind: 'revise', page: p.page, questions })
  return { site: p.site, slug: p.slug, title: p.page.title, tokens, signals, rule: rule.tier, weight: rule.weight, why: rule.why, summary, summaryTokens: estimateTokens(summary) }
}

const call = async (run, pass, doors) => {
  const t0 = Date.now()
  const c = await classifyTier({ summary: run.summary, doors })
  return { pass, site: run.site, slug: run.slug, title: run.title, tokens: run.tokens, rule: run.rule, weight: run.weight, why: run.why, summaryTokens: run.summaryTokens, tier: c.tier, reason: c.reason || '', skipped: c.skipped || '', model: c.model || '', ms: Date.now() - t0, usage: c.usage || null, agree: c.tier ? c.tier === run.rule : null }
}

const main = async () => {
  const { doors } = await listModels({ fresh: true })
  const m = classifierModel(doors)
  console.log(`plans on the farm: ${plans.length}; sampled ${sample.length}; classifier model now: ${m ? m.id : 'none loaded'}`)
  const runs = sample.map(prepare)
  const results = []
  console.log('— serial —')
  for (const r of runs) {
    const x = await call(r, 'serial', doors)
    results.push(x)
    console.log(`${x.ms}ms  rule ${x.rule}  classifier ${x.tier || 'skipped'}  ${x.tokens} tokens  ${x.title}${x.skipped ? `  [${x.skipped}]` : ''}`)
  }
  console.log(`— burst of ${BURST} —`)
  const burst = runs.slice(0, BURST)
  const t0 = Date.now()
  const got = await Promise.all(burst.map(r => call(r, 'burst', doors)))
  results.push(...got)
  console.log(`burst took ${Date.now() - t0}ms; ${got.filter(x => x.tier).length}/${got.length} answered; slowest ${Math.max(...got.map(x => x.ms))}ms`)
  console.log(`— the same summary ${REPEAT} times —`)
  const same = runs.find(r => r.rule === 'light' && r.tokens > 20000) || runs[Math.floor(runs.length / 2)]
  for (let i = 0; i < REPEAT; i++) {
    const x = await call(same, 'repeat', doors)
    results.push(x)
    console.log(`${x.ms}ms  ${x.tier || 'skipped'}: ${x.reason || x.skipped}`)
  }
  console.log('— a summary at the cap (12k characters) —')
  const long = { ...same, summary: same.summary + '\n' + 'Extra: '.padEnd(12000, 'the plan goes on and on, ') }
  const capped = await call(long, 'long', doors)
  results.push(capped)
  console.log(`${capped.ms}ms  ${capped.tier || 'skipped'}: ${capped.reason || capped.skipped}`)
  const after = classifierModel((await listModels({ fresh: true })).doors)
  const answered = results.filter(x => x.tier)
  const ms = answered.map(x => x.ms).sort((a, b) => a - b)
  const pct = p => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))] || 0
  const summary = {
    when: new Date().toISOString(),
    model: m ? m.id : null,
    modelAfter: after ? after.id : null,
    plans: plans.length,
    sampled: sample.length,
    calls: results.length,
    answered: answered.length,
    skipped: results.filter(x => !x.tier).map(x => ({ title: x.title, pass: x.pass, skipped: x.skipped })),
    agree: answered.filter(x => x.agree).length,
    disagree: answered.filter(x => x.agree === false).map(x => ({ title: x.title, pass: x.pass, rule: x.rule, tier: x.tier, why: x.why, reason: x.reason })),
    latency: { min: ms[0] || 0, median: pct(50), p90: pct(90), max: ms[ms.length - 1] || 0 },
    burst: { n: BURST, wall: Date.now() - t0 - 0, answered: got.filter(x => x.tier).length, slowest: Math.max(...got.map(x => x.ms)) },
    repeat: { n: REPEAT, title: same.title, tiers: results.filter(x => x.pass === 'repeat').map(x => x.tier) },
    tokens: {
      input: answered.reduce((n, x) => n + (x.usage?.input || 0), 0),
      output: answered.reduce((n, x) => n + (x.usage?.output || 0), 0),
      reasoning: answered.reduce((n, x) => n + (x.usage?.reasoning || 0), 0),
      questionTokensSampled: runs.reduce((n, r) => n + r.tokens, 0),
      summaryTokensSampled: runs.reduce((n, r) => n + r.summaryTokens, 0),
    },
  }
  fs.writeFileSync(out, JSON.stringify({ summary, results, runs: runs.map(({ summary: _s, ...r }) => r) }, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  console.log(`written: ${out}`)
}
main().catch(e => {
  console.error('FAILED', e)
  process.exit(1)
})
