# Channels

Channels connect external communication surfaces to commanders. A channel
binding chooses which commander receives inbound messages, and a surface binding
chooses the conversation context.

## Operating Model

- Account binding chooses the commander.
- Surface binding chooses the conversation.
- Adapter runtime owns the external provider connection.
- Commander routes own inbound message ingest and outbound reply dispatch.
- Automatic replies use durable `channelReplyIntents` plus a reconciliation loop;
  the process-local reply forwarder is only the fast path.

Use this distinction when debugging channel pairing: a connected account is not
the same thing as an active conversation binding.

## Automatic Reply Checks

When an inbound channel message appears in Command Room but the external provider
does not receive the assistant reply, check the commander conversation state:

```text
channelReplyIntents[pending]
        |
        +-- no deliveryId: reconciler has not found/claimed the assistant turn
        |
        +-- deliveryId set: delivery was claimed and must settle delivered/failed

channelReplyDelivery[pending]
        |
        +-- owned by pending intent or in-flight send: wait for settlement
        |
        +-- orphaned: should not block a newer reconciled intent
```

Useful readback fields are `channelMeta`, `lastRoute`, `channelReplyIntents`,
and `channelReplyDelivery`. The same assistant text should be traceable through
the transcript tail, `/api/conversations/:id/messages`, delivery state, and the
provider adapter send.

Source references:

- [Channels feature guide](../features/channels.md)
- [Channels architecture](../architecture/channels.md)
- [Channel integration guide](../guides/channel-integration-guide.md)
