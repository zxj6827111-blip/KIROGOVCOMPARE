import { StructuredDocument } from '../types/models';

interface StructureResult {
  document?: StructuredDocument;
}

export class StructuringService {
  async structureDocument(_input: unknown): Promise<StructureResult> {
    throw new Error('structuring_service_unavailable: legacy compare structuring has been retired');
  }
}

const structuringService = new StructuringService();

export default structuringService;
