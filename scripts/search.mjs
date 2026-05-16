#!/usr/bin/env node
import { search } from '../src/searcher/index.mjs';
import { buildDelta } from '../src/indexer/delta.mjs';
import { readIndex } from '../src/indexer/inverted.mjs';
import { formatResults } from '../src/formatter/cli.mjs';
import { formatJson } from '../src/formatter/json.mjs';
import { startServer } from '../src/web-server/server.mjs';
import { EXIT_CODES } from '../src/config.mjs';

function parseArgs(argv) {
  const args = { _: [], web: false, json: false, limit: undefined, project: undefined, noIndex: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--web' || a === '-w') args.web = true;
    else if (a === '--json') args.json = true;
    else if (a === '--no-index') args.noIndex = true;
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
  --no-index         Skip the index refresh before searching
  --help, -h         Show this help`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); process.exit(EXIT_CODES.OK); }

  const query = args._.join(' ').trim();

  if (!args.noIndex) {
    try { await buildDelta({}); }
    catch (err) {
      process.stderr.write(`warn: indexer failed (${err.message}); using existing index\n`);
    }
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

  const t0 = Date.now();
  const results = await search(query, {
    limit: args.limit,
    project: args.project,
    format: args.json ? 'plain' : 'ansi',
  });
  const elapsedMs = Date.now() - t0;

  if (args.json) {
    process.stdout.write(formatJson(results, { query, elapsedMs }) + '\n');
  } else {
    process.stdout.write(formatResults(results, { query, elapsedMs }) + '\n');
  }
}

main().catch(err => {
  process.stderr.write(`error: ${err.stack || err.message}\n`);
  process.exit(EXIT_CODES.INTERNAL);
});
