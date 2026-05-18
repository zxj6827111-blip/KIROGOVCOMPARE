import { buildVisionReviewFocus, compareVisionOcrWithParsed } from '../services/VisionReviewService';
import { ConsistencyItem } from '../services/ConsistencyCheckService';

const makeTrigger = (
  groupKey: ConsistencyItem['groupKey'],
  autoStatus: ConsistencyItem['autoStatus'],
  paths: string[] = []
): ConsistencyItem => ({
  groupKey,
  checkKey: 'test',
  fingerprint: 'test',
  title: 'test',
  expr: 'test',
  leftValue: 1,
  rightValue: 2,
  delta: -1,
  tolerance: 0,
  autoStatus,
  evidenceJson: { paths, leftPaths: paths.slice(0, Math.ceil(paths.length / 2)), rightPaths: paths.slice(Math.ceil(paths.length / 2)), values: {} },
});

describe('compareVisionOcrWithParsed', () => {
  it('builds a focused field list from failed table 3 evidence paths', () => {
    const focus = buildVisionReviewFocus('table_3', [
      {
        ...makeTrigger('table3', 'FAIL'),
        checkKey: 't3_identity_naturalPerson',
        evidenceJson: {
          paths: [
            'tableData.naturalPerson.newReceived',
            'tableData.naturalPerson.carriedOver',
            'tableData.naturalPerson.results.totalProcessed',
            'tableData.naturalPerson.results.carriedForward',
          ],
          leftPaths: ['tableData.naturalPerson.newReceived', 'tableData.naturalPerson.carriedOver'],
          rightPaths: ['tableData.naturalPerson.results.totalProcessed', 'tableData.naturalPerson.results.carriedForward'],
          values: {},
        },
      },
    ]);

    expect(focus?.paths).toEqual([
      'tableData.naturalPerson.newReceived',
      'tableData.naturalPerson.carriedOver',
      'tableData.naturalPerson.results.totalProcessed',
      'tableData.naturalPerson.results.carriedForward',
    ]);
    expect(focus?.relativePaths).toEqual([
      'naturalPerson.newReceived',
      'naturalPerson.carriedOver',
      'naturalPerson.results.totalProcessed',
      'naturalPerson.results.carriedForward',
    ]);
    expect(focus?.promptHints.some((item) => item.includes('tableData.naturalPerson.newReceived'))).toBe(true);
  });

  it('classifies matching OCR with failed checks as source table anomaly', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_4',
          reviewLitigationData: {
            review: { maintain: 1, correct: 2, other: 3, unfinished: 4, total: 99 },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_4',
      confidence: 0.93,
      unreadableCells: [],
      reviewLitigationData: {
        review: { maintain: 1, correct: 2, other: 3, unfinished: 4, total: 99 },
      },
    };

    const result = compareVisionOcrWithParsed('table_4', parsedJson, ocrJson, [makeTrigger('table4', 'FAIL')]);

    expect(result.conclusion).toBe('source_table_anomaly');
    expect(result.differences).toHaveLength(0);
    expect(result.triggerHadCheckFailure).toBe(true);
  });

  it('classifies OCR differences as parse or mapping anomaly', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            regulations: { made: 3, repealed: 1, valid: 10 },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_2',
      confidence: 0.9,
      unreadableCells: [],
      activeDisclosureData: {
        regulations: { made: 30, repealed: 1, valid: 10 },
      },
    };

    const result = compareVisionOcrWithParsed('table_2', parsedJson, ocrJson, [makeTrigger('table2', 'UNCERTAIN')]);

    expect(result.conclusion).toBe('parse_mapping_anomaly');
    expect(result.differences).toEqual([
      { path: 'activeDisclosureData.regulations.made', parsedValue: 3, ocrValue: 30 },
    ]);
  });

  it('produces correction-ready differences for OCR mismatches', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            legalPerson: {
              other: {
                newReceived: 0,
              },
            },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_3',
      confidence: 1,
      unreadableCells: [],
      tableData: {
        legalPerson: {
          other: {
            newReceived: 1,
          },
        },
      },
    };

    const result = compareVisionOcrWithParsed(
      'table_3',
      parsedJson,
      ocrJson,
      [makeTrigger('table3', 'FAIL')],
      ['tableData.legalPerson.other.newReceived']
    );

    expect(result.conclusion).toBe('parse_mapping_anomaly');
    expect(result.differences).toEqual([
      { path: 'tableData.legalPerson.other.newReceived', parsedValue: 0, ocrValue: 1 },
    ]);
  });

  it('compares only trigger-related focused fields when focus paths are provided', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            naturalPerson: {
              newReceived: 60,
              carriedOver: 0,
              results: { totalProcessed: 61, carriedForward: 0, granted: 59 },
            },
          },
        },
      ],
    };
    const ocrJson = {
      table_id: 'table_3',
      confidence: 0.98,
      unreadableCells: [],
      tableData: {
        naturalPerson: {
          newReceived: 60,
          carriedOver: 0,
          results: { totalProcessed: 61, carriedForward: 0, granted: 999 },
        },
      },
    };
    const trigger = makeTrigger('table3', 'FAIL', [
      'tableData.naturalPerson.newReceived',
      'tableData.naturalPerson.carriedOver',
      'tableData.naturalPerson.results.totalProcessed',
      'tableData.naturalPerson.results.carriedForward',
    ]);

    const result = compareVisionOcrWithParsed('table_3', parsedJson, ocrJson, [trigger], trigger.evidenceJson.paths);

    expect(result.conclusion).toBe('source_table_anomaly');
    expect(result.differences).toHaveLength(0);
    expect(result.comparedCellCount).toBe(4);
  });

  it('classifies unreadable OCR as inconclusive', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            total: { newReceived: 8 },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_3',
      confidence: 0.4,
      unreadableCells: ['tableData.total.newReceived'],
      tableData: {
        total: { newReceived: 8 },
      },
    };

    const result = compareVisionOcrWithParsed('table_3', parsedJson, ocrJson, [makeTrigger('table3', 'FAIL')]);

    expect(result.conclusion).toBe('inconclusive');
    expect(result.unreadableCells).toEqual(['tableData.total.newReceived']);
    expect(result.comparedCellCount).toBe(1);
    expect(result.differences).toHaveLength(0);
  });

  it('still produces correction-ready differences when only part of the table is unreadable', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            total: {
              newReceived: 0,
              results: { granted: 0 },
            },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_3',
      confidence: 0.65,
      unreadableCells: ['tableData.total.results.granted'],
      tableData: {
        total: {
          newReceived: 7,
          results: { granted: 0 },
        },
      },
    };

    const result = compareVisionOcrWithParsed('table_3', parsedJson, ocrJson, [makeTrigger('table3', 'FAIL')]);

    expect(result.conclusion).toBe('parse_mapping_anomaly');
    expect(result.differences).toEqual([
      { path: 'tableData.total.newReceived', parsedValue: 0, ocrValue: 7 },
    ]);
    expect(result.unreadableCells).toEqual(['tableData.total.results.granted']);
    expect(result.comparedCellCount).toBe(2);
  });

  it('classifies missing focused OCR fields as inconclusive', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            naturalPerson: { newReceived: 60 },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_3',
      confidence: 0.9,
      unreadableCells: [],
      tableData: {},
    };

    const result = compareVisionOcrWithParsed(
      'table_3',
      parsedJson,
      ocrJson,
      [makeTrigger('table3', 'FAIL')],
      ['tableData.naturalPerson.results.totalProcessed']
    );

    expect(result.conclusion).toBe('inconclusive');
    expect(result.comparedCellCount).toBe(0);
  });

  it('does not treat empty OCR values as correction candidates', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            decisions: { made: 25970 },
            fees: { amount: 240 },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_2',
      confidence: 0.7,
      unreadableCells: [],
      activeDisclosureData: {
        decisions: { made: null },
        fees: { amount: null },
      },
    };

    const result = compareVisionOcrWithParsed('table_2', parsedJson, ocrJson, [makeTrigger('table2', 'FAIL')]);

    expect(result.conclusion).toBe('inconclusive');
    expect(result.differences).toHaveLength(0);
    expect(result.unreadableCells).toEqual([
      'activeDisclosureData.decisions.made',
      'activeDisclosureData.fees.amount',
    ]);
  });

  it('normalizes table 2 OCR payloads with Chinese grouped labels before comparing', () => {
    const parsedJson = {
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            fees: { amount: 240 },
            coercion: { processed: 25970 },
            licensing: { processed: 474339 },
            punishment: { processed: 3286513 },
            regulations: { made: 1, repealed: 0, valid: 3 },
            normativeDocuments: { made: 117, repealed: 0, valid: 841 },
          },
        },
      ],
    };

    const ocrJson = {
      table_id: 'table_2',
      confidence: 0.99,
      unreadableCells: [],
      activeDisclosureData: {
        '第二十条第（一）项': {
          规章: {
            对外公开总数量: 3,
            本年新公开数量: 1,
            本年新制作数量: 1,
          },
          规范性文件: {
            对外公开总数量: 841,
            本年新公开数量: 117,
            本年新制作数量: 117,
          },
        },
        '第二十条第（五）项': {
          行政许可: {
            '本年增/减': '+1036',
            处理决定数量: 474339,
          },
        },
        '第二十条第（六）项': {
          行政处罚: {
            '本年增/减': '+461',
            处理决定数量: 3286513,
          },
          行政强制: {
            '本年增/减': '+14',
            处理决定数量: 25970,
          },
        },
        '第二十条第（八）项': {
          行政事业性收费: {
            '本年增/减': '+4',
            上一年项目数量: 240,
          },
        },
      },
    };

    const result = compareVisionOcrWithParsed('table_2', parsedJson, ocrJson, [makeTrigger('table2', 'FAIL')]);

    expect(result.conclusion).toBe('source_table_anomaly');
    expect(result.differences).toHaveLength(0);
    expect(result.unreadableCells).toHaveLength(0);
    expect(result.comparedCellCount).toBe(10);
  });

  it('normalizes table 3 OCR matrix rows before comparing', () => {
    const tableData = {
      naturalPerson: {
        newReceived: 60,
        carriedOver: 0,
        results: {
          granted: 59,
          partialGrant: 1,
          denied: {
            stateSecret: 0,
            lawForbidden: 0,
            safetyStability: 0,
            thirdPartyRights: 0,
            internalAffairs: 0,
            processInfo: 0,
            enforcementCase: 0,
            adminQuery: 0,
          },
          unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
          notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
          other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 1 },
          totalProcessed: 61,
          carriedForward: 0,
        },
      },
      legalPerson: {
        commercial: {
          newReceived: 2,
          carriedOver: 0,
          results: {
            granted: 2,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 2,
            carriedForward: 0,
          },
        },
      },
      total: {
        newReceived: 62,
        carriedOver: 0,
        results: {
          granted: 61,
          partialGrant: 1,
          denied: {
            stateSecret: 0,
            lawForbidden: 0,
            safetyStability: 0,
            thirdPartyRights: 0,
            internalAffairs: 0,
            processInfo: 0,
            enforcementCase: 0,
            adminQuery: 0,
          },
          unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
          notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
          other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 1 },
          totalProcessed: 63,
          carriedForward: 0,
        },
      },
    };
    const parsedJson = { sections: [{ type: 'table_3', tableData }] };
    const ocrJson = {
      table_id: 'table_3',
      confidence: 0.99,
      unreadableCells: [],
      tableData: {
        columns: ['自然人', '商业企业', '总计'],
        rows: {
          '一、本年新收政府信息公开申请数量': [60, 2, 62],
          '二、上年结转政府信息公开申请数量': [0, 0, 0],
          '三、（一）予以公开': [59, 2, 61],
          '三、（二）部分公开': [1, 0, 1],
          '三、（三）不予公开-1.属于国家秘密': [0, 0, 0],
          '三、（三）不予公开-2.其他法律行政法规禁止公开': [0, 0, 0],
          '三、（三）不予公开-3.危及“三安全一稳定”': [0, 0, 0],
          '三、（三）不予公开-4.保护第三方合法权益': [0, 0, 0],
          '三、（三）不予公开-5.属于三类内部事务信息': [0, 0, 0],
          '三、（三）不予公开-6.属于四类过程性信息': [0, 0, 0],
          '三、（三）不予公开-7.属于行政执法案卷': [0, 0, 0],
          '三、（三）不予公开-8.属于行政查询事项': [0, 0, 0],
          '三、（四）无法提供-1.本机关不掌握相关政府信息': [0, 0, 0],
          '三、（四）无法提供-2.没有现成信息需要另行制作': [0, 0, 0],
          '三、（四）无法提供-3.补正后申请内容仍不明确': [0, 0, 0],
          '三、（五）不予处理-1.信访举报投诉类申请': [0, 0, 0],
          '三、（五）不予处理-2.重复申请': [0, 0, 0],
          '三、（五）不予处理-3.要求提供公开出版物': [0, 0, 0],
          '三、（五）不予处理-4.无正当理由大量反复申请': [0, 0, 0],
          '三、（五）不予处理-5.要求行政机关确认或重新出具已获取信息': [0, 0, 0],
          '三、（六）其他处理-1.申请人无正当理由逾期不补正，行政机关不再处理其政府信息公开申请': [0, 0, 0],
          '三、（六）其他处理-2.申请人逾期未按收费通知要求缴纳费用，行政机关不再处理其政府信息公开申请': [0, 0, 0],
          '三、（六）其他处理-3.其他': [1, 0, 1],
          '三、（七）总计': [61, 2, 63],
          '四、结转下年度继续办理': [0, 0, 0],
        },
      },
    };

    const result = compareVisionOcrWithParsed('table_3', parsedJson, ocrJson, [makeTrigger('table3', 'FAIL')]);

    expect(result.conclusion).toBe('source_table_anomaly');
    expect(result.differences).toHaveLength(0);
  });

  it('normalizes table 3 OCR rows with path/value maps before comparing', () => {
    const tableData = {
      naturalPerson: {
        newReceived: 60,
        carriedOver: 0,
        results: {
          granted: 59,
          partialGrant: 1,
          denied: { stateSecret: 0 },
          totalProcessed: 61,
          carriedForward: 0,
        },
      },
      legalPerson: {
        commercial: {
          newReceived: 2,
          carriedOver: 0,
          results: {
            granted: 2,
            partialGrant: 0,
            denied: { stateSecret: 0 },
            totalProcessed: 2,
            carriedForward: 0,
          },
        },
      },
      total: {
        newReceived: 62,
        carriedOver: 0,
        results: {
          granted: 61,
          partialGrant: 1,
          denied: { stateSecret: 0 },
          totalProcessed: 63,
          carriedForward: 0,
        },
      },
    };
    const parsedJson = { sections: [{ type: 'table_3', tableData }] };
    const makeRow = (path: string, naturalPerson: number, commercial: number, total: number) => ({
      path,
      values: {
        自然人: naturalPerson,
        商业企业: commercial,
        总计: total,
      },
    });
    const ocrJson = {
      table_id: 'table_3',
      confidence: 0.99,
      unreadableCells: [],
      tableData: {
        columns: ['自然人', '商业企业', '总计'],
        rows: [
          makeRow('一、本年新收政府信息公开申请数量', 60, 2, 62),
          makeRow('二、上年结转政府信息公开申请数量', 0, 0, 0),
          makeRow('三、本年度办理结果/（一）予以公开', 59, 2, 61),
          makeRow('三、本年度办理结果/（二）部分公开', 1, 0, 1),
          makeRow('三、本年度办理结果/（三）不予公开/1.属于国家秘密', 0, 0, 0),
          makeRow('三、本年度办理结果/（七）总计', 61, 2, 63),
          makeRow('四、结转下年度继续办理', 0, 0, 0),
        ],
      },
    };

    const result = compareVisionOcrWithParsed('table_3', parsedJson, ocrJson, [makeTrigger('table3', 'FAIL')]);

    expect(result.conclusion).toBe('source_table_anomaly');
    expect(result.differences).toHaveLength(0);
  });
});
