---
'@moc-global/loft-llm-call-manager': patch
---

A call aborted while it waits in the queue now leaves the queue at once: it rejects with the abort reason and no longer counts toward `highPriorityTasksLimit`. Before, it stayed queued until its turn came. A call aborted while it runs keeps its place until it ends, so calls still run one at a time.
