import { Type } from '..';

export type Prompt = {
  name: string;
  content: string;
};

export type PromptComputer<PromptContext> = (
  promptCtx: PromptContext,
  prompt: Prompt,
  modelPreset?: Type.LLMManifestProps['modelPreset']
) => Promise<string>;

// System Message Computer Manager Interface
export interface ComputerManager<PromptContext> {
  use(manifestName: string, llmName: string, handler: PromptComputer<PromptContext>): void;
  compute(
    promptCtx: PromptContext,
    systemMessage: Type.LLMManifestProps['systemMessage'],
    manifestName: string,
    llmName: string,
    modelPreset?: Type.LLMManifestProps['modelPreset']
  ): Promise<string>;
}
