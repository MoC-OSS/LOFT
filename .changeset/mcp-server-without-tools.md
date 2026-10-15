---
'@moc-global/loft': patch
---

Accept MCP servers that offer no tools.

`useMcpClient()` called `tools/list` on every server, and a server without the tools capability, for example one that only serves resources, answers that with "Method not found", so its registration failed. LOFT now checks the server's capabilities and registers such a server with no tools. A client that is not connected still fails to register, with the SDK's "Not connected" error.
