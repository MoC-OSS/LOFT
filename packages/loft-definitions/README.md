# @moc-global/loft-definitions

Shared types, interfaces, Zod schemas, dependency injection symbols and the logger of [LOFT](https://github.com/MoC-OSS/LOFT). Every other LOFT package depends on it. You use it to type your middleware, implement your own repository or strategy, and configure logging.

## Install

```bash
npm install @moc-global/loft-definitions inversify@^6 zod@^3.25.67 @modelcontextprotocol/sdk
```

It is a peer dependency of the other LOFT packages, so your application installs one copy and shares it with them.

## Usage

Most types live in namespaces: `Type`, `Interface`, `Strategy`, `Repository`, `Schema` and `Chat`. The middleware types are top-level exports. This input middleware drops empty messages before they are stored:

```typescript
import { ContextInterface, GenerateRequestParameters, Logger, StandardMiddleware } from '@moc-global/loft-definitions';

const log = new Logger('DropEmptyMessages');

export const dropEmptyMessages: StandardMiddleware<ContextInterface, GenerateRequestParameters> = async (
  context,
  payload,
  chain
) => {
  const kept = payload.directMessages.filter((message) => message.content.length > 0);
  if (kept.length < payload.directMessages.length) {
    log.info(`Dropped ${payload.directMessages.length - kept.length} empty messages`);
  }
  chain.next();
  return { ...payload, directMessages: kept };
};
```

Register it with `chatConstructor.registerInputMiddleware('drop-empty', dropEmptyMessages)` from `@moc-global/loft`.

## Main exports

| Export | What it holds |
| --- | --- |
| `Type` | Entities (`Session`, `Message`, content parts) and the unified LLM message types |
| `Interface` | Constructor, manager, logger and MCP interfaces; `LogLevel` |
| `Strategy` | Interfaces for LLM, call manager, tracer and queue strategies; `AbstractLoftLLM` |
| `Repository` | Interfaces for session, chat history and object storage repositories |
| `Schema` | Zod schemas for the same entities |
| `Chat` | Chat types, such as `Chat.ChatInterface` and `Chat.GenerateResultMessages` |
| `DI_TYPES` | Inversify symbols for every binding |
| `Logger`, `PinoLoggerStrategy` | The logger LOFT uses, and its default Pino output |
| `NativeCallManagerStrategy` | Connects a provider strategy to an in-process call manager |
| `ContextInterface`, `StandardMiddleware`, `GenerateRequestParameters` | Middleware types: the context and payload each stage receives |

`HttpCallManagerStrategy` is exported but needs a call manager service that is not part of LOFT.

## Logging

`Logger` is configured once for the whole process, by `LoftConstructor` or directly with `Logger.configure({ logLevel, loggerStrategy })`. Logs are JSON lines. The package's `log-format` command makes them readable:

```bash
node app.js | npx log-format
```

## Documentation

- [Core concepts](https://github.com/MoC-OSS/LOFT/blob/main/docs/getting-started/core-concepts.md) and [dependency injection](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/dependency-injection.md)
- [DI symbols](https://github.com/MoC-OSS/LOFT/blob/main/docs/reference/di-symbols.md) and [configuration types](https://github.com/MoC-OSS/LOFT/blob/main/docs/reference/configuration.md)
- [Strategy pattern](https://github.com/MoC-OSS/LOFT/blob/main/docs/concepts/strategy-pattern.md): how to write your own repository or provider strategy

## License

[MIT](./LICENSE). `src/schemas/entities/MCP_SDK_Types.ts` is copied from the MCP TypeScript SDK under its MIT license; see [NOTICE](./NOTICE).
