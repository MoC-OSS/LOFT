# ADR-004: Production Hardening — Retry, Timeout, Error Strategy, Cycle Detection

## Status

Accepted

## Context

LLM calls are unreliable — they can timeout, return transient errors, or get stuck in loops. The orchestrator needs per-node resilience without coupling policies to agent logic. Requirements:

- Retry flaky nodes (e.g., external API calls) without retrying deterministic ones (e.g., formatters)
- Bound execution time per node
- Handle partial failures in parallel execution gracefully
- Detect infinite loops in the transition graph

## Decision

Four orthogonal, declarative policies applied at the orchestrator execution layer. Policies are configured per-node via the builder, composed at execution time, and fully observable through tracing.

### Per-Node Policy Binding

```typescript
// packages/loft-agents/src/core/OrchestratorBuilder.ts
addNode(node: Agent.Node, policy?: Agent.NodePolicy): this

// Example: express-agents orchestrator
.addNode(createFlightsAgent(loft), { retry: { maxRetries: 2, delayMs: 1000, backoffMultiplier: 2 } })
.addNode(createHotelsAgent(loft), { timeout: { timeoutMs: 30000 } })
.addNode(createActivitiesAgent(loft))  // no policy — runs unprotected
```

### Policy Composition

```typescript
// packages/loft-agents/src/core/Orchestrator.ts:216-231
const baseFn = () => node.run(message, sharedContext, sessionId);

if (!policy?.retry && !policy?.timeout) {
  result = await baseFn();
} else {
  const timeoutWrapped = policy.timeout
    ? () => withTimeout(baseFn, policy.timeout!, node.name)
    : baseFn;

  if (policy.retry) {
    const retryResult = await withRetry(timeoutWrapped, policy.retry, node.name, retryCallback);
    result = retryResult.result;
    retryCount = retryResult.retryCount;
  } else {
    result = await timeoutWrapped();
  }
}
```

Composition order: `withTimeout(withRetry(baseFn))` — each retry attempt is individually bounded by the timeout.

---

### 1. Retry Policy

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:165-170
export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
  retryOn?: (error: Error) => boolean;
}
```

Implementation:

```typescript
// packages/loft-agents/src/policies/RetryPolicy.ts:7-45
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: Agent.RetryPolicy,
  nodeName: string,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void
): Promise<{ result: T; retryCount: number }> {
  let lastError: Error;
  for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
    try {
      const result = await fn();
      return { result, retryCount: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (policy.retryOn && !policy.retryOn(lastError)) throw lastError;  // non-retryable
      if (attempt === policy.maxRetries) break;                           // exhausted

      const delay = policy.delayMs * Math.pow(policy.backoffMultiplier ?? 1, attempt);
      onRetry?.(attempt, lastError, delay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new NodeRetryExhaustedError(nodeName, policy.maxRetries, lastError!);
}
```

- Exponential backoff: `delayMs * (backoffMultiplier ^ attempt)`
- Optional `retryOn` filter: skip retries for non-transient errors (e.g., validation failures)
- Returns `{ result, retryCount }` for metrics
- `onRetry` callback logs each attempt as a tracer event

---

### 2. Timeout Policy

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:172-174
export interface TimeoutPolicy {
  timeoutMs: number;
}
```

Implementation:

```typescript
// packages/loft-agents/src/policies/TimeoutPolicy.ts:5-22
export function withTimeout<T>(
  fn: () => Promise<T>,
  policy: Agent.TimeoutPolicy,
  nodeName: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new NodeTimeoutError(nodeName, policy.timeoutMs)),
      policy.timeoutMs
    );
    fn()
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((error) => { clearTimeout(timer); reject(error); });
  });
}
```

- `Promise.race` pattern with timer
- Throws `NodeTimeoutError` on expiry
- **Does NOT cancel the underlying operation** — the LLM call continues in the background (Promise-level only)

---

### 3. Error Strategy (Fan-Out Handling)

```typescript
// packages/loft-definitions/src/shared/components/Agent.ts:181-184
export enum ErrorStrategy {
  FAIL_FAST = 'FAIL_FAST',
  CONTINUE = 'CONTINUE'
}
```

Applied in fan-out execution:

```typescript
// packages/loft-agents/src/core/Orchestrator.ts:126-166
const settled = await Promise.allSettled(
  nodes.map(({ node }) => this.executeNode(node, message, ...))
);

// Separate fulfilled vs rejected
if (rejected.length > 0) {
  if (this.errorStrategy === Agent.ErrorStrategy.CONTINUE && fulfilled.length > 0) {
    // Store rejections in SharedContext for downstream inspection
    sharedContext.set(Agent.FANOUT_REJECTED_KEY, rejected.map(r => ({
      nodeName: r.nodeName,
      error: r.error.message
    })));
    // Proceed with successful results
  } else {
    throw new FanOutPartialError(fulfilled, rejected);
  }
}
```

| Strategy | Behavior | Use case |
|----------|----------|----------|
| `FAIL_FAST` | Any fan-out failure → throw `FanOutPartialError` | Critical paths where all results needed |
| `CONTINUE` | Proceed with successful results, store rejections under `__fanout.rejected` | Best-effort search (e.g., flights fail but hotels + activities succeed) |

---

### 4. Cycle Detection

```typescript
// packages/loft-agents/src/core/Orchestrator.ts:260-280
private detectCycle(sequence: string[]): void {
  const len = sequence.length;
  const maxPattern = Math.min(Orchestrator.MAX_CYCLE_PATTERN_LENGTH, Math.floor(len / 2));
  for (let patternLen = 2; patternLen <= maxPattern; patternLen++) {
    const pattern = sequence.slice(len - patternLen);
    const previous = sequence.slice(len - patternLen * 2, len - patternLen);
    if (pattern.every((name, i) => name === previous[i])) {
      this.log.warn(`Cycle detected: ${pattern.join(' → ')} repeated`);
      return;
    }
  }
}
```

- Opt-in via `setCycleDetection(true)` on OrchestratorBuilder
- Scans node sequence for repeating patterns of length 2 to 10
- **Warning only** (non-fatal) — logs and continues
- Combined with `maxDepth` as a hard stop

---

### Observability

All policies integrate with tracing and metrics:

```typescript
// packages/loft-agents/src/observability/TracingIntegration.ts
export function logRetryEvent(span, nodeName, attempt, error, delayMs): void {
  span.event({
    name: `retry/${nodeName}`,
    input: { attempt, error: error.message, delayMs }
  });
}
```

```typescript
// packages/loft-agents/src/observability/Metrics.ts
// MetricsCollector records per-node: durationMs, retryCount, error, usage
```

Metrics output example:
```
========== ORCHESTRATOR METRICS ==========
Total Duration: 34000ms
Depth Reached:  5
Transition Path: intake -> dispatcher -> flights-agent -> hotels-agent -> activities-agent -> planning-team -> response
  flights-agent: 5300ms (retries: 1)
  hotels-agent: 10500ms
  activities-agent: 15800ms
==========================================
```

## Alternatives Considered

### Circuit Breakers
- Track failure rates, open circuit after threshold
- Rejected: Orchestrator runs are bounded and short-lived — no sustained traffic to trip a breaker

### Bulkheads
- Isolate resource pools per node
- Rejected: Nodes don't share resources; each is an independent LLM API call

### Global Retry Policy
- Single retry config for all nodes
- Rejected: Too coarse — flaky search agents need retry with backoff, deterministic formatters don't need retry at all

### Parallel Retries
- Retry by launching multiple attempts simultaneously
- Rejected: Wastes LLM API tokens; serial retries are sufficient for transient errors

## Consequences

### Positive
- Policies are declarative and per-node — configured at build time, not in agent code
- Composable: retry + timeout work together cleanly
- Observable: every retry attempt and timeout logged as tracer events
- ErrorStrategy.CONTINUE enables graceful degradation in fan-out scenarios

### Negative
- Retries are serial — slow for high-latency LLM calls (e.g., 3 retries × 10s = 30s)
- Timeout doesn't cancel I/O — the underlying LLM call continues consuming resources
- Cycle detection is pattern-based heuristic, not a formal graph analysis
- No intelligent fallback routing (e.g., switch to a different LLM provider on failure)

## References

- `packages/loft-agents/src/policies/RetryPolicy.ts`
- `packages/loft-agents/src/policies/TimeoutPolicy.ts`
- `packages/loft-agents/src/core/Orchestrator.ts` (executeNode, executeFanOut, detectCycle)
- `packages/loft-agents/src/core/OrchestratorBuilder.ts` (per-node policy binding)
- `packages/loft-agents/src/observability/Metrics.ts`
- `packages/loft-agents/src/observability/TracingIntegration.ts`
- `packages/loft-agents/src/errors/` (NodeRetryExhaustedError, NodeTimeoutError, FanOutPartialError)
- `packages/loft-definitions/src/shared/components/Agent.ts` (RetryPolicy, TimeoutPolicy, ErrorStrategy)
- `packages/loft-agents/src/__tests__/unit/RetryPolicy.test.ts`
- `packages/loft-agents/src/__tests__/unit/TimeoutPolicy.test.ts`
- `packages/loft-agents/src/__tests__/unit/ErrorStrategy.test.ts`
- `packages/loft-agents/src/__tests__/unit/CycleDetection.test.ts`
