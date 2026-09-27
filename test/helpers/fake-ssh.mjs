// Stands in for ssh in tests: `fake-ssh.mjs [-o opt]... <alias> <command>` runs the command's
// recall.mjs locally with the alias's fake home from FAKE_SSH_HOSTS ({ alias: { home, data } }).
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
while (args[0] === '-o') args.splice(0, 2);
const [alias, command] = args;
const host = JSON.parse(process.env.FAKE_SSH_HOSTS ?? '{}')[alias];
if (!host) {
  process.stderr.write(`ssh: Could not resolve hostname ${alias}: No such host is known.\n`);
  process.exit(255);
}
// The remote command is `<node> <recall.mjs> peer-request`, unquoted for plain paths.
const [, script, ...rest] = command.split(' ');
const env = { ...process.env, AGENT_RECALL_SOURCE_HOME: host.home, AGENT_RECALL_HOME: host.data, FAKE_SSH_HOSTS: '' };
const child = spawn(process.execPath, [script, ...rest], { stdio: 'inherit', env });
child.on('close', code => process.exit(code ?? 1));
