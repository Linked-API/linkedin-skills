#!/usr/bin/env node
import { parseArgs, requireFlag, intFlag } from './lib/args.mjs';
import { withDb } from './lib/db.mjs';
import { ok, fail, info } from './lib/output.mjs';
import { runLinkedin } from './lib/cli.mjs';
import { getAccountOrFail, sleep, isFatalExitCode, trimBasicInfoForStorage } from './lib/account.mjs';
import { recordRunStart, recordRunFinish } from './lib/runs.mjs';
import { defaults } from './lib/config.mjs';
import { startOfLocalDayUtc } from './lib/time.mjs';

const { flags } = parseArgs();

try {
  await main();
} catch (err) {
  fail(err.message);
}

async function main() {
  const accountName = requireFlag(flags, 'account');
  const delay = intFlag(flags, 'delay-seconds', defaults().invite_delay_seconds);
  const userLimit = intFlag(flags, 'limit', undefined);

  const account = withDb((db) => getAccountOrFail(db, accountName), { readonly: true });
  if (account.paused) {
    ok({ skipped: 'paused', account: account.name });
    return;
  }

  const dayStartUtc = startOfLocalDayUtc();
  const sentToday = withDb(
    (db) =>
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM runs
           WHERE account = ? AND action = 'invite' AND success = 1
             AND started_at >= ?`,
        )
        .get(account.name, dayStartUtc).c,
    { readonly: true },
  );
  const remainingByPolicy = Math.max(0, account.daily_invite_limit - sentToday);
  const budget = userLimit !== undefined ? Math.min(userLimit, remainingByPolicy) : remainingByPolicy;
  if (budget === 0) {
    ok({
      account: account.name,
      sent_today: sentToday,
      daily_limit: account.daily_invite_limit,
      processed: 0,
      message: 'daily invite limit reached',
    });
    return;
  }

  const leads = withDb(
    (db) =>
      db
        .prepare(
          `SELECT hashed_url, public_url, full_name
           FROM leads
           WHERE owner_account = ? AND status = 'not_connected'
           ORDER BY created_at ASC
           LIMIT ?`,
        )
        .all(account.name, budget),
    { readonly: true },
  );

  if (leads.length === 0) {
    ok({ account: account.name, processed: 0, message: 'no not_connected leads' });
    return;
  }

  const summary = { processed: 0, pending: 0, connected: 0, errors: 0, aborted: false };
  for (const lead of leads) {
    const personUrl = lead.public_url || lead.hashed_url;
    const def = {
      actionType: 'st.openPersonPage',
      personUrl,
      basicInfo: true,
      then: { actionType: 'st.sendConnectionRequest' },
    };

    let runId;
    withDb((db) => {
      runId = recordRunStart(db, {
        leadHashedUrl: lead.hashed_url,
        account: account.name,
        action: 'invite',
      });
    });

    info(`[invite] ${lead.full_name} <${personUrl}>`);
    const cli = await runLinkedin(['workflow', 'run'], {
      cliAccount: account.cli_account,
      input: JSON.stringify(def),
    });

    if (isFatalExitCode(cli.exitCode)) {
      withDb((db) =>
        recordRunFinish(db, runId, {
          success: false,
          rawResponse: cli.json,
          errorMessage: `fatal exit ${cli.exitCode}: ${cli.stderr || cli.error || ''}`.trim(),
        }),
      );
      summary.aborted = true;
      summary.abort_reason = `linkedin-cli exit ${cli.exitCode}`;
      break;
    }

    const outcome = classifyInviteResult(cli);
    withDb((db) => {
      recordRunFinish(db, runId, {
        success: outcome.status !== 'error',
        rawResponse: cli.json,
        errorMessage: outcome.errorMessage ?? null,
      });
      applyInviteOutcome(db, lead, outcome, cli.json);
    });

    summary.processed++;
    if (outcome.status === 'pending') summary.pending++;
    else if (outcome.status === 'connected') summary.connected++;
    else summary.errors++;

    if (summary.processed < leads.length) {
      await sleep(delay * 1000);
    }
  }

  withDb((db) =>
    db.prepare("UPDATE accounts SET last_action_at = datetime('now') WHERE name = ?").run(account.name),
  );

  ok({
    account: account.name,
    daily_limit: account.daily_invite_limit,
    sent_today_before: sentToday,
    budget,
    ...summary,
  });
}

function classifyInviteResult(cli) {
  const body = cli.json ?? {};
  if (body.success === false) {
    return {
      status: 'error',
      errorType: body.error?.type ?? 'cliError',
      errorMessage: body.error?.message ?? `exit ${cli.exitCode}`,
    };
  }
  // completion = the st.openPersonPage result. The docs place the chained action
  // result at completion.then (sibling of data); the production n8n webhook places
  // it at completion.data.then (nested). Accept either so we don't depend on which
  // transport shape the API returns.
  const completion = body.data ?? {};
  const then = completion.then ?? completion.data?.then ?? {};
  if (then.success === true) return { status: 'pending' };
  const thenErrType = then.error?.type ?? '';
  if (thenErrType.toLowerCase().includes('alreadypending')) return { status: 'pending' };
  if (thenErrType.toLowerCase().includes('alreadyconnected')) return { status: 'connected' };
  return {
    status: 'error',
    errorType: thenErrType || 'unknown',
    errorMessage: then.error?.message ?? 'connection request failed',
  };
}

function applyInviteOutcome(db, lead, outcome, payload) {
  // payload = cli.json = { success, data: <openPersonPage completion> }
  // The completion is { actionType, success, data: { ...personInfo, publicUrl }, then }.
  const completion = payload?.data ?? {};
  const personData = completion?.data ?? {};
  const basicInfo = trimBasicInfoForStorage(completion);
  const publicUrl = personData?.publicUrl ?? lead.public_url ?? null;

  if (outcome.status === 'pending') {
    db.prepare(
      `UPDATE leads SET status='pending', sent_at = datetime('now'),
         status_updated_at = datetime('now'), public_url = COALESCE(?, public_url),
         basic_info_json = ?, error_type = NULL, error_message = NULL
       WHERE hashed_url = ?`,
    ).run(publicUrl, basicInfo, lead.hashed_url);
  } else if (outcome.status === 'connected') {
    db.prepare(
      `UPDATE leads SET status='connected', sent_at = datetime('now'),
         status_updated_at = datetime('now'), public_url = COALESCE(?, public_url),
         basic_info_json = ?, error_type = NULL, error_message = NULL
       WHERE hashed_url = ?`,
    ).run(publicUrl, basicInfo, lead.hashed_url);
  } else {
    db.prepare(
      `UPDATE leads SET status='error', status_updated_at = datetime('now'),
         error_type = ?, error_message = ?, basic_info_json = COALESCE(?, basic_info_json)
       WHERE hashed_url = ?`,
    ).run(outcome.errorType ?? 'unknown', outcome.errorMessage ?? null, basicInfo, lead.hashed_url);
  }
}
