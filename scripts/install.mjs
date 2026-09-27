#!/usr/bin/env node
// Kept for older instructions; the same as `recall.mjs install`.
const { main } = await import('../src/cli/main.mjs');
await main(['install', ...process.argv.slice(2)]);
