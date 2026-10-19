---
'@moc-global/loft-llm-call-manager': minor
---

`GenerateWithQueueManager` no longer requeues a task forever. A task that waits too long for the rate limiter goes back to the incoming queue with a `requeueAttempts` count, up to `maxRequeueAttempts` times (new config option, default 10). Then it goes, with its error, to an optional dead-letter queue (new sixth constructor argument), or to the outgoing queue as `{ sessionId, llmName, callContext, priority, error: { name, message } }`.
