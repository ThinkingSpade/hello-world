---
id: rb-queue-poison
title: Quarantining a Poison Message in a Queue Consumer
type: runbook
service: platform
tags: [queue, poison-message, consumers]
updated: 2024-10-14
---

## Overview

A poison message is a message that a consumer cannot process and cannot skip: it
crashes or errors the handler, the broker redelivers it, and the partition or
queue stalls behind it. On Meridian this most often shows up in
**notification-svc**, which consumes `notifications.outbound` and dead-letters
to `notifications.dlq` after 5 delivery attempts.

Symptoms: `meridian_consumer_lag{service="notification-svc"}` climbing on one
partition while others are flat; pods crash-looping with the same stack trace
and offset (`failed to process offset=...`); alert `NotificationLagHigh`
firing in #platform-alerts.

This runbook covers identifying the message, quarantining it, draining the
DLQ, and replaying safely. If the stall is rate limiting rather than a bad
payload, see *INC-2408 War Room Transcript* — the lag graph looks similar.

## Preconditions

- `kubectl` access to the `prod-platform` cluster and namespace `messaging`.
- Kafka CLI tools available on the `ops-toolbox` pod.
- Read access to the `notification-svc` Grafana dashboard.
- Announce in #platform-oncall that you are pausing a consumer group.

## Steps

1. Confirm the stall is a single partition and capture the stuck offset.

   ```shell
   kubectl -n messaging logs deploy/notification-svc --tail=200 \
     | grep 'failed to process offset'
   kubectl -n messaging exec -it ops-toolbox -- \
     kafka-consumer-groups --bootstrap-server kafka-0.messaging:9092 \
     --describe --group notification-svc
   ```

2. Pause consumption so retries stop hammering downstream (webhook-dispatch
   shares the SMS provider quota).

   ```shell
   kubectl -n messaging scale deploy/notification-svc --replicas=0
   ```

3. Dump the poison message using the partition and offset from step 1.

   ```shell
   kubectl -n messaging exec -it ops-toolbox -- \
     kafka-console-consumer --bootstrap-server kafka-0.messaging:9092 \
     --topic notifications.outbound --partition 3 --offset 141592 \
     --max-messages 1 --property print.headers=true > /tmp/poison-141592.json
   ```

4. Copy the message to the quarantine topic, then advance the group offset.

   ```shell
   kubectl -n messaging exec -it ops-toolbox -- sh -c \
     'kafka-console-producer --bootstrap-server kafka-0.messaging:9092 \
      --topic notifications.quarantine < /tmp/poison-141592.json'
   kubectl -n messaging exec -it ops-toolbox -- \
     kafka-consumer-groups --bootstrap-server kafka-0.messaging:9092 \
     --group notification-svc --topic notifications.outbound:3 \
     --reset-offsets --to-offset 141593 --execute
   ```

5. Clear the idempotency key so a corrected replay is not deduplicated away.

   ```shell
   redis-cli -h redis-notifications.messaging.svc -n 2 \
     DEL "notif:idem:$(jq -r .idempotency_key /tmp/poison-141592.json)"
   ```

6. Resume the consumer and watch lag drain.

   ```shell
   kubectl -n messaging scale deploy/notification-svc --replicas=6
   ```

7. Drain the DLQ once lag is back to baseline. Replay in batches of 100, only
   after confirming the handler bug is fixed or the messages predate it.

   ```shell
   kubectl -n messaging exec -it ops-toolbox -- \
     meridian-dlq-replay --source notifications.dlq \
     --target notifications.outbound --batch-size 100 --dry-run
   kubectl -n messaging exec -it ops-toolbox -- \
     meridian-dlq-replay --source notifications.dlq \
     --target notifications.outbound --batch-size 100
   ```

## Verification

- `meridian_consumer_lag{service="notification-svc"}` under 500 on all
  partitions within 10 minutes.
- No recurrence of the `failed to process offset` stack trace in logs.
- `notifications.dlq` depth is 0 after replay (check with GetOffsetShell from
  the ops-toolbox pod).
- Spot-check three replayed notifications reached recipients (delivery events
  in the notification-svc audit table on db-replica-1).

## Rollback

If replay causes a new crash loop, scale notification-svc back to 0, stop
`meridian-dlq-replay`, and reset the group offset back to the pre-replay value
captured in step 1. Quarantined messages stay in `notifications.quarantine`
for 14 days; nothing is deleted by this procedure, so the rollback is purely
offset arithmetic.

## Escalation

- Primary: platform on-call (#platform-oncall). Owner of record: Huy N.
- If the payload came through partner-gateway with a malformed schema, loop in
  Marcus T. (integrations) to chase the partner-side fix.
- If quarantine volume exceeds 50 messages/hour, declare a SEV2 — that is a
  producer bug, not a poison message.
