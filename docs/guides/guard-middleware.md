# How to Redact Personal Data and Detect Prompt Injection

`@moc-global/loft-middleware` is a package of guard middleware: `piiRedaction` and `injectionGuard`. You install each guard in every place you want it to cover: the chat middleware, MCP clients, additional tools and the tracer. What each guard covers by default, and what it does not cover at all, is listed in its section below.

> **Experimental, not yet published.** The package lives in this repository at [`packages/loft-middleware`](../../packages/loft-middleware/) and is not on npm yet. Its API may change before the first release. It needs the `@moc-global/loft` and `@moc-global/loft-definitions` releases that follow 2.10.0 and 1.9.0, which add the `transformsOutput` option and keep raw messages out of the `generate()` trace and the `addMessages()` log. The design is in [ADR-002](../adr/loft/002-middleware-package.md).

## Why one object per guard

Chat middleware (Input, BeforeGenerate, AfterGenerate) sees the request and the reply. It does not see three other places data goes:

- **Tool outputs** reach the model inside the tool loop, after BeforeGenerate and before AfterGenerate.
- **Traces** record each middleware's input, so a redaction in middleware leaves the original text in the trace.
- **Logs.**

A guard is plain data with a hook for each of these places. You pass the same array of guards to each installer, and each installer applies the hooks that concern it:

| Installer | What it guards | Hooks it applies |
|---|---|---|
| `applyMiddleware(chatConstructor, guards)` | requests and replies | `input`, `beforeGenerate`, `afterGenerate` |
| `maskTracerFactory(factory, guards)` | everything sent to the tracer | `maskTrace` |
| `maskTracer(tracer, guards)` | a single tracer, such as the one for `OrchestratorBuilder.setTracer` | `maskTrace` |
| `guardMcpClient(client, guards, { serverName })` | MCP tool outputs, failed calls and tool descriptions | `toolResult`, `toolList` |
| `guardTool(tool, guards)`, `guardTools(tools, guards)` | an additional tool's output and errors | `toolResult` |

## Install the guards

```typescript
import { ChatConstructor, LangfuseTracer, LoftConstructor } from '@moc-global/loft';
import { applyMiddleware, guardMcpClient, guardTools, maskTracerFactory } from '@moc-global/loft-middleware';
import { injectionGuard } from '@moc-global/loft-middleware/injection';
import { piiRedaction } from '@moc-global/loft-middleware/pii';

const guards = [piiRedaction({ input: true, toolResults: true }), injectionGuard()];

const chatConstructor = new ChatConstructor(sessionRepositoryConstructor, chatHistoryRepositoryConstructor);
const loftConstructor = new LoftConstructor(
  loftConfig,
  manifestManagerConstructor,
  chatConstructor,
  maskTracerFactory(new LangfuseTracer(langfuseConfig), guards)
);
const loft = loftConstructor.getInstance(); // after registering your LLM strategies

// Before your own middleware, so that the guards see every request
applyMiddleware(chatConstructor, guards);
await chatConstructor.useMcpClient('crm', guardMcpClient(crmClient, guards, { serverName: 'crm' }));

const result = await loft.chat.generate({
  sessionId,
  directMessages,
  additionalTools: guardTools([lookupOrderTool], guards)
});
```

Install every part:
- **Each installer.** `applyMiddleware` alone leaves tool outputs and traces unguarded. As a check, `applyMiddleware` warns once, on the first request, when a guard masks traces but the chat's tracer does not apply its mask. Nothing checks the tools: wrap every MCP client, and every additional tool on every `generate()` call.
- **Guards before your own middleware.** LOFT runs middleware in the order it was registered, and a middleware that does not call `chain.next()` ends the chain. Call `applyMiddleware` before you register your own middleware, so that the guards run first. Middleware registered after the guards sees the guarded request, and what it adds to it is not checked.
- **The same order everywhere.** Each guard registers its chat hooks under its own name (`pii-redaction`, `injection-guard`), so a chat can hold each guard once. Put the PII guard first: with its `input` and `toolResults` options on, the injection guard's detectors, which may be a hosted service, then see redacted text. Without them, they see the original text.

`serverName` is passed to the hooks with each tool output, as `ToolInfo.serverName`.

## PII redaction

`piiRedaction()` finds e-mail addresses, payment card numbers and IBANs:
- e-mail addresses, with letters of any script and the symbols RFC 5322 allows before the `@`, such as `o'brien@example.com`, except `*`, which `strategy: 'mask'` writes. A symbol written right before an address, as in `user=jane@example.com`, is redacted with it;
- payment card numbers: 13 to 19 digits that start with 2 to 6, as the major networks do, checked with Luhn. A card number is found next to other numbers too, such as a security code or an expiry date. About one in ten other numbers of a card's length passes these checks, so long numeric ids can be redacted;
- IBANs: in capitals or not, grouped by spaces or hyphens, checked by country length and mod-97.

It replaces each finding with a placeholder such as `[REDACTED:EMAIL]`, or, with `strategy: 'mask'`, with a starred copy such as `**** **** **** 1111`. In objects, such as tool arguments and trace metadata, it also checks the keys, and numbers as text: a card number written as a JSON number becomes the placeholder string.

**Choose what to keep the data from.** Each option keeps the values from someone else, at a different cost:

| Option | Keeps the values from | Cost |
|---|---|---|
| `traces` (default on) | the tracing vendor | none: the model and the history keep the real values |
| `input` (off by default) | the model provider and the history; the traces too only with `traces` on, as the trace of the Input middleware records the request it received | **the real values are gone for good**: history stores the placeholder, and a tool that needs the value, such as an e-mail address to send a confirmation to, receives the placeholder |
| `toolResults` (off by default) | the model provider and the stored tool messages | the model cannot read the values a tool returns |
| `output` (off by default) | the stored reply and tool calls, and the streamed text under the default text policy | streamed text is held back until the reply is complete, because the text policy defaults to `'after-middleware'` (see [Streaming](./streaming.md)). A caller that sets the text policy to `'all'`, per call or in the chat config, gets the reply text unredacted as it streams |

With the defaults, `piiRedaction()` has only a trace mask, so it does nothing unless the tracer factory is wrapped with `maskTracerFactory`.

LOFT's logs at `info` level and above do not carry message text, with two exceptions:
- the warning or error for a failed tool carries the tool's error text. With `toolResults` on, `guardMcpClient` and `guardTool` redact that text before LOFT sees it;
- the error logged for a failed `generate()` call, and the `GenerateError` it rejects with, carry the error it failed with. A provider's error message can repeat part of the request.

At `debug` and `trace` level, LOFT logs tool arguments and outputs; keep those levels off in production, or mask in your own logger strategy.

The trace mask covers the input, output, metadata, status message, comment, user id and tags of every trace call. It does not mask names (a tool span is named after the tool), model names or model parameters. A value nested more than 64 levels deep becomes `[truncated]`, and a string becomes `[mask failed]` when a detector throws, so a faulty detector loses trace data instead of stopping the chat.

The trace mask runs synchronously in each tracer call, and LOFT sends the same request to the tracer several times per `generate()`. The built-in detectors run in linear time. On a laptop they took about 50 to 150 ms per megabyte, of text or of an encoded image, so a request with a large image adds that much to each tracer call; measure with your own data.

**Detectors.** Add `ipv4Detector()` to find IPv4 addresses; it is opt-in because version numbers can look like addresses. Write your own with `regexDetector(type, pattern, validate?)` or the `PiiDetector` interface:

```typescript
import { defaultPiiDetectors, piiRedaction, regexDetector } from '@moc-global/loft-middleware/pii';

const customerId = regexDetector('CUSTOMER_ID', /\bCUST-\d{6}\b/g);
piiRedaction({ detectors: [...defaultPiiDetectors(), customerId] });
```

Detectors must:
- be synchronous, because tracer calls are synchronous;
- run in linear time on any input;
- not find the placeholders or masked values, because the redactor runs again until the text no longer changes.

**Reporting.** `onDetect` receives `{ type, count, stage }` once per type each time a stage runs: per Input middleware run, per tool output and per reply. It is not called for trace masking, and never receives the value. Log it to see what the guard does. An error it throws is logged, and redaction goes on.

**Does not protect against:**
- names, postal addresses and other free text: the detectors are patterns. Wrap an NER model or a hosted service in a `PiiDetector` for those;
- data in images, audio or binary resources;
- values the model writes into the arguments of a tool call, which run before the reply is redacted, and the `tool-call` events that carry those arguments when the caller streams with `include.toolCalls: 'args'`;
- with `output` on: reasoning text, which streams as it arrives when the caller asks for it with `include.reasoning`; the reply text when the caller sets the text policy to `'all'`; and the `data` events a tool emits through `context.emit`, which are the tool's own;
- e-mail addresses written with `%40`, a full-width `＠` or an invisible character inside (the part before it stays), the start of a local part longer than 64 characters, card numbers grouped by dots or several spaces, and digits outside ASCII;
- with `output` on, the provider's raw reply in `result.messages.llmResponse.originalResponse`, which is not stored but is returned;
- history stored before the guard was installed, and the system prompt;
- `context.aiTask()` and `context.generate()` calls made from your own middleware;
- Focus tools and the Focus prompt, which LOFT builds itself;
- your application's own logs.

## Prompt-injection detection

`injectionGuard()` checks user messages, tool outputs, MCP tool descriptions and, with `augmentedContext: true`, the augmented context:

- **A flagged user message** is replaced by `[message removed: possible prompt injection]`. Its finding is recorded in `message.ctx.loftGuard.injection`, and, by default (`quarantine: true`), it is marked `llmIgnore`, so no later turn sends it to the model. This happens in the Input middleware, so it also works when you call `addMessages()` before `generate()`.
- **When the newest user message is flagged**, `generate()` answers with a fixed message (`blockMessage`) without calling the model. With `onUserFlag: 'throw'`, it rejects before any event instead, so an HTTP handler can answer with a 4xx:

  ```typescript
  import { findInjectionDetected } from '@moc-global/loft-middleware/injection';

  try {
    await loft.chat.generate({ sessionId, directMessages, onEvent });
  } catch (error) {
    if (findInjectionDetected(error)) return res.status(422).json({ error: 'Message rejected' });
    throw error;
  }
  ```

- **A flagged tool output** is replaced by `[tool output withheld: possible prompt injection]` and marked as an error, so the model carries on without it.
- **A flagged MCP tool** keeps that tool out of the tool list. The guard reads the texts the model reads: the tool's name, title, description, annotations and input schema, property names included. It checks them when LOFT fetches the tool list, which LOFT caches (`ChatConfig.mcp.toolCacheTtl`). A hook that fails, or a detector that fails under `onDetectorError: 'flag'`, leaves tools out.
- **A flagged augmented-context message**, such as a retrieved document, is replaced by `[context withheld: possible prompt injection]` and marked `llmIgnore`; the reply goes on. This check is off by default, because the augmented context often carries your own instructions, which the checks may flag. Turn it on when it carries text from outside.

Call `result.messages.save()` after a blocked reply, as after any reply. Only the newest user message decides whether `generate()` is blocked, so the next clean message is answered.

The guard checks messages with the `user` role only, and skips the authors in `ignoreAuthors`. Do not let a client choose the role, the author or the `ctx` of the messages it sends. A `ctx.loftGuard` record on a message whose text is not the placeholder is not trusted: the message is checked again, and the record is removed when the message is clean.

`user`, `toolResults` and `toolDescriptions` (each on by default) turn the checks off one by one.

With `@moc-global/loft-agents`, a node passes the answer of the node before it as a user message with the author `agent`, so the guard checks it like a user's message. A node's answer can carry an attack from a tool output it read, so keep the check on. Add `agent` to `ignoreAuthors` only when the checks block the answers of your own nodes.

**Detectors.** The default, `heuristicDetector()`, runs locally and finds:
- instructions to ignore earlier instructions;
- chat-template role markers;
- requests for the system prompt;
- persona overrides;
- hidden Unicode characters: tag characters, outside the flag emoji written with them, and bidirectional overrides. Bidirectional isolates are left alone, as right-to-left names are wrapped in them.

It normalises the text first (NFKC, invisible separators such as zero-width spaces and joiners removed), and also reads it with its lines and text parts joined, so an attack split across them is found. Add your own patterns with `heuristicDetector({ patterns })`.

For better recall, add a model-based detector through the `InjectionDetector` interface, such as a hosted service or a classifier. It may be asynchronous:
- `timeoutMs` (default 5000, at most 2³¹−1) bounds it;
- `onDetectorError` decides what a failure, a timeout or an answer that is not a verdict means. The default, `'flag'`, treats the text as flagged, so an outage of a hosted detector blocks messages, withholds tool outputs and empties the tool list. `'allow'` treats it as clean. Either way, what the other detectors found still counts.

An error that `onDetect` throws is logged, and the guard goes on. `findInjectionDetected` also finds the error when the application loads both the CommonJS and the ES module build of the package.

**Does not protect against:**
- paraphrased, translated, encoded or novel attacks, and attacks split across several messages: every detector can be evaded;
- the augmented context, unless `augmentedContext` is on, data that a tool interceptor returns without calling the tool, and the `data` events a tool emits;
- instructions in images or documents the model reads natively;
- the harm a tool can do. Give tools the least access they need, and ask a person to confirm actions with side effects;
- the model revealing its system prompt in a reply: there is no output check.

Traces keep the original text of a flagged message, which is useful for an audit. Install `piiRedaction` with its trace mask if traces must not hold personal data.

## Without the package

For one-file middleware that needs no package, such as logging counts, tagging messages or blocking topics, see the recipes in [examples/middleware](../../examples/middleware/) and the [Middleware guide](./middleware.md).
