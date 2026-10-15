import { Agent } from '@moc-global/loft-definitions';
import { vi } from 'vitest';

export function nodeResult(content: string, transition: Agent.Transition): Agent.NodeResult {
  return {
    output: { role: Agent.AgentMessageRole.ASSISTANT, content },
    transition
  };
}

export const single = (target: string): Agent.TransitionSingle => ({ type: Agent.TransitionType.SINGLE, target });
export const fanOut = (targets: string[]): Agent.TransitionFanOut => ({ type: Agent.TransitionType.FAN_OUT, targets });
export const terminal = (): Agent.TransitionTerminal => ({ type: Agent.TransitionType.TERMINAL });

export function stubNode(name: string, transitions: Agent.TransitionDef[], handler: Agent.Node['run']): Agent.Node {
  return { name, transitions, run: vi.fn(handler) };
}

export function staticNode(name: string, transitions: Agent.TransitionDef[], result: Agent.NodeResult): Agent.Node {
  return { name, transitions, run: vi.fn(async () => result) };
}

export function msg(content: string): Agent.AgentMessage {
  return { role: Agent.AgentMessageRole.USER, content };
}
