#!/usr/bin/env node
// Stable entry point: skills, hooks and other tools call this path.

// config.mjs uses only syntax old Node versions can load, so the version check can read it.
const { APP, nodeSupported } = await import('../src/shared/config.mjs');
if (!nodeSupported()) {
  process.stderr.write(`Agent Recall needs Node.js ${APP.MIN_NODE.major}.${APP.MIN_NODE.minor} or newer (found ${process.versions.node}). Install the current LTS from https://nodejs.org\n`);
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
