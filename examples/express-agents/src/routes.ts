import { LOFT } from '@moc-global/loft';
import { Orchestrator, SharedContext } from '@moc-global/loft-agents';
import { Agent, Chat, Type } from '@moc-global/loft-definitions';
import crypto from 'crypto';
import { Express } from 'express';

import { MODEL_NAME } from './shared/setup';

const FLOWS = [
  { name: 'simple', description: 'Single agent — wine/food recommendation', entry: 'sommelier' },
  { name: 'chain', description: 'Linear pipeline — nutritionist → chef → presenter', entry: 'nutritionist' },
  {
    name: 'parallel',
    description: 'FAN_OUT — 3 parallel catering specialists + coordinator',
    entry: 'catering-dispatcher'
  },
  { name: 'team', description: 'TeamBuilder — restaurant review with critic team', entry: 'restaurant-visit' },
  { name: 'full', description: 'All features — Focus + FAN_OUT + Team for banquet planning', entry: 'banquet-intake' },
  {
    name: 'reservation',
    description: 'Advanced Focus (resolveFields, dynamic fields) + custom non-LLM Node + ScopedContext',
    entry: 'reservation-intake'
  }
];

// Track active Focus sessions — when a Focus agent is collecting data,
// subsequent messages bypass the router and go directly to the Focus agent.
const activeFocusSessions = new Map<string, string>();

export const registerRoutes = (
  app: Express,
  chat: Chat.ChatInterface,
  orchestrator: Orchestrator,
  loft: LOFT<Chat.ChatInterface>
) => {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/flows', (_req, res) => {
    res.json({ flows: FLOWS });
  });

  app.post('/api/sessions', async (_req, res) => {
    try {
      const session = await chat.createSession({
        currentLlmName: MODEL_NAME,
        currentManifestName: 'router',
        ctx: {}
      });
      res.json({ sessionId: session.id });
    } catch (error) {
      console.error('Session creation error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  app.get('/api/sessions/:id/history', async (req, res) => {
    try {
      const messages = await chat.getChatHistory(req.params.id);
      res.json({ sessionId: req.params.id, messages });
    } catch (error) {
      console.error('Get history error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });

  app.post('/api/chat', async (req, res) => {
    try {
      const { sessionId, message } = req.body as { sessionId: string; message: string };

      if (!sessionId || !message?.trim()) {
        res.status(400).json({ error: 'sessionId and message are required' });
        return;
      }

      // Stored with the answer after the turn: the agents get it as their direct message, and the stored
      // history must not hold it yet, or the model would read it twice
      const userMsg: Type.Entity.CreateMessage = {
        sessionId,
        content: [{ type: 'text', text: message }],
        role: Type.LLM.UnifiedMessageRole.user,
        author: 'user',
        llmName: MODEL_NAME,
        manifestName: 'router',
        ctx: {},
        llmIgnore: false
      };

      let responseText: string;
      let focusStatus: Agent.FocusStatus | undefined;

      const activeFocus = activeFocusSessions.get(sessionId);

      if (activeFocus) {
        // Active Focus — send directly to the Focus agent, bypassing the router
        const result = await chat.generate({
          sessionId,
          directMessages: [
            {
              sessionId,
              content: [{ type: 'text', text: message }],
              role: Type.LLM.UnifiedMessageRole.user,
              author: 'user',
              llmName: MODEL_NAME,
              manifestName: activeFocus,
              llmIgnore: false,
              ctx: {}
            }
          ],
          temporaryLlmName: MODEL_NAME,
          temporaryManifestName: activeFocus,
          focusAgent: activeFocus
        });

        focusStatus = result.focusStatus;
        responseText = result.messages.llmResponse.topChoice.content
          .filter((c): c is Type.Entity.TextContent => c.type === 'text')
          .map((c) => c.text)
          .join('');

        // When Focus tools run but LLM produces no text, show progress to the user
        if (!responseText && focusStatus && !focusStatus.ready) {
          const missing = focusStatus.missing;
          responseText = missing.length
            ? `Got it! I still need: ${missing.join(', ')}. Could you provide those?`
            : 'Thanks! Processing your information...';
        }

        if (focusStatus?.ready) {
          // Focus complete — clear tracking and continue the pipeline
          activeFocusSessions.delete(sessionId);

          // Look up the onComplete target from the Focus config
          const focusConfig = loft.getFocus(activeFocus);
          if (focusConfig?.onComplete.type === Agent.FocusActionType.TRANSITION) {
            // Pre-populate shared context with focus data so downstream nodes can access it
            const context = new SharedContext(sessionId);
            context.set(`focus:${activeFocus}`, focusStatus.filled);

            const focusData = JSON.stringify(focusStatus.filled);
            const pipelineResult = await orchestrator.runFrom(
              focusConfig.onComplete.target,
              { role: Agent.AgentMessageRole.USER, content: focusData },
              sessionId,
              context
            );
            responseText = pipelineResult.content;
          }
        }
      } else {
        // No active Focus — run the full orchestrator from the router
        const result = await orchestrator.run({ role: Agent.AgentMessageRole.USER, content: message }, sessionId);
        responseText = result.content;

        // Check if the orchestrator activated a Focus agent on this turn.
        // LoftAgentNode propagates focusStatus through AgentMessage.data.
        const resultFocusStatus = result.data?.focusStatus as Agent.FocusStatus | undefined;
        if (resultFocusStatus && !resultFocusStatus.ready) {
          activeFocusSessions.set(sessionId, resultFocusStatus.agentName);
        }
        if (resultFocusStatus) {
          focusStatus = resultFocusStatus;
        }
      }

      // Store the turn: the user message, then the agent response
      const turn: Type.Entity.CreateMessage[] = [userMsg];
      if (responseText) {
        turn.push({
          sessionId,
          content: [{ type: 'text', text: responseText }],
          role: Type.LLM.UnifiedMessageRole.assistant,
          author: 'agent',
          llmName: MODEL_NAME,
          manifestName: 'router',
          ctx: {},
          llmIgnore: false
        });
      }
      await chat.addMessages(sessionId, [crypto.randomUUID()], turn);

      res.json({ sessionId, response: responseText, focusStatus });
    } catch (error) {
      console.error('Chat error:', error);
      res.status(500).json({ error: 'Internal server error' }); // details stay in the server log
    }
  });
};
