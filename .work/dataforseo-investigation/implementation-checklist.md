# Connector recovery implementation

- [x] Keep already-started requests alive while retiring a runtime, and reject new use of retired clients.
- [x] Keep verified tool schemas during temporary discovery failures without reactivating or replacing saved credentials.
- [x] Retry unavailable discovery after 15 seconds on use, and recover closed transports without replaying data requests.
- [x] Keep typed authentication rejection distinct from transient errors, with useful persisted health diagnostics.
- [x] Verify account revocation, changed tool policy, sibling accounts, and recovery through regression tests.
- [x] Document the behavior and run integration tests, typecheck, and lint.
