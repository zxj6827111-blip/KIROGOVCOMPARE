import { buildTable3Skeleton } from '../LlmCommon';

export const FILING_SECTION_TITLES = {
  s1: '一、总体情况',
  s2: '二、主动公开政府信息情况',
  s3: '三、收到和处理政府信息公开申请情况',
  s4: '四、政府信息公开行政复议、行政诉讼情况',
  s5: '五、存在的主要问题及改进情况',
  s6: '六、其他需要报告的事项',
} as const;

function buildTable2Skeleton() {
  return {
    regulations: { made: 0, repealed: 0, valid: 0 },
    normativeDocuments: { made: 0, repealed: 0, valid: 0 },
    licensing: { processed: 0 },
    punishment: { processed: 0 },
    coercion: { processed: 0 },
    fees: { amount: 0 },
  };
}

function buildTable4Skeleton() {
  const cat = () => ({
    maintain: 0,
    correct: 0,
    other: 0,
    unfinished: 0,
    total: 0,
  });
  return {
    review: cat(),
    litigationDirect: cat(),
    litigationPostReview: cat(),
  };
}

/**
 * Build a fixed 6-section blank template matching 国办 30 号文 / runtime parsed_json.
 */
export function buildBlankAnnualReportForm(options?: {
  year?: number;
  unitName?: string;
  regionId?: number;
}): Record<string, any> {
  return {
    schema_version: 'filing_v1',
    year: options?.year ?? null,
    unit_name: options?.unitName ?? '',
    region_id: options?.regionId ?? null,
    sections: [
      {
        title: FILING_SECTION_TITLES.s1,
        type: 'text',
        content: '',
      },
      {
        title: FILING_SECTION_TITLES.s2,
        type: 'table_2',
        activeDisclosureData: buildTable2Skeleton(),
      },
      {
        title: FILING_SECTION_TITLES.s3,
        type: 'table_3',
        tableData: buildTable3Skeleton(),
      },
      {
        title: FILING_SECTION_TITLES.s4,
        type: 'table_4',
        reviewLitigationData: buildTable4Skeleton(),
      },
      {
        title: FILING_SECTION_TITLES.s5,
        type: 'text',
        content: '',
      },
      {
        title: FILING_SECTION_TITLES.s6,
        type: 'text',
        content: '',
      },
    ],
  };
}

export function ensureSixSectionForm(formJson: any, options?: { year?: number; unitName?: string; regionId?: number }): any {
  const blank = buildBlankAnnualReportForm(options);
  if (!formJson || typeof formJson !== 'object') return blank;
  if (!Array.isArray(formJson.sections) || formJson.sections.length === 0) {
    return { ...blank, ...formJson, sections: blank.sections };
  }

  const byType = new Map<string, any>();
  for (const section of formJson.sections) {
    if (section?.type) byType.set(String(section.type) + '|' + String(section.title || ''), section);
  }

  const findText = (title: string) => {
    const exact = formJson.sections.find((s: any) => s?.type === 'text' && s?.title === title);
    if (exact) return exact;
    return formJson.sections.find((s: any) => s?.type === 'text' && String(s?.title || '').includes(title.slice(0, 4)));
  };
  const findTable = (type: string) => formJson.sections.find((s: any) => s?.type === type);

  return {
    ...blank,
    ...formJson,
    year: formJson.year ?? blank.year,
    unit_name: formJson.unit_name ?? blank.unit_name,
    region_id: formJson.region_id ?? blank.region_id,
    sections: [
      {
        title: FILING_SECTION_TITLES.s1,
        type: 'text',
        content: String(findText(FILING_SECTION_TITLES.s1)?.content ?? ''),
      },
      {
        title: FILING_SECTION_TITLES.s2,
        type: 'table_2',
        activeDisclosureData:
          findTable('table_2')?.activeDisclosureData || blank.sections[1].activeDisclosureData,
      },
      {
        title: FILING_SECTION_TITLES.s3,
        type: 'table_3',
        tableData: findTable('table_3')?.tableData || blank.sections[2].tableData,
      },
      {
        title: FILING_SECTION_TITLES.s4,
        type: 'table_4',
        reviewLitigationData:
          findTable('table_4')?.reviewLitigationData || blank.sections[3].reviewLitigationData,
      },
      {
        title: FILING_SECTION_TITLES.s5,
        type: 'text',
        content: String(findText(FILING_SECTION_TITLES.s5)?.content ?? ''),
      },
      {
        title: FILING_SECTION_TITLES.s6,
        type: 'text',
        content: String(findText(FILING_SECTION_TITLES.s6)?.content ?? ''),
      },
    ],
  };
}

export function validateFilingFormStructure(formJson: any): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!formJson || typeof formJson !== 'object') {
    return { ok: false, errors: ['form_json 必须为对象'] };
  }
  if (!Array.isArray(formJson.sections) || formJson.sections.length < 6) {
    errors.push('form_json.sections 必须包含 6 个章节');
  } else {
    const types = formJson.sections.map((s: any) => s?.type);
    if (types[0] !== 'text') errors.push('第一章必须为 text');
    if (types[1] !== 'table_2') errors.push('第二章必须为 table_2');
    if (types[2] !== 'table_3') errors.push('第三章必须为 table_3');
    if (types[3] !== 'table_4') errors.push('第四章必须为 table_4');
    if (types[4] !== 'text') errors.push('第五章必须为 text');
    if (types[5] !== 'text') errors.push('第六章必须为 text');
  }
  return { ok: errors.length === 0, errors };
}
