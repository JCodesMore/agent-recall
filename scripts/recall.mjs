#!/usr/bin/env node
// Stable entry point: skills, hooks and other tools call this path.

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  process.stderr.write(`Agent Recall needs Node.js 22.13 or newer (found ${process.versions.node}). Install the current LTS from https://nodejs.org\n`);
  process.exit(1);
}

// node:sqlite prints an ExperimentalWarning on some Node versions; it is noise for agents.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type !== 'ExperimentalWarning') emitWarning(warning, ...args);
};

const { main } = await import('../src/cli/main.mjs');
await main(process.argv.slice(2));
