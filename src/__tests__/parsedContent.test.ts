import { hasParsedContent } from '../utils/parsedContent';
import { extractFirstJsonObject, parseStructuredJsonFromText, sanitizeLoadedText } from '../services/LlmCommon';

describe('hasParsedContent', () => {
  it('rejects metadata-only parse shells', () => {
    expect(hasParsedContent({})).toBe(false);
    expect(hasParsedContent({ report_type: 'annual', year: 2024 })).toBe(false);
    expect(hasParsedContent({ sections: [] })).toBe(false);
    expect(hasParsedContent(JSON.stringify({ basic_info: {} }))).toBe(false);
    expect(hasParsedContent({ basic_info: { unit: '某某局' } })).toBe(false);
    expect(hasParsedContent({ sections: [{ type: 'table_3', tableData: {} }] })).toBe(false);
    expect(hasParsedContent({ sections: [{ type: 'text', content: '短' }] })).toBe(false);
    expect(hasParsedContent('plain non-json text that is long enough to look like content')).toBe(false);
  });

  it('accepts actual annual-report content', () => {
    expect(hasParsedContent({
      sections: [
        {
          type: 'table_3',
          tableData: {
            total: { newReceived: 1 },
          },
        },
      ],
    })).toBe(true);

    expect(hasParsedContent({ activeDisclosureData: { regulations: { made: 1 } } })).toBe(true);
    expect(hasParsedContent('{"reviewLitigationData":{"review":{"total":1}}}')).toBe(true);
    expect(
      hasParsedContent({
        sections: [
          {
            type: 'text',
            content: '这是一段足够长的正文内容，用于说明年报总体情况已经成功解析。',
          },
        ],
      })
    ).toBe(true);
  });

  it('extracts the first balanced JSON object from provider text', () => {
    const raw = 'Here is the JSON:\\n{"status":"ok","nested":{"value":1}}\\nDone.';

    expect(extractFirstJsonObject(raw)).toBe('{"status":"ok","nested":{"value":1}}');
    expect(parseStructuredJsonFromText(raw)).toEqual({
      status: 'ok',
      nested: { value: 1 },
    });
  });

  it('repairs literal hex escapes in loaded text and provider JSON', () => {
    expect(sanitizeLoadedText('prefix \\xE6\\x96\\xB0 suffix')).toContain('新');
    expect(parseStructuredJsonFromText('{"content":"prefix \\xE6\\x96\\xB0 suffix"}')).toEqual({
      content: 'prefix 新 suffix',
    });
  });
});
