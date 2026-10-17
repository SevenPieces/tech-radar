// tests/lib/commands.mjs
// External commands decide what this suite can reach: the transport cases run curl, the
// mid-write failure case runs a shell, and the publication guards ask git. A command the machine
// does not carry cannot be exercised at all, so a case that needs one asks here first and skips
// with a named reason -- a named skip says which behaviour was not reached, where a failure would
// claim that the behaviour broke.
import { spawnSync } from 'node:child_process';

// Whether the command resolves and starts. Only the spawn is judged: a shim that exits nonzero is
// still a command a child can run, and what it then says is the case's own subject. An entry that
// cannot be started at all -- no binary under any PATH entry, or one this process may not execute
// -- reports an error from spawnSync, and that is the only answer read here.
export function commandStarts(name, args) {
  const res = spawnSync(name, args, { stdio: 'ignore' });
  return !res.error;
}

export function curlAvailable() {
  return commandStarts('curl', ['--version']);
}

export function shellAvailable() {
  return commandStarts('sh', ['-c', 'exit 0']);
}
