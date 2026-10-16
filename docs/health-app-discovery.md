# Health app feasibility and product direction

October 15, 2026. Status: parked pending an acceptable Apple Health sync path.

Apple Health is a requirement for the proposed Health app. The owner considers the product potentially not worth building without it. Repeated manual exports would not deliver the intended low-maintenance experience. Preserve this exploration and move on to other app opportunities. This document does not schedule implementation.

Apple Health data is technically accessible through software on a supported Apple device. The unresolved question is whether Ri can offer automatic synchronization with acceptable setup, freshness and maintenance. A native iPhone bridge is a plausible approach, but it has not been built or qualified in Ri.

## Apple Health access

HealthKit is a native framework with permission-controlled access to health records. Apple's setup documentation specifically identifies macOS as a platform where the HealthKit store is unavailable. The current Ri browser and Mac host therefore need a device-side bridge rather than a direct HealthKit integration. [Apple HealthKit setup](https://developer.apple.com/documentation/healthkit/setting-up-healthkit)

Apple supports observer queries and background delivery. An observer signals that records changed, and a subsequent query retrieves the changes. Anchored queries can retrieve added and deleted records for incremental synchronization. Background delivery must be tested on a physical device. These APIs enable a sync design, but do not establish that our proposed product meets a particular freshness target. [Observer queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries), [Reading HealthKit data](https://developer.apple.com/documentation/healthkit/reading-data-from-healthkit)

HealthKit's encrypted store may be inaccessible while the phone is locked. Read permission is controlled per data type, and an app cannot distinguish denied read access from an absence of readable records. Health must show missing coverage without asserting that a person had zero activity or explicitly denied a permission. Apple's documentation also restricts disclosure to third parties. Any AI processing and distribution plan needs to satisfy those requirements, including express permission and the permitted purpose of the receiving service. Local storage alone does not settle that question. [Protecting user privacy](https://developer.apple.com/documentation/healthkit/protecting-user-privacy)

There are three possible ingestion paths:

| Path | What it offers | Product implication |
| --- | --- | --- |
| Ri iPhone companion | Native HealthKit access and a Ri-owned pairing and sync experience | Preferred direction if Health proceeds. Requires native development, distribution and real-device qualification. |
| Existing iPhone exporter | A faster way to test ingestion and usefulness | Suitable for an initial feasibility experiment. Another app and its configuration become part of the experience. |
| Apple Health XML export | User-initiated historical import | Useful for backfill and testing. Insufficient as the only long-term ingestion method for this proposal. |

Health Auto Export documents JSON or CSV delivery to an HTTP endpoint, custom authentication headers and background automations. Its documentation also states that configured schedules are not exact and describes locked-device and background-execution limitations. This is an integration candidate, not a qualified Ri dependency. Its sample localhost URL would refer to the phone when used on the phone, not to the user's Ri computer. [REST export](https://help.healthyapps.dev/en/health-auto-export/automations/rest-api/), [Automation behavior](https://help.healthyapps.dev/en/health-auto-export/automations/)

The publisher also provides an MCP example backed by a TCP server on the phone. Its documented requirements include Premium access and a shared Wi-Fi network. The phone server is foreground-only and documents no built-in authentication or TLS. This existing MCP route does not satisfy the proposed unattended, authenticated sync experience. Keep it separate from the outbound REST automation path when evaluating options. [MCP example](https://github.com/HealthyApps/health-auto-export-mcp-server), [TCP limitations](https://github.com/HealthyApps/health-auto-export-mcp-server/blob/main/docs/tcp-server.md)

Apple also provides an XML export of Health data. It can support an import prototype without assuming continuous access. [Apple export instructions](https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/ios)

## Proposed bridge

The phone would request read access to selected HealthKit types and pair with one Health instance in one Ri Home. Pairing would issue a revocable credential limited to health ingestion. The companion must not receive a Home administrator token or inherit unrelated connector access.

The proposed flow is HealthKit changes, a durable phone queue, authenticated transfer to the reachable Home, and an acknowledged import into Health's own store. Checkpoints advance only when records are durably queued, and queued batches remain until the Home acknowledges them. Imports must tolerate retries and carry deletions. When the Home is asleep or unreachable, the phone retains pending batches and catches up later.

The network path needs explicit qualification. An iPhone away from home cannot reach a private Mac address merely because Ri has an HTTP endpoint. Test the chosen paired connection or reachable HTTPS route. An incoming ingestion endpoint is new work, distinct from the private MCP connection used to render an app.

## Experience to preserve

The central job is to help a person understand changes in their own patterns. Start with sleep, activity and recovery-related measurements that the connected source actually provides.

- Overview shows selected metrics, recent trends, coverage and last successful sync.
- Explore offers aligned date ranges, drill-down, comparisons and annotations for travel, illness or routine changes.
- Journal captures observations such as energy or symptoms that a wearable cannot supply.
- Ask Ri uses the existing chat. Selecting a chart or time range supplies explicit context, and answers link to source records.

A representative interaction is: select a month and ask, "Compare my sleep on workout days and rest days." The calculation and chart use the same underlying records. Observed associations remain distinct from proposed explanations.

Use neutral backgrounds and typography, with restrained series colors and meaningful status indicators. Larger measurements are not universally better in a health context, so do not apply the financial green-positive and red-negative convention mechanically.

## Data and app boundaries

Health would live in its own `apps/health` package with an app-owned local database. Reuse the existing app runtime, MCP Apps view host, library, scoped grants, chat mentions and native conversation handoff. Ri does not import Health domain code, and Health does not read Ri or Finances databases directly. The [Finances implementation](finances-experience.md) supplies a working reference for the app experience.

New work includes ingestion, health provider adapters, a common measurement model and health-specific calculations. Preserve source and device identity, original record identifiers, measurement method, units, timestamps, local-day meaning, revisions and provenance. Imported raw records and calculated summaries have different roles. The same workout arriving directly and through Apple Health must not silently count twice, and provider-specific recovery scores must retain their identity.

Local records and AI context are separate decisions. The person controls which records a chat may use and sees what context is sent to the configured model provider. Background sync needs its own revocable authority. Existing process supervision does not by itself prove that every proposed Health ingestion or privacy boundary is implemented.

Oura, WHOOP and Withings offer documented API paths that could complement Apple Health. They do not replace the owner's Apple Health requirement. Each adapter still needs implementation, account authorization and provider-specific qualification. [Oura](https://cloud.ouraring.com/docs/authentication), [WHOOP](https://developer.whoop.com/api/), [Withings](https://developer.withings.com/developer-guide/v3/withings-solutions/app-to-app-solution/)

## Decision to revisit

Before committing to the full app, prove the Apple Health path on a physical iPhone with a disposable Ri Home. Start with a small, consented set of metrics and synthetic fixtures where possible. Verify historical import, incremental additions and deletions, retries without duplicates, offline catch-up, revocation and clear stale-data states. Measure behavior during ordinary phone use, locked periods and background execution.

The user experience must provide useful recent data without repeated exporting or frequent troubleshooting. Agree on acceptable freshness after measuring it rather than promising continuous real-time sync. If the practical path still demands regular manual maintenance, keep Health parked. No health records have been accessed and no Health app or mobile companion has been implemented as part of this discovery.

Other candidates are recorded in [App opportunities](app-opportunities.md).
