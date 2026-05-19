class ParsedDataStorageServiceClass {
  async loadParseData(_assetId: string): Promise<Record<string, unknown> | null> {
    throw new Error('parsed_data_storage_unavailable: legacy compare parse storage has been retired');
  }
}

const ParsedDataStorageService = new ParsedDataStorageServiceClass();

export default ParsedDataStorageService;
