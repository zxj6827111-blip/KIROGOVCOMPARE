class ParsedDataStorageServiceClass {
  async loadParseData(_assetId: string): Promise<Record<string, unknown> | null> {
    return null;
  }
}

const ParsedDataStorageService = new ParsedDataStorageServiceClass();

export default ParsedDataStorageService;
