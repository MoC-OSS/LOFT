# Agent Orchestration — Flow Diagrams

> These diagrams reflect the **current implementation** (Phase 1 Core + Phase 2 Focus + Phase 3 Team + Phase 4 Hardening).

## 1. Sequential Chain: Router → Expert → Critic

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'secondaryColor': '#2d2714', 'tertiaryColor': '#1a3326', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555', 'clusterBkg': '#1a1a2e', 'clusterBorder': '#444', 'edgeLabelBackground': '#1e1e2e'}}}%%
sequenceDiagram
    actor User
    participant O as Orchestrator
    participant SC as SharedContext
    participant R as Router Node<br/>(Haiku)
    participant E as Expert Node<br/>(Sonnet)
    participant C as Critic Node<br/>(Opus)

    User->>O: run("I want to insure a Toyota Camry 2020", sessionId)

    Note over O: depth = 0
    O->>SC: create (empty, sessionId)

    rect rgba(30, 58, 95, 0.3)
        Note over O,R: Step A — Router
        O->>R: run(message, sharedContext, sessionId)
        R->>R: loft.chat.generate({ sessionId, directMessages, augmentedContext })
        R->>SC: set("router.intent", "quote")
        R-->>O: { output, transition: Single("expert") }
    end

    Note over O: depth = 1

    rect rgba(26, 51, 38, 0.3)
        Note over O,E: Step B — Expert
        O->>E: run(routerOutput, sharedContext, sessionId)
        Note over E: augmentedContext injected:<br/>SharedContext: { router.intent: "quote" }
        E->>E: loft.chat.generate()
        E->>SC: set("expert.quote", { vehicle: "Camry", year: 2020 })
        E-->>O: { output, transition: Single("critic") }
    end

    Note over O: depth = 2

    rect rgba(63, 30, 30, 0.3)
        Note over O,C: Step C — Critic
        O->>C: run(expertOutput, sharedContext, sessionId)
        C->>SC: read("expert.quote")
        Note over C: Verifies: data correct,<br/>response clear, no hallucination
        C->>SC: set("critic.verdict", "approved")
        C-->>O: { output: final response, transition: Terminal }
    end

    Note over SC: DESTROYED (ephemeral, per-run only)
    O-->>User: "Your quote: full coverage, $12,500/year"
```

## 2. Parallel Flow (FanOut)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'secondaryColor': '#2d2714', 'tertiaryColor': '#1a3326', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555', 'clusterBkg': '#1a1a2e', 'clusterBorder': '#444', 'edgeLabelBackground': '#1e1e2e'}}}%%
sequenceDiagram
    actor User
    participant O as Orchestrator
    participant SC as SharedContext
    participant G as Generator
    participant FC as Fact Checker
    participant TC as Tone Checker
    participant S as Synthesis

    User->>O: run(message, sessionId)

    rect rgba(30, 58, 95, 0.3)
        Note over O,G: Step A — Generate draft
        O->>G: run(message, sharedContext, sessionId)
        G->>SC: set("generator.draft", "...")
        G-->>O: { transition: FanOut(["fact-checker", "tone-checker"]) }
    end

    rect rgba(63, 30, 30, 0.3)
        Note over O,TC: Step B — Parallel check (Promise.allSettled)
        par fact-checker
            O->>FC: run(message, sharedContext, sessionId)
            FC->>SC: read("generator.draft")
            FC->>SC: set("fact-checker.verdict", "ok")
            FC-->>O: { transition: Single("synthesis") }
        and tone-checker
            O->>TC: run(message, sharedContext, sessionId)
            TC->>SC: read("generator.draft")
            TC->>SC: set("tone-checker.verdict", "fix")
            TC->>SC: set("tone-checker.note", "too formal")
            TC-->>O: { transition: Single("synthesis") }
        end
        Note over O: If any node rejected →<br/>FanOutPartialError (carries fulfilled + rejected)
    end

    Note over O: FanOut counts as 1 depth step

    Note over SC: After FanOut:<br/>generator.draft = "..."<br/>fact-checker.verdict = ok<br/>tone-checker.verdict = fix<br/>tone-checker.note = too formal

    rect rgba(26, 51, 38, 0.3)
        Note over O,S: Step C — Synthesize results
        O->>S: run(message, sharedContext, sessionId)
        S->>SC: read all results
        Note over S: fact-checker OK<br/>tone-checker: fix tone<br/>→ adjust and finalize
        S-->>O: { output: adjusted response, transition: Terminal }
    end

    O-->>User: final response
```

## 3. Focus Multi-Turn Collection Flow

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'secondaryColor': '#2d2714', 'tertiaryColor': '#1a3326', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555', 'clusterBkg': '#1a1a2e', 'clusterBorder': '#444', 'edgeLabelBackground': '#1e1e2e'}}}%%
sequenceDiagram
    actor User
    participant O as Orchestrator
    participant IN as Intake Node<br/>(Focus-enabled)
    participant FS as FocusStateStore<br/>(persistent)
    participant Q as Quote Node

    Note over IN: Focus: vehicleType (required),<br/>year (required), coverage (required)<br/>onComplete: transition → quote

    User->>O: run("I want to insure my Toyota Camry", sessionId)

    rect rgba(26, 51, 38, 0.3)
        Note over O,IN: Run 1 — partial data collection
        O->>IN: run(message, sharedContext, sessionId)
        IN->>FS: getAll(sessionId, "intake") → {}
        Note over IN: FocusStatus: ready=false, missing=[vehicleType, year, coverage]
        Note over IN: Injects Focus prompt + 3 Focus tools as AdditionalTools
        IN->>IN: loft.chat.generate()
        Note over IN: LLM calls update_focus_intake(vehicleType: "Toyota Camry")
        IN->>FS: set(sessionId, "intake", "vehicleType", "Toyota Camry")
        IN->>FS: getAll(sessionId, "intake") → { vehicleType: "Toyota Camry" }
        Note over IN: FocusStatus: ready=false → no transition override
        IN-->>O: { output: "What year?", transition: Terminal }
    end

    O-->>User: "What year is your Toyota Camry?"

    User->>O: run("2020, and I want premium coverage", sessionId)

    rect rgba(26, 51, 38, 0.3)
        Note over O,Q: Run 2 — collection complete → auto-transition
        O->>IN: run(message, sharedContext, sessionId)
        IN->>FS: getAll → { vehicleType: "Toyota Camry" }
        Note over IN: FocusStatus: missing=[year, coverage]
        IN->>IN: loft.chat.generate()
        Note over IN: LLM calls update_focus_intake(year: "2020", coverage: "premium")
        IN->>FS: set "year" = 2020 (coerced from string)
        IN->>FS: set "coverage" = "premium" (validated against enum)
        IN->>FS: getAll → { vehicleType, year, coverage }
        Note over IN: FocusStatus: ready=true → the node's onFocusComplete fires
        Note over IN: Transition overridden: Terminal → Single("quote")
        IN-->>O: { output, transition: Single("quote") }
        O->>Q: run(output, sharedContext, sessionId)
        Q-->>O: { output: "$12,500/year", transition: Terminal }
    end

    O-->>User: "Your quote: premium coverage, $12,500/year"
```

## 4. Team Execution (Encapsulated Sub-Graph)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'secondaryColor': '#2d2714', 'tertiaryColor': '#1a3326', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555', 'clusterBkg': '#1a1a2e', 'clusterBorder': '#444', 'edgeLabelBackground': '#1e1e2e'}}}%%
sequenceDiagram
    actor User
    participant PO as Parent Orchestrator
    participant PSC as Parent SharedContext
    participant TN as TeamNode<br/>(review-team)
    participant TSC as Team SharedContext<br/>(isolated)
    participant FC as Fact Checker
    participant TC as Tone Checker
    participant S as Synthesis
    participant PUB as Publisher

    User->>PO: run(message, sessionId)

    rect rgba(30, 58, 95, 0.3)
        Note over PO,TN: Step 1 — Writer produces draft
        PO->>PSC: set("writer.draft", "...")
        PO->>TN: run(writerOutput, parentSharedContext, sessionId)
    end

    rect rgba(26, 51, 38, 0.3)
        Note over TN,S: Step 2 — Team creates isolated context
        TN->>TSC: create NEW SharedContext(sessionId)
        TN->>TSC: set("__team.systemPrompt", "You are a review team")

        Note over TN,FC: Internal orchestrator runs (invisible to parent)
        TN->>FC: run(message, teamSharedContext, sessionId)
        FC->>TSC: set("fact-checker.verdict", "ok")
        FC-->>TN: { transition: Single("tone-checker") }

        TN->>TC: run(message, teamSharedContext, sessionId)
        TC->>TSC: set("tone-checker.verdict", "fix tone")
        TC-->>TN: { transition: Single("synthesis") }

        TN->>S: run(message, teamSharedContext, sessionId)
        S->>TSC: read all verdicts
        S-->>TN: { output: "Approved with edits", transition: Terminal }

        Note over TSC: Team SharedContext DESTROYED
    end

    Note over PSC: Parent SharedContext UNCHANGED<br/>(no team keys leaked)
    TN-->>PO: { output: "Approved with edits", transition: Single("publisher") }

    rect rgba(63, 30, 30, 0.3)
        Note over PO,PUB: Step 3 — Continue in parent orchestrator
        PO->>PUB: run(teamOutput, parentSharedContext, sessionId)
        PUB-->>PO: { output: "Published!", transition: Terminal }
    end

    PO-->>User: "Published!"
```

**Key properties:**
- Team creates a **fresh SharedContext** — parent context is never passed in
- Team system prompt is stored in internal context as `__team.systemPrompt`
- Parent SharedContext has **zero modifications** after team runs
- Only the final `NodeResult` surfaces to the parent orchestrator
- Teams can be **nested** — a team inside a team gets triple context isolation

## 5. Data Lifecycle

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555'}}}%%
graph LR
    subgraph run1[" Run 1 (orchestrator.run) "]
        SC1["SharedContext<br/>(ephemeral, in-memory)<br/>router.intent = quote<br/>expert.quote = ..."]
    end

    subgraph between[" Between Runs "]
        SC_DEAD["SharedContext<br/>DESTROYED"]
        CH_ALIVE["Chat History<br/>PERSISTED (managed by caller)"]
        FS_ALIVE["Focus State Store<br/>PERSISTED (per session+agent)"]
    end

    subgraph run2[" Run 2 (orchestrator.run) "]
        SC2["SharedContext<br/>NEW, EMPTY<br/>builds fresh data"]
    end

    SC1 --> SC_DEAD
    SC_DEAD -.->|fresh instance| SC2
    CH_ALIVE -->|available via LOFT| run2
    FS_ALIVE -->|loaded by Focus nodes| run2

    style SC1 fill:#2d2714,stroke:#e6a817,color:#e0e0e0
    style SC_DEAD fill:#3d1f1f,stroke:#e53935,color:#e0e0e0
    style SC2 fill:#2d2714,stroke:#e6a817,color:#e0e0e0
    style CH_ALIVE fill:#1e3a5f,stroke:#4a7dff,color:#e0e0e0
    style FS_ALIVE fill:#1a3326,stroke:#4caf50,color:#e0e0e0
    style run1 fill:#1a1a2e,stroke:#444,color:#e0e0e0
    style between fill:#1a1a2e,stroke:#444,color:#e0e0e0
    style run2 fill:#1a1a2e,stroke:#444,color:#e0e0e0
```

**Key:** SharedContext is destroyed after each `orchestrator.run()`. Chat History is managed by the caller. Focus State Store persists across runs — Focus nodes load their state at the start of each run and write updates during tool execution.

## 6. LoftAgentNode Execution Detail

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555'}}}%%
flowchart TD
    START([Orchestrator calls node.run<br/>message + sharedContext + sessionId]):::orch

    CONVERT[Convert AgentMessage → CreateMessage<br/>using node's llmName + manifestName]:::node

    INJECT[Inject SharedContext data<br/>as augmentedContext system messages]:::sc

    FOCUS_CHECK{Focus configured?}:::decision

    FOCUS_INJECT[Load Focus state via getAll<br/>Compute FocusStatus<br/>Generate Focus prompt → augmentedContext<br/>Generate Focus tools → additionalTools]:::focus

    GENERATE[loft.chat.generate<br/>full LOFT pipeline:<br/>InputMiddleware → BeforeGenerate → LLM → AfterGenerate<br/>AdditionalTools routed to local handlers]:::node

    EXTRACT[Extract assistant response<br/>from GenerateResult.topChoice]:::node

    RESOLVE{Resolve transition}:::decision

    ONE[Single transition defined<br/>→ use it directly]:::orch
    CUSTOM[Custom transitionResolver<br/>→ call with GenerateResult + transitions]:::orch
    NONE[No transitions defined<br/>→ Terminal]:::orch
    AMBIGUOUS[Multiple transitions, no resolver<br/>→ throw InvalidGraphError]:::error

    FOCUS_POST{Focus configured<br/>and ready?}:::decision
    FOCUS_OVERRIDE[Override transition<br/>with the node's onFocusComplete.target]:::focus

    RETURN([Return NodeResult:<br/>output AgentMessage + Transition]):::orch

    START --> CONVERT --> INJECT --> FOCUS_CHECK
    FOCUS_CHECK -->|Yes| FOCUS_INJECT --> GENERATE
    FOCUS_CHECK -->|No| GENERATE
    GENERATE --> EXTRACT --> RESOLVE
    RESOLVE -->|1 transition| ONE --> FOCUS_POST
    RESOLVE -->|custom resolver| CUSTOM --> FOCUS_POST
    RESOLVE -->|0 transitions| NONE --> FOCUS_POST
    RESOLVE -->|ambiguous| AMBIGUOUS
    FOCUS_POST -->|Yes, ready| FOCUS_OVERRIDE --> RETURN
    FOCUS_POST -->|No| RETURN

    classDef orch fill:#1e3a5f,stroke:#4a7dff,color:#e0e0e0
    classDef node fill:#3d2b1f,stroke:#f0883e,color:#e0e0e0
    classDef sc fill:#2d2714,stroke:#e6a817,color:#e0e0e0
    classDef focus fill:#1a3326,stroke:#4caf50,color:#e0e0e0
    classDef decision fill:#2d2d2d,stroke:#888,color:#e0e0e0
    classDef error fill:#3d1f1f,stroke:#e53935,color:#e0e0e0
```

## 7. OrchestratorBuilder Validation

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555'}}}%%
flowchart TD
    BUILD([builder.build]):::orch

    V1{Entry node set?}:::decision
    E1[throw NoEntryNodeError]:::error

    V2{Entry node exists<br/>in node map?}:::decision
    E2[throw NodeNotFoundError]:::error

    V3{All transition targets<br/>reference existing nodes?}:::decision
    E3[throw InvalidGraphError]:::error

    V5{Any unreachable nodes?}:::decision
    W1[Log warning per<br/>unreachable node]:::warn

    OK([Return Orchestrator]):::orch

    BUILD --> V1
    V1 -->|No| E1
    V1 -->|Yes| V2
    V2 -->|No| E2
    V2 -->|Yes| V3
    V3 -->|No| E3
    V3 -->|Yes| V5
    V5 -->|Yes| W1 --> OK
    V5 -->|No| OK

    classDef orch fill:#1e3a5f,stroke:#4a7dff,color:#e0e0e0
    classDef decision fill:#2d2d2d,stroke:#888,color:#e0e0e0
    classDef error fill:#3d1f1f,stroke:#e53935,color:#e0e0e0
    classDef warn fill:#2d2714,stroke:#e6a817,color:#e0e0e0
```

**Note:** Duplicate node names are caught eagerly in `addNode()` (throws `InvalidGraphError`), not at build time.

## 8. Node Policy Wrapping (Phase 4)

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#1e3a5f', 'primaryTextColor': '#e0e0e0', 'primaryBorderColor': '#4a7dff', 'lineColor': '#888', 'background': '#141414', 'mainBkg': '#1e1e2e', 'nodeBorder': '#555'}}}%%
flowchart TD
    START([Orchestrator.executeNode]):::orch

    HAS_POLICY{Node has retry<br/>or timeout policy?}:::decision

    NO_POLICY[Call node.run directly]:::node

    HAS_TIMEOUT{Timeout configured?}:::decision
    WRAP_TIMEOUT[Wrap with withTimeout<br/>Promise.race against timer<br/>Throws NodeTimeoutError]:::timeout

    HAS_RETRY{Retry configured?}:::decision
    WRAP_RETRY[Wrap with withRetry<br/>Exponential backoff loop<br/>Throws NodeRetryExhaustedError]:::retry

    EXECUTE[Execute wrapped function]:::node

    RETRY_LOOP{Error thrown?}:::decision
    CHECK_RETRYABLE{retryOn filter<br/>passes?}:::decision
    WAIT[Wait delayMs * backoff^attempt<br/>Log retry event to tracer]:::retry
    ATTEMPT[Retry attempt]:::retry
    EXHAUSTED[All retries exhausted<br/>→ NodeRetryExhaustedError]:::error

    SUCCESS[Return NodeResult<br/>+ retryCount to MetricsCollector]:::orch

    START --> HAS_POLICY
    HAS_POLICY -->|No| NO_POLICY --> SUCCESS
    HAS_POLICY -->|Yes| HAS_TIMEOUT
    HAS_TIMEOUT -->|Yes| WRAP_TIMEOUT --> HAS_RETRY
    HAS_TIMEOUT -->|No| HAS_RETRY
    HAS_RETRY -->|Yes| WRAP_RETRY --> EXECUTE
    HAS_RETRY -->|No| EXECUTE
    EXECUTE --> RETRY_LOOP
    RETRY_LOOP -->|No| SUCCESS
    RETRY_LOOP -->|Yes, has retries left| CHECK_RETRYABLE
    RETRY_LOOP -->|Yes, no retries| EXHAUSTED
    CHECK_RETRYABLE -->|Yes| WAIT --> ATTEMPT --> EXECUTE
    CHECK_RETRYABLE -->|No, filter rejects| EXHAUSTED

    classDef orch fill:#1e3a5f,stroke:#4a7dff,color:#e0e0e0
    classDef node fill:#3d2b1f,stroke:#f0883e,color:#e0e0e0
    classDef decision fill:#2d2d2d,stroke:#888,color:#e0e0e0
    classDef error fill:#3d1f1f,stroke:#e53935,color:#e0e0e0
    classDef retry fill:#2d2714,stroke:#e6a817,color:#e0e0e0
    classDef timeout fill:#1a3326,stroke:#4caf50,color:#e0e0e0
```

**Composition order:** timeout wraps `node.run()` (per attempt), retry wraps the timeout. Each retry attempt gets a fresh timeout. `retryOn` filter can exclude specific errors from retry.
