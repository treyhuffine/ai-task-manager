# Connector timeout follow-up

- [x] Increase upstream tool, discovery and resource budgets with a real hard total deadline.
- [x] Ensure the HTTP client cannot impose an earlier hidden response timeout.
- [x] Request upstream progress notifications so inactivity resets actually work.
- [x] Queue DataForSEO bursts across chats and runtime generations at three upstream requests per account.
- [x] Recheck authority after queueing and preserve paid-request indeterminate outcomes.
- [x] Keep single-request timeouts separate from broken connections and record clear diagnostics.
- [x] Verify delayed responses, progress, hard deadline, parallel bursts and timeout isolation.
- [x] Finish full app verification, commit to main and push origin/main.

Landed: aabd7f694407ca3b41d6dbfeb373e1dc3a1879e9, verified equal on local main and live origin/main.

Validation: 6,150 app tests passed with 41 skipped (maxWorkers=4), 421 engine tests passed, both typechecks passed, changed-code ESLint passed. The first unbounded app run hit two five-second test deadlines and Vitest teardown errors. The isolated rerun and entire bounded-worker rerun passed.

Production was neither rebuilt nor restarted. The initial socket-close initiator remains unproven. Three calls per account is a protective host policy based on the reported burst behavior, not a claimed DataForSEO vendor concurrency limit.
