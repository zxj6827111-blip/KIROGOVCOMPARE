import { buildSectionAlignmentSuggestions } from '../utils/sectionAlignmentSuggestions';
import { normalizeComparisonSectionTitle } from '../utils/sectionAlignment';

describe('comparison alignment suggestions', () => {
  test('suggests a configurable rule for future same-meaning text title variants', () => {
    const suggestions = buildSectionAlignmentSuggestions(
      [{ type: 'text', title: '一、专项整改落实情况', content: '旧内容' }],
      [{ type: 'text', title: '一、专项整改情况', content: '新内容' }],
      []
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual(expect.objectContaining({
      sectionType: 'text',
      leftTitle: '一、专项整改落实情况',
      rightTitle: '一、专项整改情况',
      confidence: 90,
    }));
  });

  test('does not suggest risky text pairs when both sides use different ordinals', () => {
    const suggestions = buildSectionAlignmentSuggestions(
      [{ type: 'text', title: '五、专项整改落实情况', content: '旧内容' }],
      [{ type: 'text', title: '七、专项整改情况', content: '新内容' }],
      []
    );

    expect(suggestions).toHaveLength(0);
  });

  test('skips pairs already covered by saved rules', () => {
    const leftTitle = '一、专项整改落实情况';
    const rightTitle = '一、专项整改情况';
    const suggestions = buildSectionAlignmentSuggestions(
      [{ type: 'text', title: leftTitle, content: '旧内容' }],
      [{ type: 'text', title: rightTitle, content: '新内容' }],
      [{
        sectionType: 'text',
        leftKey: normalizeComparisonSectionTitle(leftTitle, 'text'),
        rightKey: normalizeComparisonSectionTitle(rightTitle, 'text'),
        canonicalKey: 'custom:text:专项整改情况',
      }]
    );

    expect(suggestions).toHaveLength(0);
  });
});
