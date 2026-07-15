import { APP } from '../config.mjs';

const RULES = Object.freeze([
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gi,
  },
  {
    name: 'authorization',
    pattern: /\b(authorization\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|(?:[a-z][a-z0-9_-]*\s+)?[^\s,}]+)/gi,
    replace: '$1[REDACTED]',
  },
  {
    name: 'credential-header',
    pattern: /\b((?:x[-_])?(?:api[-_]?key|auth[-_]?token|access[-_]?token|refresh[-_]?token|session[-_]?(?:id|token)|cookie)|set-cookie)\s*:\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,}]+)/gi,
  },
  {
    name: 'json-credential',
    pattern: /(["'](?:[a-z0-9]+[_-])*(?:api[_-]?key|password|passwd|secret|token|private[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|share[_-]?url)["']\s*:\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\]]+)/gi,
    replace: '$1[REDACTED]',
  },
  {
    name: 'credential-assignment',
    pattern: /\b((?:[A-Z][A-Z0-9_-]*[-_])?(?:API[-_]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[-_]?KEY|ACCESS[-_]?KEY[-_]?ID|SECRET[-_]?ACCESS[-_]?KEY)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi,
    replace: '$1[REDACTED]',
  },
  {
    name: 'known-token-prefix',
    pattern: /\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_|xox[baprs]-|ctx7sk-|ref-|AIza)[A-Za-z0-9_-]{12,}\b/gi,
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    name: 'credentialed-url',
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
    replace: '$1[REDACTED]@',
  },
]);

export function redactText(value) {
  let text = typeof value === 'string' ? value : '';
  const matches = [];
  for (const rule of RULES) {
    let count = 0;
    text = text.replace(rule.pattern, (...args) => {
      count += 1;
      if (typeof rule.replace === 'function') return rule.replace(...args);
      if (rule.replace) {
        return rule.replace.replace('$1', typeof args[1] === 'string' ? args[1] : '');
      }
      return `[REDACTED:${rule.name}]`;
    });
    if (count) matches.push({ rule: rule.name, count });
  }
  return {
    text,
    redacted: matches.reduce((sum, item) => sum + item.count, 0),
    matches,
    policyVersion: APP.REDACTION_POLICY_VERSION,
  };
}

export function redactRecord(record) {
  const result = redactText(record.text);
  return {
    ...record,
    text: result.text,
    metadata: {
      ...(record.metadata || {}),
      privacy: {
        redactions: result.redacted,
        policyVersion: result.policyVersion,
      },
    },
  };
}

export function redactValue(value) {
  if (typeof value === 'string') return redactText(value).text;
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const sensitive = /(?:apikey|password|passwd|secret|token|privatekey|accesskeyid|secretaccesskey|clientsecret|accesstoken|refreshtoken|authorization|shareurl)$/.test(normalizedKey);
      return [key, sensitive ? `[REDACTED:${key}]` : redactValue(item)];
    }));
  }
  return value;
}
