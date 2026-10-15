---
'@moc-global/loft': patch
---

Send the model only the current Focus prompt.

Each turn of a session with Focus adds a system message with the Focus instructions and the fields collected so far, and `result.messages.save()` stores it. Later turns sent every stored copy along with the new one, so the model saw outdated statuses. Stored Focus prompts are now left out of the history sent to the model, like the messages agents exchange; the history itself is unchanged.
