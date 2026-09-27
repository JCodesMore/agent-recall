import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { PEERS } from '../shared/config.mjs';
import { peersPath } from '../shared/paths.mjs';
import { escapeNonAscii } from '../shared/text.mjs';

export class PeerError extends Error {
  constructor(message, code = 'peer', { hint = null, candidates = null } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.candidates = candidates;
  }
}

// Words any shell passes through unchanged; anything else needs the peer's `shell` set.
const PLAIN_WORD = /^[\w@%+=:,./\\~-]+$/;
const QUOTE = {
  posix: words => words.map(word => `'${word.replaceAll("'", "'\\''")}'`).join(' '),
  powershell: words => `& ${words.map(word => `'${word.replaceAll("'", "''")}'`).join(' ')}`,
};

function normalize(entry, index) {
  const where = `peers.json entry ${index + 1}`;
  if (!entry || typeof entry.name !== 'string' || !/^[\w.-]+$/.test(entry.name)) throw new PeerError(`${where} needs a "name" (letters, digits, . _ -).`, 'config');
  if (typeof entry.recall !== 'string' || !entry.recall) throw new PeerError(`${where} (${entry.name}) needs "recall": the path to scripts/recall.mjs on that computer.`, 'config');
  if (entry.shell !== undefined && !QUOTE[entry.shell]) throw new PeerError(`${where} (${entry.name}) has an unknown "shell"; use posix or powershell.`, 'config');
  if (entry.hostnames !== undefined && !Array.isArray(entry.hostnames)) throw new PeerError(`${where} (${entry.name}): "hostnames" must be a list.`, 'config');
  for (const key of ['ssh', 'node']) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') throw new PeerError(`${where} (${entry.name}): "${key}" must be text.`, 'config');
  }
  return {
    name: entry.name.toLowerCase(),
    ssh: entry.ssh ?? entry.name,
    node: entry.node ?? 'node',
    recall: entry.recall,
    shell: entry.shell ?? null,
    hostnames: (entry.hostnames ?? []).map(value => String(value).toLowerCase()),
  };
}

/** Peers from peers.json; [] when the file does not exist. */
export function loadPeers(file = peersPath()) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PeerError(`${file} is not valid JSON: ${error.message}`, 'config');
  }
  if (!parsed || (parsed.peers !== undefined && !Array.isArray(parsed.peers))) throw new PeerError(`${file} needs {"peers": [...]}.`, 'config');
  return (parsed.peers ?? []).map(normalize);
}

// The same peers.json can list every computer; the entry for this one is skipped.
function isThisComputer(peer) {
  const host = os.hostname().toLowerCase();
  const short = host.split('.')[0];
  return [peer.name, ...peer.hostnames].some(name => name === host || name === short);
}

export function thisComputerName(peers = loadPeers()) {
  return peers.find(isThisComputer)?.name ?? os.hostname().toLowerCase().split('.')[0];
}

/** Resolves `all` or a list of names to peers, excluding this computer. */
export function selectPeers(names, peers = loadPeers()) {
  const others = peers.filter(peer => !isThisComputer(peer));
  if (!peers.length) throw new PeerError(`No other computers are set up. Add them to ${peersPath()} (see references/peers.md).`, 'usage');
  if (names.some(name => name.toLowerCase() === 'all')) return others;
  return names.map(name => {
    const peer = peers.find(candidate => candidate.name === name.toLowerCase() || candidate.ssh === name);
    if (!peer) throw new PeerError(`Unknown computer "${name}". Set up: ${peers.map(candidate => candidate.name).join(', ')}.`, 'usage');
    return peer;
  }).filter(peer => !isThisComputer(peer));
}

function remoteCommand(peer) {
  const words = [peer.node, peer.recall, 'peer-request'];
  if (peer.shell) return QUOTE[peer.shell](words);
  const odd = words.find(word => !PLAIN_WORD.test(word));
  if (odd) throw new PeerError(`"${odd}" for ${peer.name} needs quoting; set "shell" (posix or powershell) in peers.json.`, 'config');
  return words.join(' ');
}

function sshProgram() {
  const override = process.env[PEERS.SSH_ENV];
  return override ? JSON.parse(override) : ['ssh'];
}

/**
 * Runs one Agent Recall command on a peer and returns its JSON result. Only fixed words from
 * peers.json reach the remote shell; the command and its arguments travel as JSON on stdin.
 */
export function callPeer(peer, argv) {
  const [program, ...prefix] = sshProgram();
  const args = [...prefix, '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${PEERS.CONNECT_TIMEOUT_S}`,
    '-o', `ServerAliveInterval=${PEERS.ALIVE_INTERVAL_S}`, '-o', `ServerAliveCountMax=${PEERS.ALIVE_COUNT}`, peer.ssh, remoteCommand(peer)];
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, timeout: PEERS.TIMEOUT_MS });
    const out = [];
    const err = [];
    let bytes = 0;
    let overflow = false;
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes <= PEERS.MAX_OUTPUT_BYTES) return void out.push(chunk);
      overflow = true;
      child.kill();
    });
    child.stderr.on('data', chunk => err.push(chunk));
    child.on('error', error => reject(new PeerError(`${peer.name}: could not run ssh (${error.message}).`)));
    child.on('close', (code, signal) => {
      const stdout = Buffer.concat(out).toString('utf8').trim();
      const stderr = Buffer.concat(err).toString('utf8').trim();
      const reply = parseReply(stdout);
      if (reply?.error) {
        const candidates = reply.error.candidates?.map(candidate => ({ ...candidate, peer: peer.name })) ?? null;
        return reject(new PeerError(`${peer.name}: ${reply.error.message}`, reply.error.code, { hint: reply.error.hint, candidates }));
      }
      if (reply && code === 0 && !overflow) return resolve(reply);
      const reason = overflow ? `answer larger than ${PEERS.MAX_OUTPUT_BYTES} bytes`
        : signal ? `stopped after ${PEERS.TIMEOUT_MS / 1000}s` : lastLine(stderr) || lastLine(stdout) || `exit code ${code}`;
      const hint = /peer-request|Unknown command/i.test(stderr + stdout) ? ' (update Agent Recall there)' : '';
      reject(new PeerError(`${peer.name}: ${reason}${hint}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(escapeNonAscii(JSON.stringify({ argv })));
  });
}

function parseReply(stdout) {
  try {
    return JSON.parse(lastLine(stdout));
  } catch {
    return null;
  }
}

function lastLine(text) {
  return text.split(/\r?\n/).filter(Boolean).at(-1) ?? '';
}
