import { LIMITS } from '../shared/config.mjs';
import { stem, words } from '../shared/text.mjs';

// Words that carry no topic. The second line is how people ask for recall ("find the chat
// where we discussed..."); matching them ranks recall requests above the conversation sought.
const STOPWORDS = new Set(`
a about above after again all also am an and any are as at be because been before being below between both but by
can could did do does doing down during each few for from further had has have having he her here hers him his how
i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own
same she should so some such than that the their theirs them then there these they this those through to too under
until up very was we were what when where which while who whom why will with would you your yours yourself let lets
conversation conversations chat chats session sessions thread threads transcript transcripts talked talk discussed
discuss discussion mentioned mention remember recall earlier previous previously past ago find search look looking
`.split(/\s+/).filter(Boolean));

// Tokens that the FTS tokenizer would split (paths, file names, flags, kebab and snake case)
// are searched as a phrase so "codex-lb" does not match every "codex" and every "lb".
const CODE_TOKEN = /[\p{L}\p{N}]+(?:[._\-/\\:@#][\p{L}\p{N}]+)+/gu;

const quote = value => `"${value.replaceAll('"', '""')}"`;

function termFor(tokens, phrase) {
  const text = tokens.join(' ');
  return {
    text,
    phrase,
    tokens,
    stems: tokens.map(stem),
    // A phrase also matches when its parts appear apart, just with a lower score.
    fts: phrase && tokens.length > 1 ? `(${quote(text)} OR (${tokens.map(quote).join(' AND ')}))` : quote(text),
  };
}

/**
 * Turns free text into search terms. Quoted text and code-like tokens become phrases;
 * everything else becomes single words minus stopwords. When every word is a stopword the
 * words are kept, so a query is never silently empty.
 */
export function parseQuery(raw) {
  let text = String(raw ?? '').slice(0, LIMITS.QUERY_MAX_CHARS).replace(/[‘’“”]/g, match => (match === '‘' || match === '’' ? "'" : '"'));
  const terms = [];
  const seen = new Set();
  const add = term => {
    if (!term.tokens.length || seen.has(term.text) || terms.length >= LIMITS.QUERY_MAX_TERMS) return;
    seen.add(term.text);
    terms.push(term);
  };

  text = text.replace(/"([^"]+)"/g, (_, inner) => {
    add(termFor(words(inner), true));
    return ' ';
  });
  text = text.replace(CODE_TOKEN, match => {
    add(termFor(words(match), true));
    return ' ';
  });
  const plain = words(text);
  const topical = plain.filter(word => !STOPWORDS.has(word));
  for (const word of (topical.length || terms.length ? topical : plain)) add(termFor([word], false));

  return {
    raw: String(raw ?? ''),
    terms,
    match: terms.map(term => term.fts).join(' OR '),
    stems: new Set(terms.flatMap(term => term.stems)),
  };
}
