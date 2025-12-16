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
}

export interface LlmProvider {
  parse(request: LlmParseRequest): Promise<LlmParseResult>;
}

export class LlmProviderError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'LlmProviderError';
    this.code = code;
  }
}
