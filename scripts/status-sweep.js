#!/usr/bin/env node
// status-sweep.js — give every empty plan item its default text, STATUS.
//
// wiki-client removes an item whose text is saved empty, so a plan's status
// line written with empty text (the house convention before 0.5.0) is one
// unchanged save from deletion. This finds, on every site of a farm, the plan
// pages (isPlanTitle) whose `plan` items have empty text, and with --write
// sets each to STATUS with one journal edit per item, the page written whole
// (temp file and rename). Nothing else on the page changes. A page forked
// from or credited to a site that is NOT on this farm is left alone: it is
// not ours to write. A fork between two sites of the same farm (a demo twin)
// is ours. The write holds the farm WIP marker (api/wip.js, the wiki-wip
// protocol) and refuses when anyone else holds it.
//
//   node scripts/status-sweep.js [--farm ~/.wiki] [--site name] [--write]
//
// Without --write it only reports. Run it with David's OK, after the
// wiki-farm-checkin claim.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

import { isPlanTitle, DEFAULT_TEXT, forkSites, creditedSites } from '../src/client/core.js'
import { claim, release } from '../api/wip.js'

const args = process.argv.slice(2)
const opt = name => {
  const i = args.indexOf(name)
  return i === -1 ? null : args[i + 1]
}
const write = args.includes('--write')
const farm = (opt('--farm') || path.join(os.homedir(), '.wiki')).replace(/^~(?=\/)/, os.homedir())
const only = opt('--site')

const sites = fs
  .readdirSync(farm, { withFileTypes: true })
  .filter(e => (e.isDirectory() || e.isSymbolicLink()) && (!only || e.name === only))
  .map(e => e.name)
  .filter(s => fs.existsSync(path.join(farm, s, 'pages')))

const here = new Set(fs.readdirSync(farm))

// A symlinked alias (dns.pi5.local → dns.private.fish) is the same folder twice.
const seen = new Set()
const found = []
for (const site of sites) {
  const dir = fs.realpathSync(path.join(farm, site, 'pages'))
  if (seen.has(dir)) continue
  seen.add(dir)
  for (const slug of fs.readdirSync(dir)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) continue
    let page
    try {
      page = JSON.parse(fs.readFileSync(path.join(dir, slug), 'utf8'))
    } catch {
      continue
    }
    if (!isPlanTitle(page.title) || !Array.isArray(page.story)) continue
    const empty = page.story.filter(it => it && it.type === 'plan' && !String(it.text || '').trim())
    if (!empty.length) continue
    const away = [...new Set([...forkSites(page), ...creditedSites(page, site)])].filter(s => s && s !== site && !here.has(s))
    const foreign = away.length ? `from ${away.join(', ')}, not on this farm` : null
    found.push({ site, slug, dir, title: page.title, items: empty.length, foreign })
  }
}

const ours = found.filter(f => !f.foreign)
for (const f of found) console.log(`${f.foreign ? 'skip ' : write ? 'write' : 'would'} ${f.site}/${f.slug} — ${f.title}: ${f.items} empty plan item${f.items === 1 ? '' : 's'}${f.foreign ? ` (${f.foreign})` : ''}`)
console.log(`${found.length} plan page${found.length === 1 ? '' : 's'} with an empty plan item on ${farm}; ${ours.length} ours to write${write ? '' : '; dry run, nothing written (pass --write)'}`)
if (!write || !ours.length) process.exit(0)

const wip = claim({ session: `wiki-plugin-plan status-sweep ${os.hostname()}`, scope: farm, holdOff: 'status-sweep is giving empty plan items the text STATUS' })
try {
  for (const f of ours) {
    const file = path.join(f.dir, f.slug)
    const page = JSON.parse(fs.readFileSync(file, 'utf8'))
    const date = Date.now()
    for (const it of page.story) {
      if (!it || it.type !== 'plan' || String(it.text || '').trim()) continue
      it.text = DEFAULT_TEXT
      page.journal = [...(page.journal || []), { type: 'edit', id: it.id, item: { ...it }, date, provenance: 'status-sweep (wiki-plugin-plan 0.5.0): the empty status line given its default text, STATUS, so an unchanged save never deletes it.' }]
    }
    const tmp = path.join(path.dirname(f.dir), 'status', `.status-sweep-${crypto.randomBytes(6).toString('hex')}`)
    fs.mkdirSync(path.dirname(tmp), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(page, null, 2))
    fs.renameSync(tmp, file)
  }
} finally {
  release(wip.token)
}
console.log(`wrote ${ours.length} page${ours.length === 1 ? '' : 's'}`)
