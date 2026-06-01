#!/usr/bin/env node
//
// The scheduler heartbeat. A single OS task runs this every few minutes. Each run
// does a SMALL, resumable unit of work and exits — it never runs a long batch.
//
// Invites and pending checks are DECOUPLED — they are different kinds of work and
// run on their own cadence. Within an account's active window, per tick:
//
//   INVITES (write, rate-sensitive): send ONE invite if under the daily quota AND
//     at least `min_invite_interval_minutes` have passed since the last invite.
//     This is the user-facing "no more than one connect every N minutes" control.
//
//   PENDING (mostly reads): process up to `pending_batch_size` due pending checks,
//     INDEPENDENTLY of the invite decision. These are cheap, so they are not gated
//     by the invite interval — a backlog drains quickly instead of one-per-tick.
//
// Both may happen in the same tick. Each individual operation is persisted to the DB
// the moment it completes. If the machine sleeps or a run is killed mid-op, the next
// tick simply continues from the current DB state — there is no batch to resume and
// nothing to roll back. Quotas are recomputed from the runs table each tick (bounded
// to the local calendar day), so they stay correct across interruptions.
//
import {
  existsSync, writeFileSync, readFileSync, unlinkSync, openSync, closeSync,
  appendFileSync, readdirSync, statSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { withDb } from './lib/db.mjs';
import { ok, fail, info } from './lib/output.mjs';
import { dataDir, ensureDir, logsDir, SKILL_ROOT } from './lib/paths.mjs';
import { defaults } from './lib/config.mjs';
import {
  startOfLocalDayUtc, localHHMM, parseDbUtc, minutesSince,
} from './lib/time.mjs';

const LOCK_FILE = join(dataDir(), 'tick.lock');
const STALE_LOCK_MS = 15 * 60 * 1000;

try {
  ensureDir(dataDir());
  if (!acquireLock()) {
    ok({ skipped: 'another tick is running', lock: LOCK_FILE });
    process.exit(0);
  }
  try {
    const result = tick();
    pruneLogs();
    ok(result);
  } finally {
    releaseLock();
  }
} catch (err) {
  releaseLock();
  fail(err.message);
}

function tick() {
  const now = new Date();
  const nowHHMM = localHHMM(now);
  const dayStartUtc = startOfLocalDayUtc(now);

  const accounts = withDb(
    (db) => db.prepare('SELECT * FROM accounts WHERE paused = 0 ORDER BY name').all(),
    { readonly: true },
  );

  const actions = [];
  for (const acc of accounts) {
    actions.push(processAccount(acc, now, nowHHMM, dayStartUtc));
  }

  return { now: now.toISOString(), local_time: nowHHMM, actions };
}

// Runs this tick's work for one account: possibly one invite AND a batch of pending
// checks, each gated independently. Returns a report of what was done / why not.
function processAccount(acc, now, nowHHMM, dayStartUtc) {
  if (nowHHMM < acc.active_start || nowHHMM > acc.active_end) {
    return { account: acc.name, did: [], reason: 'outside_active_window' };
  }

  const stats = withDb(
    (db) => ({
      sentToday: db
        .prepare(
          `SELECT COUNT(*) AS c FROM runs
           WHERE account = ? AND action = 'invite' AND success = 1 AND started_at >= ?`,
        )
        .get(acc.name, dayStartUtc).c,
      lastInviteAttempt: db
        .prepare(
          `SELECT MAX(started_at) AS t FROM runs
           WHERE account = ? AND action = 'invite' AND started_at >= ?`,
        )
        .get(acc.name, dayStartUtc).t,
      notConnected: db
        .prepare(`SELECT COUNT(*) AS c FROM leads WHERE owner_account = ? AND status = 'not_connected'`)
        .get(acc.name).c,
      duePending: db
        .prepare(
          `SELECT COUNT(*) AS c FROM leads
           WHERE owner_account = ? AND status = 'pending' AND sent_at IS NOT NULL
             AND sent_at < datetime('now', ?)`,
        )
        .get(acc.name, `-${acc.max_pending_days} days`).c,
    }),
    { readonly: true },
  );

  const did = [];
  const skipped = {};

  // --- Invites: quota + explicit interval gate. At most one per tick. ---
  if (stats.notConnected === 0) {
    skipped.invite = 'no_not_connected_leads';
  } else if (stats.sentToday >= acc.daily_invite_limit) {
    skipped.invite = 'daily_quota_reached';
  } else {
    const elapsed = minutesSince(parseDbUtc(stats.lastInviteAttempt), now);
    if (elapsed >= acc.min_invite_interval_minutes) {
      runChild('network-invite.mjs', acc.name, ['--limit', '1']);
      did.push({
        op: 'invite',
        sent_today_before: stats.sentToday,
        daily_limit: acc.daily_invite_limit,
        interval_min: acc.min_invite_interval_minutes,
      });
    } else {
      skipped.invite = `paced_waiting (${Math.round(acc.min_invite_interval_minutes - elapsed)}min left)`;
    }
  }

  // --- Pending: independent batch of cheap status checks. ---
  if (stats.duePending > 0) {
    const batch = Math.min(acc.pending_batch_size, stats.duePending);
    runChild('network-pending.mjs', acc.name, ['--limit', String(batch)]);
    did.push({ op: 'pending', due: stats.duePending, batch });
  } else {
    skipped.pending = 'no_due_pending';
  }

  return { account: acc.name, did, ...(Object.keys(skipped).length ? { skipped } : {}) };
}

function runChild(script, account, extraArgs) {
  const logFile = join(
    ensureDir(logsDir()),
    `${account}-${new Date().toISOString().slice(0, 10)}.log`,
  );
  appendFileSync(logFile, `\n=== ${new Date().toISOString()} ${account} ${script} ===\n`);
  const r = spawnSync(
    process.execPath,
    [join(SKILL_ROOT, 'scripts', script), '--account', account, '--json', ...extraArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (r.stdout) appendFileSync(logFile, r.stdout);
  if (r.stderr) appendFileSync(logFile, r.stderr);
  appendFileSync(logFile, `\n--- exit ${r.status} ---\n`);
  return r.status;
}

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    try {
      const stat = statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs < STALE_LOCK_MS) return false;
      info(`Stale lock (>${STALE_LOCK_MS / 60000}min), overriding.`);
      unlinkSync(LOCK_FILE);
    } catch {
      /* ignore */
    }
  }
  try {
    const fd = openSync(LOCK_FILE, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    if (!existsSync(LOCK_FILE)) return;
    if (Number(readFileSync(LOCK_FILE, 'utf8')) === process.pid) unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

function pruneLogs() {
  const dir = logsDir();
  if (!existsSync(dir)) return;
  const cutoff = Date.now() - defaults().log_retention_days * 86400 * 1000;
  for (const f of readdirSync(dir)) {
    const path = join(dir, f);
    try {
      if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}
