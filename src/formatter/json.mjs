export function formatJson(results, meta = {}) {
  return JSON.stringify({
    query: meta.query,
    elapsedMs: meta.elapsedMs,
    count: results.length,
    results,
  }, null, 2);
}
