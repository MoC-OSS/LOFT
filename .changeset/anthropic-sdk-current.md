---
'@moc-global/loft-anthropic-strategy': minor
---

Support the current `@anthropic-ai/sdk`. The peer range is now `>=0.39.0 <1` instead of 0.39.x only.

The model preset accepts the thinking types of the current Messages API: `between_tools` and `adaptive` besides `enabled` and `disabled`, and `display` on `enabled` and `adaptive`. Claude Sonnet 5.5 turns thinking off only with `{ "type": "between_tools" }`, which the preset used to reject; Claude Haiku 5.5 turns it off with `{ "type": "disabled" }`. The preset also takes `output_config` (`effort` and `format`), `service_tier`, `inference_geo` and a request-level `cache_control`, and the strategy sends them; `cache_control` takes `ttl`, and `tool_choice` takes `{ "type": "none" }`. These fields reach the API with any SDK in the range, and the API decides which of them a model supports. Tool calls from the chat history are sent as request blocks (`ToolUseBlockParam`), so they no longer need the `caller` field that response blocks gained.
