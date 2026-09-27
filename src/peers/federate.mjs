import { callPeer, thisComputerName } from './peers.mjs';

// Every computer answers in parallel; a computer that fails is reported, never fatal.
async function gather(local, peers, argv) {
  const remote = await Promise.all(peers.map(peer => callPeer(peer, argv)
    .then(result => ({ peer, result }))
    .catch(error => ({ peer, error }))));
  return [{ name: thisComputerName(), local: true, result: local }, ...remote.map(({ peer, result, error }) => ({ name: peer.name, local: false, result, error }))];
}

function status(answers, count) {
  return answers.map(({ name, local, result, error }) => (error
    ? { name, local, ok: false, complete: false, count: 0, error: error.message }
    : { name, local, ok: true, complete: result.completeness?.complete !== false && !(result.warnings ?? []).length, count: count(result) }));
}

function warnings(answers) {
  return answers.flatMap(({ name, local, result }) => (result?.warnings ?? []).map(warning => (local ? warning : `${name}: ${warning}`)));
}

const tag = (item, name, local) => (local ? item : { ...item, peer: name });

/**
 * Search here and on `peers`. Hits keep their own computer's handle and are tagged with
 * `peer` when remote; they are ordered by score, each computer contributing up to its limit.
 */
export async function searchAcross(local, peers, argv) {
  const answers = await gather(local, peers, argv);
  const hits = answers.flatMap(({ name, local: isLocal, result }) => (result?.hits ?? []).map(hit => tag(hit, name, isLocal)));
  hits.sort((a, b) => b.score - a.score);
  const computers = status(answers, result => result.hits?.length ?? 0);
  return {
    ...local,
    hits,
    computers,
    warnings: warnings(answers),
    completeness: { complete: computers.every(computer => computer.complete), pending: local.index?.pending ?? 0 },
  };
}

/** Latest conversations across computers, newest first, `limit` in total. */
export async function recentAcross(local, peers, argv, limit) {
  const answers = await gather(local, peers, argv);
  const sessions = answers.flatMap(({ name, local: isLocal, result }) => (result?.sessions ?? []).map(session => tag(session, name, isLocal)));
  sessions.sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
  return { ...local, sessions: sessions.slice(0, limit), computers: status(answers, result => result.sessions?.length ?? 0), warnings: warnings(answers) };
}

/** Runs a read or show on one peer; the result names that computer so follow-ups go there. */
export async function onPeer(peer, argv) {
  const result = await callPeer(peer, argv);
  const mark = session => (session ? { ...session, peer: peer.name } : session);
  return {
    ...result,
    peer: peer.name,
    session: mark(result.session),
    root: mark(result.root),
    subagents: result.subagents?.map(mark),
    continuesIn: mark(result.continuesIn),
  };
}

/** Each peer's doctor report, or why it could not be reached. */
export async function doctorAcross(peers) {
  return Promise.all(peers.map(peer => callPeer(peer, ['doctor'])
    .then(result => ({ name: peer.name, ok: true, version: result.version, node: result.node, providers: result.providers, warnings: result.warnings ?? [] }))
    .catch(error => ({ name: peer.name, ok: false, error: error.message }))));
}
