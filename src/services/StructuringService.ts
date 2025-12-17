import { StructuredDocument } from '../types/models';

interface StructureResult {
  document?: StructuredDocument;
}

export class StructuringService {
  async structureDocument(_input: unknown): Promise<StructureResult> {
    const document: StructuredDocument = {
      documentId: 'stub',
      assetId: 'stub',
      title: 'stub',
      sections: [],
      metadata: {} as any,
    };
    return { document };
  }
}

const structuringService = new StructuringService();

export default structuringService;
