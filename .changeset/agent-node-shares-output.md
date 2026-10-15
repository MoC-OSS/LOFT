---
'@moc-global/loft-agents': minor
---

`LoftAgentNode` stores its answer in the SharedContext.

A node's answer reached only the next node, as its input. After a fan-out the next node got only the last branch's answer, and a team's parent got only the team's final answer, so coordinators and reviewers worked from partial results. Each `LoftAgentNode` now stores its answer under its name in the SharedContext, as the agents design describes: later nodes receive it with the shared context, and a team's parent receives its nodes' answers as `team:<team>:<node>`. Set `shareOutput: false` on a node to keep its answer out.
