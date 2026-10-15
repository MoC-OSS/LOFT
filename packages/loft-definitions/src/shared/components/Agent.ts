import type { Tracer } from '../../strategies/tracer/TracerFactory';
import type * as Chat from './Chat';

// ──────────────────────────────────────────────
// Enums
// ──────────────────────────────────────────────

export enum AgentMessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  SYSTEM = 'SYSTEM'
}

export enum TransitionType {
  SINGLE = 'SINGLE',
  FAN_OUT = 'FAN_OUT',
  TERMINAL = 'TERMINAL'
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

export const FANOUT_REJECTED_KEY = '__fanout.rejected';

// ──────────────────────────────────────────────
// Message
// ──────────────────────────────────────────────

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  data?: Record<string, unknown>;
}

// ──────────────────────────────────────────────
// Transitions
// ──────────────────────────────────────────────

export interface TransitionDef {
  name: string;
  description: string;
  target: string | null;
}

export interface TransitionSingle {
  type: TransitionType.SINGLE;
  target: string;
}

export interface TransitionFanOut {
  type: TransitionType.FAN_OUT;
  targets: string[];
}

export interface TransitionTerminal {
  type: TransitionType.TERMINAL;
}

export type Transition = TransitionSingle | TransitionFanOut | TransitionTerminal;

// ──────────────────────────────────────────────
// Node Result
// ──────────────────────────────────────────────

export interface NodeResult {
  output: AgentMessage;
  transition: Transition;
}

// ──────────────────────────────────────────────
// SharedContext / ScopedContext interfaces
// ──────────────────────────────────────────────

export interface ScopedContextInterface {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
}

export interface SharedContextInterface {
  readonly sessionId: string;
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  keys(): string[];
  delete(key: string): boolean;
  for(agentName: string): ScopedContextInterface;
}

// ──────────────────────────────────────────────
// Node interface
// ──────────────────────────────────────────────

export interface NodeRunOptions {
  /** Aborted when the node times out or the orchestrator run is cancelled; pass it on to generate(). */
  signal?: AbortSignal;
}

export interface Node {
  readonly name: string;
  readonly transitions: TransitionDef[];
  run(
    message: AgentMessage,
    sharedContext: SharedContextInterface,
    sessionId: string,
    options?: NodeRunOptions
  ): Promise<NodeResult>;
}

// ──────────────────────────────────────────────
// Transition Resolver
// ──────────────────────────────────────────────

export type TransitionResolver = (result: Chat.GenerateResult, transitions: TransitionDef[]) => Transition;

// ──────────────────────────────────────────────
// Focus
// ──────────────────────────────────────────────

export enum FocusFieldType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  ENUM = 'ENUM',
  DATE = 'DATE'
}

export interface FocusField {
  key: string;
  type: FocusFieldType;
  values?: string[];
  required: boolean;
  default?: unknown;
  description: string;
  validate?: (value: unknown) => boolean | string;
}

export enum FocusActionType {
  TRANSITION = 'TRANSITION',
  TOOL = 'TOOL'
}

export type FocusAction =
  { type: FocusActionType.TRANSITION; target: string } | { type: FocusActionType.TOOL; toolName: string };

export interface ResolveFieldsContext {
  fields: FocusField[];
  filled: Record<string, unknown>;
}

export interface Focus {
  agentName: string;
  prompt: string;
  fields: FocusField[];
  resolveFields?: (context: ResolveFieldsContext) => FocusField[];
  onComplete: FocusAction;
}

export interface FocusStatus {
  agentName: string;
  filled: Record<string, unknown>;
  missing: string[];
  hasData: boolean;
  ready: boolean;
}

export enum FocusClassification {
  ON_FOCUS = 'ON_FOCUS',
  OFF_FOCUS = 'OFF_FOCUS',
  UNKNOWN = 'UNKNOWN'
}

export interface FocusAware {
  focus(): Focus | undefined;
}

// ──────────────────────────────────────────────
// Policies
// ──────────────────────────────────────────────

export interface RetryPolicy {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier?: number;
  retryOn?: (error: Error) => boolean;
}

export interface TimeoutPolicy {
  timeoutMs: number;
}

export interface NodePolicy {
  retry?: RetryPolicy;
  timeout?: TimeoutPolicy;
}

export enum ErrorStrategy {
  FAIL_FAST = 'fail-fast',
  CONTINUE = 'continue'
}

export interface OrchestratorRunOptions {
  /** Cancels the run: in-flight nodes receive the abort and no further node starts. */
  signal?: AbortSignal;
}

export interface OrchestratorOptions {
  errorStrategy?: ErrorStrategy;
  nodePolicies?: Map<string, NodePolicy>;
  tracer?: Tracer;
  metricsCallback?: (metrics: OrchestratorMetrics) => void;
  cycleDetection?: boolean;
}

// ──────────────────────────────────────────────
// Metrics
// ──────────────────────────────────────────────

export interface NodeUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost?: number;
  model?: string;
}

export interface NodeMetrics {
  nodeName: string;
  durationMs: number;
  retryCount: number;
  usage?: NodeUsageMetrics;
  error?: Error;
}

export interface OrchestratorMetrics {
  orchestratorDurationMs: number;
  transitionPath: string[];
  depthReached: number;
  nodeMetrics: NodeMetrics[];
}

export interface NodeMetricsAware {
  getLastMetrics(): { usage: NodeUsageMetrics } | undefined;
}

// ──────────────────────────────────────────────
// Focus State Store
// ──────────────────────────────────────────────

export interface FocusStateStore {
  get<T = unknown>(sessionId: string, agentName: string, fieldKey: string): Promise<T | undefined>;
  getAll(sessionId: string, agentName: string): Promise<Record<string, unknown>>;
  set<T = unknown>(sessionId: string, agentName: string, fieldKey: string, value: T): Promise<void>;
  delete(sessionId: string, agentName: string, fieldKey: string): Promise<void>;
  clear(sessionId: string, agentName: string): Promise<void>;
  clearAll(sessionId: string): Promise<void>;
}
