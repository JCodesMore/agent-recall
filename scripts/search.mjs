#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { search } from '../src/searcher/index.mjs';
import { buildDelta } from '../src/indexer/delta.mjs';
import { readIndex } from '../src/indexer/inverted.mjs';
import { formatResults } from '../src/formatter/cli.mjs';
import { formatJson } from '../src/formatter/json.mjs';
import { startServer } from '../src/web-server/server.mjs';
import { listTranscripts, indexHome } from '../src/paths.mjs';
import { EXIT_CODES, INDEX_FILES } from '../src/config.mjs';

function parseArgs(argv) {
  const args = { _: [], web: false, json: false, limit: undefined, project: undefined, index: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--web' || a === '-w') args.web = true;
    else if (a === '--json') args.json = true;
    else if (a === '--index') args.index = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

const USAGE = `Usage: claude-search [options] <query>

Options:
  --web, -w          Open local web UI on 127.0.0.1
  --json             Emit JSON results instead of styled text
  --limit <n>        Max results (default: 20)
  --project <name>   Filter by project (substring match)
  --index            Force a synchronous re-index before searching
  --help, -h         Show this help`;

async function indexExists() {
  try {
    await fs.stat(path.join(indexHome(), INDEX_FILES.INDEX));
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); process.exit(EXIT_CODES.OK); }

  const query = args._.join(' ').trim();

  if (!(await indexExists())) {
    const files = await listTranscripts({});
    process.stderr.write(`First-time indexing ${files.length} transcript files. This takes ~30 seconds...\n`);
    await buildDelta({});
  } else if (args.index) {
    await buildDelta({});
  }

  if (args.web) {
    const index = await readIndex();
    const info = await startServer({ index, initialQuery: query });
    console.log(`Open ${info.url} in your browser.`);
    if (query) console.log(`Initial query: "${query}"`);
    console.log('Press Ctrl+C to stop.');
    return;
  }

  if (!query) {
    process.stderr.write(USAGE + '\n');
    process.exit(EXIT_CODES.USAGE);
  }

  const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

  const t0 = Date.now();
  const results = await search(query, {
    limit: args.limit,
    project: args.project,
    format: (args.json || !colorEnabled) ? 'plain' : 'ansi',
  });
  const elapsedMs = Date.now() - t0;

  if (args.json) {
    process.stdout.write(formatJson(results, { query, elapsedMs }) + '\n');
  } else {
    process.stdout.write(formatResults(results, { query, elapsedMs, color: colorEnabled }) + '\n');
  }
}

main().catch(err => {
  process.stderr.write(`error: ${err.stack || err.message}\n`);
  process.exit(EXIT_CODES.INTERNAL);
});
