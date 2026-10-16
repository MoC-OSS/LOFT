---
'@moc-global/loft-queue-sqs-strategy': minor
---

Update `sqs-consumer` from 10 to 15. `subscribe()` still deletes a message once the worker resolves and keeps it when the worker rejects; from sqs-consumer 14 that needs the handler to return the message, which it now does. `consumerOptions` gains the options sqs-consumer added, such as `strictReturn`.
