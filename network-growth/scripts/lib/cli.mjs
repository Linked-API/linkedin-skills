import { spawn } from 'node:child_process';

export function runLinkedin(args, { cliAccount, input, timeoutMs = 600000 } = {}) {
  // oclif requires the command/topic tokens first, then flags:
  // `linkedin <command> --json -q --account "<name>"`. Flags before the command
  // make oclif treat the first flag as the command name (exit 2).
  const finalArgs = [...args, '--json', '-q'];
  if (cliAccount) finalArgs.push('--account', cliAccount);
  return runCommand('linkedin', finalArgs, { input, timeoutMs });
}

export function runCommand(command, args, { input, timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, exitCode: -1, stdout, stderr, error: err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        exitCode: code ?? -1,
        stdout,
        stderr,
        killed,
        json: tryParse(stdout),
      });
    });

    if (input !== undefined) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

// `linkedin account list` ignores --json and prints a human table:
//   * Jane Doe (id_abc...123)
//     John Smith (id_def...456)
// The leading `*` marks the active account. Returns the account display names.
export function parseCliAccounts(stdout) {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^no accounts/i.test(l))
    .map((l) => {
      const withoutMarker = l.replace(/^\*\s*/, '');
      const m = withoutMarker.match(/^(.*?)\s*\([^()]*\)\s*$/);
      return m ? m[1].trim() : null;
    })
    .filter(Boolean);
}

function tryParse(s) {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}
