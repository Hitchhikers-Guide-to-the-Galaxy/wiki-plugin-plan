// wip.js — the farm WIP marker, claimed and released from inside the farm.
//
// COPIED from ~/bin/wiki-wip (Python), the protocol every session on this
// machine already speaks, so a page edit made by Update Plan shows in
// `wiki-wip status` exactly as a session's own claim would:
//
//   - mkdir ~/.wiki-hosting/AGENT-WIP.lock is the mutual exclusion (atomic on
//     POSIX; exactly one claimant wins);
//   - a random token names the claim, written to AGENT-WIP.lock/owner.json;
//     release needs the matching token;
//   - AGENT-WIP.json is written by temp file plus rename, with the fields
//     wiki-wip writes, so plain `cat` and the skills keep reading it;
//   - liveness is the heartbeat's age, never a pid: stale after
//     WIKI_WIP_STALE_MIN minutes (default 30) without one;
//   - a session still on the legacy protocol (IN_PROGRESS written with no
//     token and no lock) is honoured, not walked over.
//
// Left out, on purpose: the Pi5 twin of the marker (scp) and the ntfy
// message. A farm handler must not wait on ssh or the network; Update Plan's
// claim lasts milliseconds, and a long run (Do Next Phase, Revise Plan)
// refreshes its own heartbeat every minute with heartbeat() below. Where wiki-wip refuses a stale lock and asks
// for `wiki-wip steal`, this takes a STALE lock over (the holder is presumed
// gone) and says so in its answer; a LIVE lock is refused with 409.
//
// WIKI_WIP_DIR moves the state directory, for the tests.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const CONTACT = 'Check in with the human (David) before acting on the wiki farm.'

export const stateDir = () => process.env.WIKI_WIP_DIR || path.join(os.homedir(), '.wiki-hosting')
const wipFile = () => path.join(stateDir(), 'AGENT-WIP.json')
const lockDir = () => path.join(stateDir(), 'AGENT-WIP.lock')
const ownerFile = () => path.join(lockDir(), 'owner.json')
const staleSeconds = () => parseFloat(process.env.WIKI_WIP_STALE_MIN || '30') * 60

const problem = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })

// time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()): whole seconds, Z.
export const utcnow = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const parseUtc = ts => {
  if (typeof ts !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(ts)) return null
  const t = Date.parse(ts)
  return Number.isFinite(t) ? t / 1000 : null
}

const fmtAge = seconds => {
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

const readJson = file => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// json.dump(doc, f, indent=1) + "\n", by temp file and rename.
const writeMarker = doc => {
  fs.mkdirSync(stateDir(), { recursive: true })
  const tmp = path.join(stateDir(), `.wip-${crypto.randomBytes(6).toString('hex')}`)
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 1) + '\n', { mode: 0o600, flag: 'wx' })
  fs.renameSync(tmp, wipFile())
}

const heartbeatState = (owner, marker) => {
  const ts = owner.heartbeat || marker.heartbeat || owner.since || marker.since
  const t = ts ? parseUtc(ts) : null
  if (t === null) return { age: null, stale: true }
  const age = Math.max(0, Date.now() / 1000 - t)
  return { age, stale: age > staleSeconds() }
}

export const holderLine = () => {
  const owner = readJson(ownerFile()) || {}
  const marker = readJson(wipFile()) || {}
  const who = owner.session || marker.session || '?'
  const since = owner.since || marker.since || '?'
  const { age, stale } = heartbeatState(owner, marker)
  const window = fmtAge(staleSeconds())
  const live =
    age === null
      ? `no readable heartbeat — treat as STALE (window ${window})`
      : stale
        ? `heartbeat ${fmtAge(age)} ago — STALE (window ${window})`
        : `heartbeat ${fmtAge(age)} ago — fresh (stale after ${window})`
  return `held by ${who} since ${since} (${live})`
}

/**
 * Claim the marker. Answers {token, session, claimed, took} or throws 409
 * naming the holder. `took` is the holder line of a stale claim taken over.
 */
export const claim = ({ session, scope = '', holdOff = '' }) => {
  fs.mkdirSync(stateDir(), { recursive: true })
  let took = null
  try {
    fs.mkdirSync(lockDir()) // the atomic acquire
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    const line = holderLine()
    const { stale } = heartbeatState(readJson(ownerFile()) || {}, readJson(wipFile()) || {})
    if (!stale) throw problem(409, `the farm WIP marker is ${line} — nothing was written; try again when it is released`, { holder: line })
    // Presumed gone: clear it as `wiki-wip steal` would, then race for it
    // like anyone else.
    took = line
    fs.rmSync(lockDir(), { recursive: true, force: true })
    try {
      fs.mkdirSync(lockDir())
    } catch (e2) {
      if (e2.code !== 'EEXIST') throw e2
      const now = holderLine()
      throw problem(409, `the farm WIP marker is ${now} — nothing was written; try again when it is released`, { holder: now })
    }
  }

  // Transition guard: a legacy claim (IN_PROGRESS, no token) is honoured.
  const legacy = readJson(wipFile()) || {}
  if (legacy.status === 'IN_PROGRESS' && !('token' in legacy) && !took) {
    fs.rmdirSync(lockDir())
    const line = `held by ${legacy.session || '?'} since ${legacy.since || '?'} (legacy claim, written without the lock)`
    throw problem(409, `the farm WIP marker is ${line} — nothing was written`, { holder: line })
  }

  const token = crypto.randomBytes(16).toString('hex') // uuid4().hex: 32 hex digits
  const now = utcnow()
  fs.writeFileSync(ownerFile(), JSON.stringify({ token, session, pid: process.pid, since: now, heartbeat: now }, null, 1))
  writeMarker({
    status: 'IN_PROGRESS',
    since: now,
    heartbeat: now,
    session,
    token,
    scope: scope ? [scope] : [],
    hold_off: holdOff,
    contact: CONTACT,
  })
  // The verify half of write-then-verify, as wiki-wip does it.
  const back = readJson(wipFile()) || {}
  if (back.token !== token) throw problem(500, 'the WIP claim was displaced immediately after writing it — investigate')
  return { token, session, claimed: now, took }
}

/** Release with the matching token: marker to DONE, lock removed. Answers the release time. */
export const release = token => {
  const owner = readJson(ownerFile())
  if (!owner) throw problem(500, 'no WIP lock held — nothing to release')
  if (owner.token !== token) throw problem(500, `wrong WIP token: ${holderLine()}; that claim was left untouched`)
  const now = utcnow()
  writeMarker({ status: 'DONE', since: now, session: owner.session || '?', scope: [], hold_off: '', contact: '' })
  fs.rmSync(lockDir(), { recursive: true, force: true })
  return now
}

/**
 * Refresh the claim's heartbeat, wiki-wip's heartbeat verb: the owner file
 * always, the marker when it still carries this token. A long run (Do Next
 * Phase, minutes on a model) calls it every minute so its claim never reads
 * as stale. Answers the heartbeat time; a claim no longer in force throws.
 */
export const heartbeat = token => {
  const owner = readJson(ownerFile())
  if (!owner) throw problem(500, 'no WIP lock held — nothing to heartbeat')
  if (owner.token !== token) throw problem(500, `wrong WIP token: ${holderLine()}; that claim was left untouched`)
  const now = utcnow()
  owner.heartbeat = now
  fs.writeFileSync(ownerFile(), JSON.stringify(owner, null, 1))
  const marker = readJson(wipFile()) || {}
  if (marker.token === token) writeMarker({ ...marker, heartbeat: now })
  return now
}
