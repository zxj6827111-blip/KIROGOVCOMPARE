
export interface LlmParseRequest {
  reportId: number;
  versionId: number;
  storagePath: string;
  fileHash?: string;
}

export interface LlmParseResult {
  provider: string;
  model: string;
  output: any;
  // Exact text sent to the LLM after preprocessing/truncation.
  sourceText?: string;
}

export interface LlmProvider {
  parse(request: LlmParseRequest, signal?: AbortSignal): Promise<LlmParseResult>;
  // Optional generation method for non-file tasks
  generate?(prompt: string, systemInstruction?: string, config?: any): Promise<any>;
}

export class LlmProviderError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'LlmProviderError';
    this.code = code;
  }
}
