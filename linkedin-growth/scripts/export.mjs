#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { parseArgs } from './lib/args.mjs';
import { openDb } from './lib/db.mjs';
import { ok, fail } from './lib/output.mjs';

const { flags } = parseArgs();

try {
  const format = String(flags.format ?? 'json').toLowerCase();
  if (!['json', 'csv'].includes(format)) throw new Error('--format must be json or csv');
  const out = flags.output ? String(flags.output) : null;

  const db = openDb({ readonly: true });
  const vals = [];
  let sql = 'SELECT * FROM leads';
  if (flags.account && flags.status) {
    sql += ' WHERE owner_account = ? AND status = ?';
    vals.push(String(flags.account), String(flags.status));
  } else if (flags.account) {
    sql += ' WHERE owner_account = ?';
    vals.push(String(flags.account));
  } else if (flags.status) {
    sql += ' WHERE status = ?';
    vals.push(String(flags.status));
  }
  sql += ' ORDER BY created_at';
  const rows = db.prepare(sql).all(...vals);
  db.close();

  let payload;
  if (format === 'json') {
    payload = JSON.stringify(rows, null, 2);
  } else {
    payload = toCsv(rows);
  }

  if (out) {
    writeFileSync(out, payload);
    ok({ output: out, rows: rows.length, format });
  } else {
    process.stdout.write(payload);
    if (!payload.endsWith('\n')) process.stdout.write('\n');
  }
} catch (err) {
  fail(err.message);
}

function toCsv(rows) {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => escape(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}
