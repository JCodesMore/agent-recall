import fs from 'node:fs/promises';
import path from 'node:path';

import { LIMITS, PATHS, PROVIDERS } from '../config.mjs';
import { attachmentKey, decodeDataUrl, parseDataUrl } from '../model/attachments.mjs';
import { asIso, messageKey, sessionKey, stableId } from '../model/ids.mjs';
import { emptyDiagnostics, readJsonlRecordAt, readJsonlRecords, sourceSignature } from './source-adapter.mjs';

const INJECTED_BLOCKS = [
  'system-reminder',
  'local-command-caveat',
  'local-command-stdout',
  'command-name',
  'command-message',
  'command-args',
];

async function readDirectory(directory) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function descriptorFor(file, metadata) {
  try {
    const stat = await fs.stat(file);
    return {
      provider: PROVIDERS.CLAUDE,
      path: file,
      signature: sourceSignature(stat),
      metadata,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function stripInjectedText(value) {
  let text = typeof value === 'string' ? value : '';
  for (const tag of INJECTED_BLOCKS) {
    text = text.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return text.trim();
}

function contentText(content) {
  if (typeof content === 'string') return stripInjectedText(content);
  if (!Array.isArray(content)) return '';
  const cap = LIMITS.TEXT_MAX_CHARS + 1;
  let text = '';
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'text') continue;
    const part = stripInjectedText(block.text).slice(0, cap - text.length);
    if (!part) continue;
    text += `${text ? '\n' : ''}${part}`;
    if (text.length >= cap) break;
  }
  return text;
}

function contentImages(content) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block, blockIndex) => {
    if (block?.type !== 'image' || block.source?.type !== 'base64') return [];
    const mime = String(block.source.media_type || 'application/octet-stream').toLowerCase();
    const parsed = parseDataUrl(`data:${mime};base64,${block.source.data || ''}`);
    if (!parsed) return [];
    return [{ blockIndex, mime: parsed.mime, byteLength: parsed.byteLength, sha256: parsed.sha256 }];
  });
}

function truncate(text, diagnostics) {
  if (text.length <= LIMITS.TEXT_MAX_CHARS) return text;
  diagnostics.truncated += 1;
  return text.slice(0, LIMITS.TEXT_MAX_CHARS);
}

function isSubagentPath(file) {
  return path.basename(path.dirname(file)).toLowerCase() === 'subagents';
}

function minIso(current, candidate) {
  if (!candidate) return current;
  return !current || candidate < current ? candidate : current;
}

function maxIso(current, candidate) {
  if (!candidate) return current;
  return !current || candidate > current ? candidate : current;
}

export const claudeAdapter = {
  provider: PROVIDERS.CLAUDE,

  async discover(options = {}) {
    const root = options.root ?? options.claudeRoot ?? PATHS.CLAUDE_ROOT;
    const descriptors = [];

    for (const projectEntry of await readDirectory(root)) {
      if (!projectEntry.isDirectory()) continue;
      const projectDirectory = path.join(root, projectEntry.name);

      for (const entry of await readDirectory(projectDirectory)) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          const descriptor = await descriptorFor(path.join(projectDirectory, entry.name), {
            project: projectEntry.name,
            isSubagent: false,
            archived: false,
          });
          if (descriptor) descriptors.push(descriptor);
          continue;
        }

        if (!entry.isDirectory()) continue;
        const subagentDirectory = path.join(projectDirectory, entry.name, 'subagents');
        for (const subagentEntry of await readDirectory(subagentDirectory)) {
          if (!subagentEntry.isFile() || !/^agent-.*\.jsonl$/i.test(subagentEntry.name)) continue;
          const descriptor = await descriptorFor(path.join(subagentDirectory, subagentEntry.name), {
            project: projectEntry.name,
            isSubagent: true,
            parentNativeId: entry.name,
            agentId: path.basename(subagentEntry.name, '.jsonl'),
            archived: false,
          });
          if (descriptor) descriptors.push(descriptor);
        }
      }
    }

    return descriptors.sort((left, right) => left.path.localeCompare(right.path));
  },

  async read(descriptor) {
    const sourcePath = descriptor.path;
    const diagnostics = emptyDiagnostics();
    const stat = await fs.stat(sourcePath);

    const subagent = descriptor.metadata?.isSubagent ?? isSubagentPath(sourcePath);
    const fileStem = path.basename(sourcePath, '.jsonl');
    const inferredParentId = subagent
      ? path.basename(path.dirname(path.dirname(sourcePath)))
      : null;
    const parentNativeId = subagent
      ? descriptor.metadata?.parentNativeId ?? inferredParentId
      : null;
    const agentId = subagent
      ? descriptor.metadata?.agentId ?? fileStem
      : null;
    const nativeId = subagent
      ? parentNativeId
        ? `${parentNativeId}:subagent:${agentId}`
        : `subagent:${agentId}:${stableId(sourcePath)}`
      : fileStem || `generated:${stableId(sourcePath)}`;
    const ownSessionKey = sessionKey(PROVIDERS.CLAUDE, nativeId, sourcePath);

    let title = null;
    let summary = null;
    let cwd = null;
    let gitBranch = null;
    let model = null;
    let createdAt = null;
    let updatedAt = null;
    const versions = new Set();
    const messages = [];
    const attachments = [];

    const nativeMessageKeys = new Map();
    for await (const { record, line } of readJsonlRecords(sourcePath, diagnostics)) {
      const timestamp = asIso(record.timestamp ?? record.message?.timestamp);
      createdAt = minIso(createdAt, timestamp);
      updatedAt = maxIso(updatedAt, timestamp);
      const recordTitle = record.title ?? record.aiTitle ?? record.customTitle;
      if (typeof recordTitle === 'string' && recordTitle.trim()) title = recordTitle.trim();
      if (typeof record.summary === 'string' && record.summary.trim()) summary = record.summary.trim();
      if (typeof record.cwd === 'string' && record.cwd) cwd = record.cwd;
      if (typeof record.gitBranch === 'string' && record.gitBranch) gitBranch = record.gitBranch;
      if (typeof record.version === 'string' && record.version) versions.add(record.version);

      const role = record.message?.role ?? record.type;
      if (record.type !== 'user' && record.type !== 'assistant') {
        if (!['ai-title', 'custom-title', 'summary'].includes(record.type)) diagnostics.skipped += 1;
        continue;
      }
      if ((role !== 'user' && role !== 'assistant') || record.isMeta === true) {
        diagnostics.skipped += 1;
        continue;
      }

      const images = contentImages(record.message?.content);
      const text = contentText(record.message?.content);
      if (!text && images.length === 0) {
        diagnostics.skipped += 1;
        continue;
      }

      const messageModel = record.message?.model ?? record.model ?? null;
      const truncated = text.length > LIMITS.TEXT_MAX_CHARS;
      if (messageModel) model = messageModel;
      const sequence = messages.length;
      const messageNativeId = record.uuid ?? record.message?.id
        ?? `generated:${stableId(sourcePath, line, role)}`;
      const parentNativeMessageId = record.parentUuid ?? record.message?.parentId ?? null;
      const ownMessageKey = messageKey(PROVIDERS.CLAUDE, messageNativeId, sourcePath, sequence);
      messages.push({
        messageKey: ownMessageKey,
        sessionKey: ownSessionKey,
        nativeId: messageNativeId,
        parentMessageKey: parentNativeMessageId ? nativeMessageKeys.get(parentNativeMessageId) ?? null : null,
        sequence,
        timestamp,
        role,
        contentType: images.length && !text ? 'attachment' : 'text',
        text: truncate(text, diagnostics),
        sourcePath,
        sourceLocator: `line:${line}`,
        model: messageModel,
        metadata: {
          recordType: record.type,
          isSidechain: record.isSidechain === true,
          truncated,
        },
      });
      for (const [ordinal, image] of images.entries()) {
        const duplicate = images.slice(0, ordinal).filter(candidate => candidate.sha256 === image.sha256).length;
        const nativeAttachmentId = `${image.sha256}:${duplicate}`;
        attachments.push({
          attachmentKey: attachmentKey(PROVIDERS.CLAUDE, messageNativeId, sourcePath, nativeAttachmentId),
          messageKey: ownMessageKey,
          sessionKey: ownSessionKey,
          provider: PROVIDERS.CLAUDE,
          nativeId: nativeAttachmentId,
          ordinal,
          kind: 'image',
          mime: image.mime,
          byteLength: image.byteLength,
          sha256: image.sha256,
          sourcePath,
          locator: {
            line,
            blockIndex: image.blockIndex,
            messageId: record.uuid ?? record.message?.id ?? null,
          },
          metadata: {},
        });
      }
      nativeMessageKeys.set(messageNativeId, ownMessageKey);
    }

    const project = cwd ? cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) : null;
    const { project: encodedProject, ...safeDescriptorMetadata } = descriptor.metadata ?? {};
    title = title || messages.find(message => message.role === 'user')?.text.slice(0, LIMITS.TITLE_MAX_CHARS) || null;
    const resumeNativeId = parentNativeId ?? nativeId;
    const session = {
      sessionKey: ownSessionKey,
      provider: PROVIDERS.CLAUDE,
      nativeId,
      sourcePath,
      parentSessionKey: parentNativeId
        ? sessionKey(PROVIDERS.CLAUDE, parentNativeId, path.join(path.dirname(path.dirname(path.dirname(sourcePath))), `${parentNativeId}.jsonl`))
        : null,
      title,
      summary,
      project,
      cwd,
      gitBranch,
      model,
      createdAt,
      updatedAt,
      sourceUpdatedAt: asIso(stat.mtimeMs),
      archived: false,
      resume: {
        command: 'claude',
        args: ['--resume', resumeNativeId],
        cwd,
      },
      metadata: {
        ...safeDescriptorMetadata,
        isSubagent: subagent,
        agentId,
        versions: [...versions],
      },
    };

    return { sessions: [session], messages, attachments, diagnostics };
  },

  async readAttachment(attachment) {
    const record = await readJsonlRecordAt(attachment.sourcePath, attachment.locator.line);
    const messageId = record?.uuid ?? record?.message?.id ?? null;
    if (attachment.locator.messageId && String(messageId) !== String(attachment.locator.messageId)) return null;
    const block = record?.message?.content?.[attachment.locator.blockIndex];
    if (block?.type !== 'image' || block.source?.type !== 'base64') return null;
    const mime = String(block.source.media_type || attachment.mime).toLowerCase();
    return decodeDataUrl(`data:${mime};base64,${block.source.data || ''}`);
  },
};
