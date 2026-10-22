import { ApiError, Candidate, GenerateContentResponse, Part } from '@google/genai';

interface CandidateState {
  // The candidate's fields other than its content, each from the last chunk that has it
  fields: Record<string, unknown>;
  hasContent: boolean;
  role?: string;
  parts: Part[];
}

// The fields of a part that only carries text
const TEXT_PART_FIELDS = new Set(['text', 'thought', 'thoughtSignature']);

const isTextPart = (part: Part): boolean =>
  typeof part.text === 'string' &&
  (Object.entries(part) as [string, unknown][]).every(
    ([key, value]) => value === undefined || TEXT_PART_FIELDS.has(key)
  );

// A text part with no text and no signature
const isEmptyText = (part: Part): boolean => isTextPart(part) && part.text === '' && !part.thoughtSignature;

// Appends a streamed part. Text arrives a few words per chunk, so a text part is joined to the text part before it when
// both are thoughts or both are not. A signature stays on the part it arrived with: the final chunk of a reply often
// carries it on an empty text part, which then joins the text before it, as one part holds it without streaming. An
// empty text part without a signature adds nothing, so it is dropped. As the first part it is kept until another part
// replaces it, so a reply made only of empty text keeps its part, as without streaming
function addPart(parts: Part[], part: Part): void {
  const previous = parts.at(-1);
  if (isEmptyText(part)) {
    if (!previous) parts.push({ ...part });
    return;
  }
  if (previous && isEmptyText(previous)) {
    parts[parts.length - 1] = { ...part };
    return;
  }
  if (
    previous &&
    isTextPart(previous) &&
    isTextPart(part) &&
    Boolean(previous.thought) === Boolean(part.thought) &&
    !(previous.thoughtSignature && part.thoughtSignature)
  ) {
    parts[parts.length - 1] = {
      ...previous,
      text: (previous.text ?? '') + (part.text ?? ''),
      ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature })
    };
    return;
  }
  parts.push({ ...part });
}

// Copies the fields of `source` other than `skip`; a field that is undefined changes nothing
function assignDefined(target: Record<string, unknown>, source: object, skip: Set<string>): void {
  for (const [key, value] of Object.entries(source) as [string, unknown][]) {
    if (!skip.has(key) && value !== undefined) target[key] = value;
  }
}

const RESPONSE_SKIP = new Set(['candidates', 'promptFeedback']);
const CANDIDATE_SKIP = new Set(['content']);

// The finishes of a reply that a filter blocked. Vertex AI's "Safety and content filters" page lists them, and says the
// filter then clears the candidate's content, so a non-streamed reply has none; a stream has already sent the text
const BLOCKED_FINISH_REASONS = new Set<string>(['SAFETY', 'RECITATION', 'SPII', 'PROHIBITED_CONTENT']);

/**
 * What a stream that ends before the model finished its reply rejects with, the error that ended it as the `cause`. The
 * SDK has no connection error class; a 502 tells the call manager the reply can be asked for again.
 */
export function cutStreamError(cause?: unknown): ApiError {
  const error = new ApiError({
    message: 'No HTTP error occurred: the stream ended before the model finished its reply',
    status: 502
  });
  if (cause !== undefined) error.cause = cause;
  return error;
}

/**
 * Builds the `GenerateContentResponse` a non-streamed request returns from the chunks of a streamed one, one chunk at
 * a time.
 */
export class GenerateContentAccumulator {
  private readonly fields: Record<string, unknown> = {};
  private readonly candidates = new Map<number, CandidateState>();

  /**
   * @param candidateCount The number of candidates the request asked for (`config.candidateCount`); the response needs
   * every one of them.
   */
  constructor(private readonly candidateCount = 1) {}

  add(chunk: GenerateContentResponse): void {
    assignDefined(this.fields, chunk, RESPONSE_SKIP);
    // The prompt is judged once, so the first verdict is the one the request gets
    if (chunk.promptFeedback && this.fields.promptFeedback === undefined) {
      this.fields.promptFeedback = chunk.promptFeedback;
    }

    (chunk.candidates ?? []).forEach((chunkCandidate, position) => {
      // The API leaves out an index of 0
      const candidate = this.candidate(chunkCandidate.index ?? position);
      assignDefined(candidate.fields, chunkCandidate, CANDIDATE_SKIP);
      if (!chunkCandidate.content) return;
      candidate.hasContent = true;
      if (chunkCandidate.content.role) candidate.role = chunkCandidate.content.role;
      for (const part of chunkCandidate.content.parts ?? []) addPart(candidate.parts, part);
    });
  }

  /** The finish reason of the first candidate, once it is known. */
  get firstFinishReason(): string | undefined {
    const finishReason = this.candidates.get(0)?.fields.finishReason;
    return typeof finishReason === 'string' ? finishReason : undefined;
  }

  get modelVersion(): string | undefined {
    const modelVersion = this.fields.modelVersion;
    return typeof modelVersion === 'string' ? modelVersion : undefined;
  }

  /**
   * Whether every candidate the request asked for, and any other the stream sent, has its finish reason, or the prompt
   * was blocked, so `result()` returns.
   */
  get finished(): boolean {
    if ((this.fields.promptFeedback as GenerateContentResponse['promptFeedback'])?.blockReason) return true;
    const candidates = [...this.candidates.values()];
    return (
      candidates.length >= Math.max(this.candidateCount, 1) &&
      candidates.every(({ fields }) => Boolean(fields.finishReason))
    );
  }

  /**
   * The response so far. Throws when a candidate is unfinished, or there is none, and the prompt was not blocked, as
   * happens when the connection closes before the reply is complete.
   */
  result(): GenerateContentResponse {
    if (!this.finished) throw cutStreamError();
    const candidates = [...this.candidates.entries()].sort(([a], [b]) => a - b).map(([, state]) => this.build(state));

    return Object.assign(new GenerateContentResponse(), {
      ...this.fields,
      ...(candidates.length > 0 && { candidates })
    });
  }

  private candidate(index: number): CandidateState {
    let candidate = this.candidates.get(index);
    if (!candidate) {
      candidate = { fields: {}, hasContent: false, parts: [] };
      this.candidates.set(index, candidate);
    }
    return candidate;
  }

  private build({ fields, hasContent, role, parts }: CandidateState): Candidate {
    const filtered = typeof fields.finishReason === 'string' && BLOCKED_FINISH_REASONS.has(fields.finishReason);
    return {
      ...fields,
      ...(hasContent &&
        !filtered && {
          content: { ...(role !== undefined && { role }), ...(parts.length > 0 && { parts }) }
        })
    };
  }
}

/**
 * Builds the `GenerateContentResponse` a non-streamed request returns from the chunks of a streamed one.
 * - Per candidate: adjacent text parts joined (thoughts apart from the answer), each thought signature on the part it
 *   came with, function calls in order, and every other field (`finishReason`, `safetyRatings`, `citationMetadata`,
 *   `groundingMetadata`…) from the last chunk that has it. A candidate that a filter blocked (`SAFETY`, `RECITATION`,
 *   `SPII`, `PROHIBITED_CONTENT`) has no content, as without streaming.
 * - `usageMetadata`, `modelVersion`, `responseId` and `createTime` from the last chunk that has them, and
 *   `promptFeedback` from the first.
 */
export function accumulateGenerateContent(chunks: Iterable<GenerateContentResponse>): GenerateContentResponse {
  const accumulator = new GenerateContentAccumulator();
  for (const chunk of chunks) accumulator.add(chunk);
  return accumulator.result();
}
