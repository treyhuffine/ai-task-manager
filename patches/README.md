# agentex OpenCode control channel

`@agentex__agent@0.0.48.patch` changes the shared integration's shipped source and JavaScript. It avoids requiring an unpublished library release or modifying the linked agentex checkout.

OpenCode can interpret port 0 as a fixed default. Two ordinary Home processes using the same folder could attach to, or stop, each other's native server. This patch allocates an explicit free loopback port for each new server. A race for that port fails startup rather than attaching to an unrelated server. Native control authentication keeps the SDK's generated random password.

`src/lib/harness/opencode-home-processes.test.ts` starts two actual SDK server pools against a synthetic native process, refuses port 0, and checks separate authenticated ports and contexts. It is a process/protocol fixture, not live-account qualification.

The archived controller-specific password override was removed. Frozen pnpm installs apply the remaining port fix automatically. Remove the patch after upgrading to an agentex release with this fix and repeating the regression.
