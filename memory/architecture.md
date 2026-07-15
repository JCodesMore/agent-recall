# Architecture

`discover -> parse -> redact -> transaction -> FTS -> bounded retrieval`

Provider adapters return normalized sessions and messages. `syncHistory()` replaces one changed source inside a transaction, relying on foreign-key cascades to remove stale sessions and messages. SQLite FTS5 is maintained by triggers and is derived state.

The service layer returns versioned, compact objects. Search returns one hit per session. Context uses message sequence windows. Transcript retrieval is paginated. Session metadata includes structured resume arguments and an activity classification.

The index is never authoritative. Deleting it and running `sync` rebuilds it from provider stores.
