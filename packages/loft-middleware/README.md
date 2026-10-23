# @moc-global/loft-middleware

Guard middleware for [LOFT](https://github.com/MoC-OSS/LOFT): PII redaction and prompt-injection detection. You install each guard in the chat middleware, the MCP clients, the additional tools and the tracer. Each installer covers one of those places, and the guide lists what each guard covers by default and what it does not cover.

> **Experimental, not yet published.** The API may change before the first release. It needs the `@moc-global/loft` and `@moc-global/loft-definitions` releases that follow 2.10.0 and 1.9.0.

```typescript
import { LoftConstructor } from '@moc-global/loft';
import { applyMiddleware, guardMcpClient, guardTools, maskTracerFactory } from '@moc-global/loft-middleware';
import { injectionGuard } from '@moc-global/loft-middleware/injection';
import { piiRedaction } from '@moc-global/loft-middleware/pii';

const guards = [piiRedaction({ input: true, toolResults: true }), injectionGuard()];

const loftConstructor = new LoftConstructor(config, manifests, chatConstructor, maskTracerFactory(tracerFactory, guards));
const loft = loftConstructor.getInstance();
applyMiddleware(chatConstructor, guards); // before your own middleware
await chatConstructor.useMcpClient('crm', guardMcpClient(crmClient, guards, { serverName: 'crm' }));
await loft.chat.generate({ sessionId, directMessages, additionalTools: guardTools(tools, guards) });
```

| Entry point | Exports |
|---|---|
| `@moc-global/loft-middleware` | `applyMiddleware`, `maskTracerFactory`, `maskTracer`, `guardMcpClient`, `guardTool`, `guardTools`, `TOOL_GUARD_FAILED_TEXT`, the types `LoftMiddleware`, `ToolInfo`, `ToolOutput`, `ListedTool`, `GuardMcpClientOptions`; for writing your own guard: `mapContent`, `mapToolContent`, `mapStrings`, `textOfParts` |
| `@moc-global/loft-middleware/pii` | `piiRedaction`, `createRedactor`, `defaultPiiDetectors`, the detectors (`emailDetector`, `creditCardDetector`, `ibanDetector`, `ipv4Detector`, `regexDetector`) and the `PiiDetector` type |
| `@moc-global/loft-middleware/injection` | `injectionGuard`, `heuristicDetector`, `InjectionDetectedError`, `findInjectionDetected`, `injectionFlagOf`, the `InjectionDetector` type and the placeholder texts (`QUARANTINED_MESSAGE_TEXT`, `WITHHELD_TOOL_OUTPUT_TEXT`, `WITHHELD_CONTEXT_TEXT`) |

What each guard does, what it costs and what it does not protect against: [Guard middleware guide](../../docs/guides/guard-middleware.md). The design: [ADR-002](../../docs/adr/loft/002-middleware-package.md).

## License

MIT
