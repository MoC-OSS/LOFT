import { Strategy } from '@moc-global/loft-definitions';
import crypto from 'crypto';

const createSpan = (name: string, depth: number): Strategy.Tracer.Span => {
  const indent = '  '.repeat(depth);
  const start = Date.now();
  console.log(`[TRACE] ${indent}> ${name}`);

  return {
    id: crypto.randomUUID(),
    end: () => console.log(`[TRACE] ${indent}< ${name} (${Date.now() - start}ms)`),
    span: (p) => createSpan(p.name, depth + 1),
    generation: () => ({ id: crypto.randomUUID(), end: () => {} }),
    event: (p) => console.log(`[TRACE] ${indent}  ${p.name}`)
  };
};

export class ConsoleTracer implements Strategy.Tracer.Tracer {
  span = (p: { name: string }) => createSpan(p.name, 0);
  generation = () => ({ id: crypto.randomUUID(), end: () => {} });
  event = (p: { name: string }) => console.log(`[TRACE] ${p.name}`);
  score = () => {};
  update = () => {};
  flushAsync = () => Promise.resolve();
  withParent = () => new ConsoleTracer();
}
