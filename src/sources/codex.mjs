import fs from 'node:fs/promises';
import path from 'node:path';

import { LIMITS, PATHS, PROVIDERS } from '../config.mjs';
import { asIso, messageKey, sessionKey, stableId } from '../model/ids.mjs';
import { emptyDiagnostics, readJsonlRecords, sourceSignature } from './source-adapter.mjs';

const CODEX_NOISE_TAGS = ['codex_internal_context', 'environment_context', 'turn_aborted', 'user_instructions'];

async function readDirectory(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function findJsonl(directory) {
  if (!directory) return [];
  const files = [];
  for (const entry of await readDirectory(directory)) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJsonl(child));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(child);
  }
  return files;
}

function stripInjectedText(value) {
  let text = typeof value === 'string' ? value : '';
  for (const tag of CODEX_NOISE_TAGS) {
    text = text.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return text.trim();
}

function responseText(content, role) {
  if (typeof content === 'string') return stripInjectedText(content);
  if (!Array.isArray(content)) return '';
  const allowedTypes = role === 'user' ? new Set(['input_text', 'text']) : new Set(['output_text', 'text']);
  const cap = LIMITS.TEXT_MAX_CHARS + 1;
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object' || !allowedTypes.has(block.type)) continue;
    const part = stripInjectedText(block.text).slice(0, cap - text.length);
    if (!part) continue;
    text += `${text ? '\n' : ''}${part}`;
    if (text.length >= cap) break;
  }
  return text;
}

function eventText(payload) {
  if (typeof payload?.message === 'string') return stripInjectedText(payload.message);
  if (Array.isArray(payload?.message)) {
    const cap = LIMITS.TEXT_MAX_CHARS + 1;
    let text = '';
    for (const value of payload.message) {
      const raw = typeof value === 'string' ? value : value?.text;
      const part = stripInjectedText(raw).slice(0, cap - text.length);
      if (!part) continue;
      text += `${text ? '\n' : ''}${part}`;
      if (text.length >= cap) break;
    }
    return text;
  }
  return '';
}

function truncate(text, diagnostics) {
  if (text.length <= LIMITS.TEXT_MAX_CHARS) return text;
  diagnostics.truncated += 1;
  return text.slice(0, LIMITS.TEXT_MAX_CHARS);
}

function minIso(current, candidate) {
  if (!candidate) return current;
  return !current || candidate < current ? candidate : current;
}

function maxIso(current, candidate) {
  if (!candidate) return current;
  return !current || candidate > current ? candidate : current;
}

function mirroredByResponse(candidate, responseCandidates) {
  return responseCandidates.some(response => {
    if (response.role !== candidate.role || response.text !== candidate.text) return false;
    if (!response.timestamp || !candidate.timestamp) return true;
    const delta = Math.abs(new Date(response.timestamp).getTime() - new Date(candidate.timestamp).getTime());
    return Number.isFinite(delta) && delta <= 10_000;
  });
}

function idFromFilename(file) {
  const stem = path.basename(file, '.jsonl');
  const uuid = stem.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return (uuid?.[0] ?? stem) || `generated:${stableId(file)}`;
}

function projectFromCwd(cwd) {
  if (!cwd) return null;
  const normalized = cwd.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).at(-1) || normalized;
}

function candidateNativeId(candidate, sourcePath) {
  return String(candidate.nativeId ?? `generated:${stableId(sourcePath, candidate.line, candidate.role)}`);
}

function makeMessage(candidate, nativeSessionId, sourcePath, sequence, diagnostics, keysByNativeId) {
  const nativeId = candidateNativeId(candidate, sourcePath);
  const parentNativeId = candidate.parentNativeId ?? null;
  const truncated = candidate.text.length > LIMITS.TEXT_MAX_CHARS;
  return {
    messageKey: messageKey(PROVIDERS.CODEX, nativeId, sourcePath, sequence),
    sessionKey: sessionKey(PROVIDERS.CODEX, nativeSessionId, sourcePath),
    nativeId,
    parentMessageKey: parentNativeId ? keysByNativeId.get(parentNativeId) ?? null : null,
    sequence,
    timestamp: candidate.timestamp,
    role: candidate.role,
    contentType: 'text',
    text: truncate(candidate.text, diagnostics),
    sourcePath,
    sourceLocator: `line:${candidate.line}`,
    model: candidate.model,
    metadata: {
      recordType: candidate.recordType,
      fallback: candidate.fallback,
      truncated,
    },
  };
}

export const codexAdapter = {
  provider: PROVIDERS.CODEX,

  async discover(options = {}) {
    const customSessionRoot = options.root ?? options.sessionsRoot ?? options.roots?.sessions;
    const sessionRoot = customSessionRoot ?? PATHS.CODEX_ROOT;
    const archiveRoot = options.archiveRoot !== undefined
      ? options.archiveRoot
      : options.roots?.archived !== undefined
        ? options.roots.archived
        : customSessionRoot
          ? null
          : PATHS.CODEX_ARCHIVE_ROOT;
    const sources = [
      ...(await findJsonl(sessionRoot)).map(file => ({ file, archived: false })),
      ...(await findJsonl(archiveRoot)).map(file => ({ file, archived: true })),
    ];
    const descriptors = new Map();

    for (const source of sources) {
      try {
        const stat = await fs.stat(source.file);
        descriptors.set(source.file, {
          provider: PROVIDERS.CODEX,
          path: source.file,
          signature: sourceSignature(stat, source.archived ? 'archived' : 'active'),
          metadata: { archived: source.archived },
        });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }

    return [...descriptors.values()].sort((left, right) => left.path.localeCompare(right.path));
  },

  async read(descriptor) {
    const sourcePath = descriptor.path;
    const diagnostics = emptyDiagnostics();
    const stat = await fs.stat(sourcePath);

    let sessionMeta = {};
    let cwd = null;
    let gitBranch = null;
    let model = null;
    let createdAt = null;
    let updatedAt = null;
    let sawResponseMessage = false;
    const responseCandidates = [];
    const eventCandidates = [];

    for await (const { record, line } of readJsonlRecords(sourcePath, diagnostics)) {
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
      const timestamp = asIso(record.timestamp ?? payload.timestamp);
      createdAt = minIso(createdAt, timestamp);
      updatedAt = maxIso(updatedAt, timestamp);

      if (record.type === 'session_meta') {
        sessionMeta = { ...sessionMeta, ...payload };
        cwd = payload.cwd ?? cwd;
        gitBranch = payload.git?.branch ?? payload.git_branch ?? gitBranch;
        model = payload.model ?? model;
        continue;
      }
      if (record.type === 'turn_context') {
        cwd = payload.cwd ?? cwd;
        model = payload.model ?? model;
        gitBranch = payload.git?.branch ?? payload.git_branch ?? gitBranch;
        continue;
      }

      if (record.type === 'response_item') {
        if (payload.type !== 'message' || !['user', 'assistant'].includes(payload.role)) {
          diagnostics.skipped += 1;
          continue;
        }
        const text = responseText(payload.content, payload.role);
        if (!text) {
          diagnostics.skipped += 1;
          continue;
        }
        sawResponseMessage = true;
        const candidateModel = payload.model ?? model;
        responseCandidates.push({
          line,
          role: payload.role,
          text,
          timestamp,
          model: candidateModel,
          nativeId: payload.id ?? record.id ?? null,
          parentNativeId: payload.parent_id ?? record.parent_id ?? null,
          recordType: record.type,
          fallback: false,
        });
        if (candidateModel) model = candidateModel;
        continue;
      }

      if (record.type === 'event_msg' && ['user_message', 'agent_message'].includes(payload.type)) {
        const text = eventText(payload);
        if (!text) continue;
        eventCandidates.push({
          line,
          role: payload.type === 'user_message' ? 'user' : 'assistant',
          text,
          timestamp,
          model: payload.model ?? model,
          nativeId: payload.id ?? record.id ?? null,
          parentNativeId: payload.parent_id ?? record.parent_id ?? null,
          recordType: record.type,
          fallback: true,
        });
      }
    }

    const nativeId = sessionMeta.id ?? sessionMeta.session_id ?? idFromFilename(sourcePath);
    let selectedCandidates;
    if (sawResponseMessage) {
      selectedCandidates = [
        ...responseCandidates,
        ...eventCandidates.filter(candidate => !mirroredByResponse(candidate, responseCandidates)),
      ].sort((left, right) => left.line - right.line);
    } else {
      selectedCandidates = eventCandidates;
    }
    const keysByNativeId = new Map();
    selectedCandidates.forEach((candidate, sequence) => {
      const id = candidateNativeId(candidate, sourcePath);
      if (!keysByNativeId.has(id)) keysByNativeId.set(id, messageKey(PROVIDERS.CODEX, id, sourcePath, sequence));
    });
    const messages = selectedCandidates.map((candidate, sequence) => (
      makeMessage(candidate, nativeId, sourcePath, sequence, diagnostics, keysByNativeId)
    ));
    const archived = descriptor.metadata?.archived === true;
    cwd = cwd ?? sessionMeta.cwd ?? null;
    model = model ?? sessionMeta.model ?? null;
    gitBranch = gitBranch ?? sessionMeta.git?.branch ?? sessionMeta.git_branch ?? null;

    const session = {
      sessionKey: sessionKey(PROVIDERS.CODEX, nativeId, sourcePath),
      provider: PROVIDERS.CODEX,
      nativeId,
      sourcePath,
      parentSessionKey: null,
      title: sessionMeta.title ?? selectedCandidates.find(candidate => candidate.role === 'user')?.text.slice(0, LIMITS.TITLE_MAX_CHARS) ?? null,
      summary: sessionMeta.summary ?? null,
      project: sessionMeta.project ?? projectFromCwd(cwd),
      cwd,
      gitBranch,
      model,
      createdAt,
      updatedAt,
      sourceUpdatedAt: asIso(stat.mtimeMs),
      archived,
      resume: {
        command: 'codex',
        args: ['resume', nativeId],
        cwd,
      },
      metadata: {
        archived,
        originator: sessionMeta.originator ?? null,
        cliVersion: sessionMeta.cli_version ?? null,
        modelProvider: sessionMeta.model_provider ?? null,
        source: sessionMeta.source ?? null,
      },
    };

    return { sessions: [session], messages, diagnostics };
  },
};
