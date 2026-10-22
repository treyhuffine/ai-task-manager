-- Correct provenance using protocol kinds, never the wording of a message.
-- Existing 0020 and its payload bytes remain immutable.
UPDATE agent_coordination_deliveries
SET sender_kind = 'system', updated_at = datetime('now')
WHERE kind IN ('blocked', 'failed', 'cancelled') AND sender_kind = 'agent';
--> statement-breakpoint
UPDATE chat_events
SET role = 'system', source = 'error', sender_session_id = NULL,
    raw = json_set(COALESCE(raw, '{}'), '$.agentCoordination', json_object(
      'deliveryId', d.id, 'kind', d.kind, 'senderKind', 'system',
      'sourceSessionId', d.source_session_id, 'sourceEventId', d.source_event_id,
      'requestId', d.request_id, 'content', json_extract(d.payload, '$.content'),
      'originalRequest', json_extract(d.payload, '$.originalRequest')))
FROM agent_coordination_deliveries d
WHERE chat_events.id = d.event_id AND d.kind IN ('blocked', 'failed', 'cancelled')
  AND d.sender_kind = 'system';
