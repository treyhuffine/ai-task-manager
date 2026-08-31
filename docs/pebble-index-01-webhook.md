# Pebble Index 01 webhook

Flow can receive Index 01 voice captures at:

```text
POST https://<your-flow-host>/api/webhooks/pebble
```

This is a dedicated capture adapter. It is separate from agent trigger webhooks because the Pebble app can set static headers, but it cannot calculate Flow's per-request HMAC signature.

## Configure Flow

Generate a dedicated secret:

```bash
openssl rand -hex 32
```

Add it to the environment used to start Flow:

```dotenv
PEBBLE_WEBHOOK_SECRET=<generated-secret>
```

For local development, put it in `.env.local`. Restart Flow after changing the environment.

The URL must be reachable from the phone running the Pebble app. Use the saved Beamd HTTPS URL or another HTTPS tunnel. See [Remote Access and HTTPS](remote-access.md) for the available options. A localhost URL only works when the sender runs on the same machine.

## Configure the Pebble app

In Index 01 Settings, open **Webhook** and configure the gesture you want to send. Current Pebble releases let **Hold & talk** and **Double click & hold** use separate webhook settings.

Set:

| Setting | Value |
|---|---|
| URL | `https://<your-flow-host>/api/webhooks/pebble` |
| Header name | `Authorization` |
| Header value | `Bearer <generated-secret>` |
| Send | `Both` recommended |

`X-Pebble-Webhook-Secret: <generated-secret>` is also accepted if a dedicated header is easier to configure.

Choose a payload mode based on what you want Flow to retain:

| Pebble mode | Flow behavior |
|---|---|
| Transcription only | Creates a voice capture from Pebble's text. This is the smallest and fastest request. |
| Both | Creates a voice capture and stores the M4A as an attachment. This is the recommended default. |
| Recording only | Stores the M4A, creates a retryable placeholder immediately, then tries Flow's configured speech-to-text provider in the background. |

Use **Send test event** after saving. Flow acknowledges a valid test event without adding it to the Stream.

## Payload contract

Pebble sends `multipart/form-data`, not JSON.

| Field | When present | Value |
|---|---|---|
| `audio` | Recording only or Both | `audio/mp4` file named `<recordingId>.m4a`. The content is mono 16 kHz AAC-LC in an M4A container. |
| `transcription` | Transcription only or Both | Plain text transcription when one is available. |
| `recordedAt` | Always | Unix timestamp in milliseconds as a text field. |
| `client` | Always | `ring` |
| `test` | Test events only | `true` |

Pebble also adds these headers:

| Header | Value |
|---|---|
| `X-Index-Trigger` | `single-click-hold`, `double-click-hold`, or `test-event` |
| `X-Audio-Size` | Audio byte count when an audio part exists |
| `X-Index-Test` | `true` for a test event |

Example request:

```bash
curl https://<your-flow-host>/api/webhooks/pebble \
  -H 'Authorization: Bearer <generated-secret>' \
  -H 'X-Index-Trigger: single-click-hold' \
  -F 'transcription=Remember to buy milk' \
  -F 'recordedAt=1788112345678' \
  -F 'client=ring' \
  -F 'audio=@recording.m4a;type=audio/mp4'
```

## Receiver behavior

- Authentication is checked before the multipart body is parsed.
- Test events return `200` and do not create a capture.
- New captures return `201` only after the Stream row and any audio attachment are durable.
- Redelivery is deduplicated with the original `recordedAt` value. A duplicate returns `200` with the existing item id.
- The raw multipart body is not stored because it can contain binary audio. Flow stores a JSON audit envelope with the timestamp, gesture, original transcription, transcription source, and audio metadata. Auth headers are never included.
- Audio is limited to 50 MiB. Flow enforces the request limit on bytes received even when `Content-Length` is absent or incorrect. Transcription text is limited to 200,000 characters.
- Pebble currently treats any `2xx` response as success and has a two minute request timeout. Recent Runs is diagnostic only in the current app. There is no persistent retry queue or manual retry control, so repeat the capture if a delivery fails.

## Safe request logs

Flow writes compact JSON metadata to the terminal or service log for each delivery. A normal capture produces `request received`, `payload validated`, and `capture created` entries. Test events, rejected requests, duplicates, and background transcription have their own entries.

Example:

```text
[POST /api/webhooks/pebble] payload validated {"recordedAt":1788112345678,"client":"ring","trigger":"single-click-hold","fields":["audio","client","recordedAt","transcription"],"requestBytes":18240,"transcriptionPresent":true,"transcriptionCharacters":42,"audio":{"name":"recording.m4a","contentType":"audio/mp4","bytes":16384,"advertisedBytes":"16384"}}
```

The logs intentionally exclude the webhook secret, authorization header, transcript text, raw audio, multipart boundary, and full request headers.

The payload contract was verified against Pebble's [official webhook API document](https://github.com/coredevices/mobileapp/blob/1.10.0.2/experimental/src/commonMain/kotlin/coredevices/ring/external/indexwebhook/INDEX_WEBHOOK_API.md) and [sender implementation](https://github.com/coredevices/mobileapp/blob/1.10.0.2/experimental/src/commonMain/kotlin/coredevices/ring/external/indexwebhook/IndexWebhookApi.kt).
