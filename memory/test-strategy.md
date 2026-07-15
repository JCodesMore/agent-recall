# Test Strategy

- Build every provider store synthetically in a temporary directory.
- Test adapters independently before indexing.
- Test redaction in storage and output, not only as a pure function.
- Test unchanged-source skips and removed-source cascades.
- Test search, broad fallback, context windows, metadata, pagination, and activity labels.
- Test the installed skill in temporary Claude and Agent Skills targets.
- Run a read-only local doctor/sync smoke test after the synthetic suite.
