import { Interface } from '..';

/**
 * Interface for LLM context window cropping strategies
 * Responsible for safely cropping chat history to fit within LLM context windows
 */
export interface LlmContextWindowCropper {
  /**
   * Crop chat history messages to fit within the target size
   * @param messages Array of chat history messages to crop
   * @param targetSize Target number of messages to keep
   * @returns Cropped messages array
   */
  crop(
    messages: Array<Interface.FacadeEntity.Message | Interface.FacadeEntity.InteractiveOutputMessage>,
    targetSize: number
  ): Array<Interface.FacadeEntity.Message | Interface.FacadeEntity.InteractiveOutputMessage>;
}
