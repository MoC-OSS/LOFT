/** Where the checked text comes from. */
export type InjectionSource = 'user' | 'augmentedContext' | 'toolResult' | 'toolDescription';

export interface InjectionInput {
  text: string;
  source: InjectionSource;
  /** The tool, for a tool result or a tool description */
  toolName?: string;
}

export interface InjectionVerdict {
  flagged: boolean;
  /** Why the text was flagged, such as `instruction-override`; empty when it was not */
  categories: readonly string[];
}

/**
 * Decides whether a text tries to instruct the model. It may be asynchronous, such as a hosted service; `signal`
 * aborts when the guard's timeout passes.
 */
export interface InjectionDetector {
  detect(input: InjectionInput, signal: AbortSignal): InjectionVerdict | Promise<InjectionVerdict>;
}

export interface InjectionPattern {
  category: string;
  pattern: RegExp;
}

// Characters that hide text from a reader but not from the model: Unicode tag characters (U+E0000 to U+E007F) and the
// bidirectional overrides (U+202D, U+202E). The flag emoji of England, Scotland and Wales are written with tag
// characters and are not hidden text; bidirectional isolates are left alone, as right-to-left names are wrapped in them
const FLAG_TAG_SEQUENCE = /\u{1F3F4}[\u{E0061}-\u{E007A}]{2,7}\u{E007F}/gu;
const HIDDEN_CHARACTERS = /[\u{E0000}-\u{E007F}\u202D\u202E]/u;
// Characters that split words without being seen, such as a zero-width space inside "ignore": the soft hyphen, the
// combining grapheme joiner, the Mongolian vowel separator, zero-width spaces and joiners, the word joiner, the
// invisible operators, the variation selectors and the byte order mark
const INVISIBLE_SEPARATORS = /[\u00AD\u180E\u200B-\u200D\u2060-\u2064\uFEFF]|\u034F|[\uFE00-\uFE0F]/g;

// Each gap is bounded, so a pattern runs in linear time on any input
const DEFAULT_PATTERNS: InjectionPattern[] = [
  {
    category: 'instruction-override',
    pattern:
      /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|preceding|all|any|system|developer|original)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules?|guidelines?|directions?|messages?|context)\b/i
  },
  {
    category: 'role-marker',
    // A chat-template marker, or a line that speaks as the system or the developer and gives an instruction, so that a
    // pasted "System: Windows 11" or a YAML key is not one
    pattern:
      /<\|(?:im_start|im_end|system|endoftext|start_header_id)\|>|\[\/?INST\]|<<\/?SYS>>|^[ \t]*(?:system|developer)[ \t]*:[ \t]*(?:you\b|ignore\b|disregard\b|forget\b|from now\b|new (?:instructions|rules)\b|override\b|act as\b|your (?:new )?(?:instructions|role|task)\b)/im
  },
  {
    category: 'prompt-extraction',
    pattern:
      /\b(?:reveal|show|print|repeat|display|leak|tell me)\b[^.\n]{0,40}\b(?:system prompt|system message|initial instructions|hidden instructions|developer message|your (?:system|original|initial|hidden) (?:instructions|prompt))\b/i
  },
  {
    category: 'persona-override',
    pattern:
      /\byou are now\b[^.\n]{0,30}\b(?:unrestricted|unfiltered|jailbroken|DAN|free of (?:all|any) (?:rules|restrictions))\b|\b(?:developer|god|jailbreak) mode (?:enabled|activated|on)\b/i
  }
];

/** The text with compatibility forms unified and invisible separators removed. */
export function normalizeForDetection(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE_SEPARATORS, '');
}

/**
 * A detector of common injection phrasing: instructions to ignore earlier instructions, chat-template role markers,
 * requests for the system prompt, persona overrides, and hidden Unicode characters. It is fast and runs locally, and
 * it misses paraphrases, other languages and novel attacks; combine it with a model-based detector where that
 * matters. `patterns` adds patterns to the built-in ones; each must run in linear time.
 */
export function heuristicDetector(options: { patterns?: readonly InjectionPattern[] } = {}): InjectionDetector {
  const patterns = [...DEFAULT_PATTERNS, ...(options.patterns ?? [])];
  return {
    detect({ text }) {
      const categories = new Set<string>();
      if (HIDDEN_CHARACTERS.test(text.replace(FLAG_TAG_SEQUENCE, ''))) categories.add('hidden-characters');
      const normalized = normalizeForDetection(text);
      // The same text on one line, so an attack split across lines or text parts is read as one sentence
      const joined = normalized.replace(/\s+/g, ' ');
      for (const { category, pattern } of patterns) {
        pattern.lastIndex = 0;
        const found = pattern.test(normalized);
        pattern.lastIndex = 0;
        if (found || pattern.test(joined)) categories.add(category);
      }
      return { flagged: categories.size > 0, categories: [...categories] };
    }
  };
}
