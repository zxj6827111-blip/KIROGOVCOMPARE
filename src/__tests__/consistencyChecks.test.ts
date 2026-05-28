import { buildConsistencyRunSummary, ConsistencyCheckService } from '../services/ConsistencyCheckService';
import { classifyConsistencyIssueType } from '../utils/consistencyIssueType';

jest.mock('../config/database-llm', () => ({
    __esModule: true,
    default: {
        query: jest.fn(),
        connect: jest.fn(),
    },
}));

import pool from '../config/database-llm';

const mockedQuery = pool.query as jest.Mock;

describe('ConsistencyCheckService', () => {
    let service: ConsistencyCheckService;

    beforeEach(() => {
        service = new ConsistencyCheckService();
        mockedQuery.mockReset();
    });

    describe('buildConsistencyRunSummary', () => {
        it('preserves top-level compatibility while adding auto/human/active counts', () => {
            const summary = buildConsistencyRunSummary([
                { groupKey: 'text', autoStatus: 'FAIL', humanStatus: 'pending' },
                { groupKey: 'text', autoStatus: 'UNCERTAIN', humanStatus: 'pending' },
                { groupKey: 'table3', autoStatus: 'PASS', humanStatus: 'pending' },
                { groupKey: 'table2', autoStatus: 'NOT_ASSESSABLE' },
                { groupKey: 'table4', autoStatus: 'FAIL', humanStatus: 'confirmed' },
                { groupKey: 'table4', autoStatus: 'FAIL', humanStatus: 'dismissed' },
            ]);

            expect(summary).toMatchObject({
                fail: 3,
                uncertain: 1,
                pass: 1,
                notAssessable: 1,
                total: 6,
                auto: {
                    fail: 3,
                    uncertain: 1,
                    pass: 1,
                    notAssessable: 1,
                },
                human: {
                    pending: 3,
                    confirmed: 2,
                    dismissed: 1,
                },
                active: {
                    rawFailCount: 3,
                    activeProblemCount: 2,
                    reviewCount: 2,
                },
            });
        });

        it('builds byGroupKey with the same counting rules', () => {
            const summary = buildConsistencyRunSummary([
                { groupKey: 'text', autoStatus: 'FAIL', humanStatus: 'pending' },
                { groupKey: 'table2', autoStatus: 'NOT_ASSESSABLE', humanStatus: 'pending' },
                { groupKey: 'table3', autoStatus: 'UNCERTAIN', humanStatus: 'pending' },
                { groupKey: 'table3', autoStatus: 'FAIL', humanStatus: 'dismissed' },
                { groupKey: 'table3', autoStatus: 'FAIL', humanStatus: 'confirmed' },
            ]);

            expect(summary.byGroupKey.text).toMatchObject({
                total: 1,
                fail: 1,
                uncertain: 0,
                pass: 0,
                notAssessable: 0,
                pending: 1,
                confirmed: 0,
                dismissed: 0,
                rawFailCount: 1,
                activeProblemCount: 1,
                reviewCount: 1,
            });
            expect(summary.byGroupKey.table2).toMatchObject({
                total: 1,
                fail: 0,
                uncertain: 0,
                pass: 0,
                notAssessable: 1,
                pending: 1,
                confirmed: 0,
                dismissed: 0,
                rawFailCount: 0,
                activeProblemCount: 0,
                reviewCount: 0,
            });
            expect(summary.byGroupKey.table3).toMatchObject({
                total: 3,
                fail: 2,
                uncertain: 1,
                pass: 0,
                notAssessable: 0,
                pending: 1,
                confirmed: 1,
                dismissed: 1,
                rawFailCount: 2,
                activeProblemCount: 1,
                reviewCount: 1,
            });
        });

        it('treats PASS as reviewed without making it pending review', () => {
            const summary = buildConsistencyRunSummary([
                { groupKey: 'table3', autoStatus: 'PASS', humanStatus: 'pending' },
                { groupKey: 'table3', autoStatus: 'PASS', humanStatus: 'confirmed' },
                { groupKey: 'table3', autoStatus: 'UNCERTAIN', humanStatus: 'confirmed' },
            ]);

            expect(summary.human).toMatchObject({
                pending: 0,
                confirmed: 3,
                dismissed: 0,
            });
            expect(summary.byGroupKey.table3).toMatchObject({
                total: 3,
                pass: 2,
                uncertain: 1,
                confirmed: 3,
                reviewCount: 0,
            });
        });

        it('keeps hierarchy completeness prompts visible and inside actionable review counts', () => {
            const summary = buildConsistencyRunSummary([
                {
                    groupKey: 'hierarchy',
                    checkKey: 'hierarchy_sum_v2_application__total__new_received',
                    autoStatus: 'FAIL',
                    humanStatus: 'pending',
                },
                {
                    groupKey: 'hierarchy',
                    checkKey: 'hierarchy_missing_child_reports',
                    autoStatus: 'UNCERTAIN',
                    humanStatus: 'pending',
                },
                {
                    groupKey: 'hierarchy',
                    checkKey: 'hierarchy_missing_child_metrics',
                    autoStatus: 'UNCERTAIN',
                    humanStatus: 'pending',
                },
            ]);

            expect(summary).toMatchObject({
                fail: 1,
                uncertain: 2,
                human: {
                    pending: 3,
                },
                active: {
                    reviewCount: 3,
                },
            });
            expect(summary.byGroupKey.hierarchy).toMatchObject({
                reviewCount: 3,
                uncertain: 2,
            });
        });
    });

    describe('section title quality checks', () => {
        it('flags dirty and misnumbered standard annual report section titles', () => {
            const items = service.runChecks({
                sections: [
                    { type: 'text', title: '一、总体情况', content: '总体情况内容' },
                    { type: 'table_2', title: '三、主动公开政府信息情况', activeDisclosureData: {} },
                    { type: 'table_3', title: '四、收到和处理政府信息公开申请情况', tableData: {} },
                    { type: 'table_4', title: '五、政府信息公开行政复议、行政诉讼情况', reviewLitigationData: {} },
                    { type: 'text', title: 'l六、存在的主要问题及改进情况', content: '问题和改进内容' },
                    { type: 'text', title: '七、其他需要报告的事项', content: '其他事项内容' },
                ],
            });

            const titleIssues = items.filter((item) => item.checkKey === 'section_title_misnumbered');
            expect(titleIssues).toHaveLength(5);
            expect(titleIssues).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    groupKey: 'quality',
                    autoStatus: 'FAIL',
                    title: '章节标题疑似有误：“三、主动公开政府信息情况”应按“二、主动公开政府信息情况”理解',
                    evidenceJson: expect.objectContaining({
                        paths: ['sections[1].title'],
                        values: expect.objectContaining({
                            normalizedTitle: '二、主动公开政府信息情况',
                            actualOrdinal: '三',
                            expectedOrdinal: '二',
                        }),
                    }),
                }),
                expect.objectContaining({
                    groupKey: 'quality',
                    autoStatus: 'FAIL',
                    title: '章节标题疑似有误：“四、收到和处理政府信息公开申请情况”应按“三、收到和处理政府信息公开申请情况”理解',
                    evidenceJson: expect.objectContaining({
                        paths: ['sections[2].title'],
                        values: expect.objectContaining({
                            normalizedTitle: '三、收到和处理政府信息公开申请情况',
                            actualOrdinal: '四',
                            expectedOrdinal: '三',
                        }),
                    }),
                }),
                expect.objectContaining({
                    groupKey: 'quality',
                    autoStatus: 'FAIL',
                    title: '章节标题疑似有误：“五、政府信息公开行政复议、行政诉讼情况”应按“四、政府信息公开行政复议、行政诉讼情况”理解',
                    evidenceJson: expect.objectContaining({
                        paths: ['sections[3].title'],
                        values: expect.objectContaining({
                            normalizedTitle: '四、政府信息公开行政复议、行政诉讼情况',
                            actualOrdinal: '五',
                            expectedOrdinal: '四',
                        }),
                    }),
                }),
                expect.objectContaining({
                    groupKey: 'quality',
                    autoStatus: 'FAIL',
                    title: '章节标题疑似有误：“l六、存在的主要问题及改进情况”应按“五、存在的主要问题及改进情况”理解',
                    evidenceJson: expect.objectContaining({
                        paths: ['sections[4].title'],
                        values: expect.objectContaining({
                            normalizedTitle: '五、存在的主要问题及改进情况',
                            actualOrdinal: '六',
                            expectedOrdinal: '五',
                        }),
                    }),
                }),
                expect.objectContaining({
                    groupKey: 'quality',
                    autoStatus: 'FAIL',
                    title: '章节标题疑似有误：“七、其他需要报告的事项”应按“六、其他需要报告的事项”理解',
                    evidenceJson: expect.objectContaining({
                        paths: ['sections[5].title'],
                        values: expect.objectContaining({
                            normalizedTitle: '六、其他需要报告的事项',
                            actualOrdinal: '七',
                            expectedOrdinal: '六',
                        }),
                    }),
                }),
            ]));
        });

        it('does not flag accepted wording variants when ordinal is already correct', () => {
            const items = service.runChecks({
                sections: [
                    { type: 'text', title: '五、存在的主要问题和改进情况', content: '问题和改进内容' },
                    { type: 'text', title: '六、其他需要报告的事项', content: '其他事项内容' },
                ],
            });

            expect(items.filter((item) => item.checkKey === 'section_title_misnumbered')).toHaveLength(0);
        });
    });

    describe('classifyConsistencyIssueType', () => {
        it('classifies text items as consistency_text', () => {
            expect(classifyConsistencyIssueType({ group_key: 'text', check_key: 'text_vs_table3_totalProcessed' }))
                .toBe('consistency_text');
        });

        it('classifies table2 rule items and t2_no_rules fallback correctly', () => {
            expect(classifyConsistencyIssueType({
                group_key: 'table2',
                check_key: 't2_non_negative_counts_regulations_valid',
                auto_status: 'FAIL',
            })).toBe('consistency_table2');

            expect(classifyConsistencyIssueType({
                group_key: 'table2',
                check_key: 't2_no_rules',
                auto_status: 'NOT_ASSESSABLE',
            })).toBe('unsupported_not_assessable');
        });

        it('classifies table3 identity, result_total and column_sum with correct priority', () => {
            expect(classifyConsistencyIssueType({
                group_key: 'table3',
                check_key: 't3_identity_total',
            })).toBe('consistency_table3_identity');

            expect(classifyConsistencyIssueType({
                group_key: 'table3',
                check_key: 't3_result_total_total',
            })).toBe('consistency_table3_result_total');

            expect(classifyConsistencyIssueType({
                group_key: 'table3',
                check_key: 't3_column_sum_total',
            })).toBe('consistency_table3_column_sum');

            expect(classifyConsistencyIssueType({
                group_key: 'table3',
                check_key: 't3_result_total_total',
                title: '各列求和=总计（办理结果总计）',
            })).toBe('consistency_table3_column_sum');
        });

        it('classifies table4 items as consistency_table4_row_sum', () => {
            expect(classifyConsistencyIssueType({
                group_key: 'table4',
                check_key: 't4_sum_review',
            })).toBe('consistency_table4_row_sum');
        });

        it('classifies hierarchy aggregation items separately', () => {
            expect(classifyConsistencyIssueType({
                group_key: 'hierarchy',
                check_key: 'hierarchy_sum_v2_application__total__new_received',
                auto_status: 'FAIL',
            })).toBe('consistency_hierarchy_sum');

            expect(classifyConsistencyIssueType({
                group_key: 'hierarchy',
                check_key: 'hierarchy_no_direct_children',
                auto_status: 'NOT_ASSESSABLE',
            })).toBe('unsupported_not_assessable');

            expect(classifyConsistencyIssueType({
                group_key: 'hierarchy',
                check_key: 'hierarchy_missing_child_reports',
                auto_status: 'UNCERTAIN',
            })).toBe('hierarchy_missing_report');

            expect(classifyConsistencyIssueType({
                group_key: 'hierarchy',
                check_key: 'hierarchy_no_child_reports',
                auto_status: 'UNCERTAIN',
            })).toBe('hierarchy_missing_report');

            expect(classifyConsistencyIssueType({
                group_key: 'hierarchy',
                check_key: 'hierarchy_missing_child_metrics',
                auto_status: 'UNCERTAIN',
            })).toBe('hierarchy_missing_field');

            expect(classifyConsistencyIssueType({
                group_key: 'hierarchy',
                check_key: 'hierarchy_no_child_metrics',
                auto_status: 'UNCERTAIN',
            })).toBe('hierarchy_missing_field');
        });

        it('classifies quality empty, text extraction and structure items', () => {
            expect(classifyConsistencyIssueType({
                group_key: 'quality',
                check_key: 'table_empty_cells',
            })).toBe('quality_empty');

            expect(classifyConsistencyIssueType({
                group_key: 'quality',
                check_key: 'narrative_sec5_gap',
            })).toBe('quality_text_extraction');

            expect(classifyConsistencyIssueType({
                group_key: 'structure',
                check_key: 'table_missing_3',
            })).toBe('quality_structure');
        });

        it('classifies source anomaly, not assessable fallback and unknown items', () => {
            expect(classifyConsistencyIssueType({
                group_key: 'visual',
                check_key: 'some_check',
                title: 'source_table_anomaly',
            })).toBe('source_anomaly');

            expect(classifyConsistencyIssueType({
                group_key: 'custom',
                check_key: 'custom_na',
                auto_status: 'NOT_ASSESSABLE',
            })).toBe('unsupported_not_assessable');

            expect(classifyConsistencyIssueType({
                group_key: 'custom',
                check_key: 'custom_rule',
                auto_status: 'FAIL',
            })).toBe('unknown');
        });
    });

    // Minimal fixture with Table 3 and Table 4 data
    const minimalFixture = {
        sections: [
            {
                type: 'table_3',
                tableData: {
                    naturalPerson: {
                        newReceived: 100,
                        carriedOver: 10,
                        results: {
                            granted: 50,
                            partialGrant: 20,
                            denied: {
                                stateSecret: 1,
                                lawForbidden: 2,
                                safetyStability: 1,
                                thirdPartyRights: 1,
                                internalAffairs: 1,
                                processInfo: 1,
                                enforcementCase: 1,
                                adminQuery: 1,
                            },
                            unableToProvide: {
                                noInfo: 3,
                                needCreation: 2,
                                unclear: 1,
                            },
                            notProcessed: {
                                complaint: 1,
                                repeat: 1,
                                publication: 1,
                                massiveRequests: 1,
                                confirmInfo: 1,
                            },
                            other: {
                                overdueCorrection: 1,
                                overdueFee: 1,
                                otherReasons: 1,
                            },
                            totalProcessed: 95, // Should be 50+20+9+6+5+3 = 93, so this is wrong
                            carriedForward: 15,
                        },
                    },
                    legalPerson: {
                        commercial: {
                            newReceived: 50,
                            carriedOver: 5,
                            results: {
                                granted: 30,
                                partialGrant: 10,
                                denied: { stateSecret: 0, lawForbidden: 0, safetyStability: 0, thirdPartyRights: 0, internalAffairs: 0, processInfo: 0, enforcementCase: 0, adminQuery: 0 },
                                unableToProvide: { noInfo: 2, needCreation: 1, unclear: 0 },
                                notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
                                other: { overdueCorrection: 1, overdueFee: 1, otherReasons: 0 },
                                totalProcessed: 45, // 30+10+0+3+0+2 = 45
                                carriedForward: 10,
                            },
                        },
                        research: {
                            newReceived: 10,
                            carriedOver: 0,
                            results: {
                                granted: 8,
                                partialGrant: 2,
                                denied: { stateSecret: 0, lawForbidden: 0, safetyStability: 0, thirdPartyRights: 0, internalAffairs: 0, processInfo: 0, enforcementCase: 0, adminQuery: 0 },
                                unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
                                notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
                                other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
                                totalProcessed: 10,
                                carriedForward: 0,
                            },
                        },
                        social: {
                            newReceived: 5,
                            carriedOver: 0,
                            results: {
                                granted: 5,
                                partialGrant: 0,
                                denied: { stateSecret: 0, lawForbidden: 0, safetyStability: 0, thirdPartyRights: 0, internalAffairs: 0, processInfo: 0, enforcementCase: 0, adminQuery: 0 },
                                unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
                                notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
                                other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
                                totalProcessed: 5,
                                carriedForward: 0,
                            },
                        },
                        legal: {
                            newReceived: 3,
                            carriedOver: 0,
                            results: {
                                granted: 3,
                                partialGrant: 0,
                                denied: { stateSecret: 0, lawForbidden: 0, safetyStability: 0, thirdPartyRights: 0, internalAffairs: 0, processInfo: 0, enforcementCase: 0, adminQuery: 0 },
                                unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
                                notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
                                other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
                                totalProcessed: 3,
                                carriedForward: 0,
                            },
                        },
                        other: {
                            newReceived: 2,
                            carriedOver: 0,
                            results: {
                                granted: 2,
                                partialGrant: 0,
                                denied: { stateSecret: 0, lawForbidden: 0, safetyStability: 0, thirdPartyRights: 0, internalAffairs: 0, processInfo: 0, enforcementCase: 0, adminQuery: 0 },
                                unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
                                notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
                                other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
                                totalProcessed: 2,
                                carriedForward: 0,
                            },
                        },
                    },
                    total: {
                        newReceived: 170, // 100+50+10+5+3+2
                        carriedOver: 15, // 10+5+0+0+0+0
                        results: {
                            granted: 98, // 50+30+8+5+3+2
                            partialGrant: 32, // 20+10+2+0+0+0
                            denied: { stateSecret: 1, lawForbidden: 2, safetyStability: 1, thirdPartyRights: 1, internalAffairs: 1, processInfo: 1, enforcementCase: 1, adminQuery: 1 },
                            unableToProvide: { noInfo: 5, needCreation: 3, unclear: 1 },
                            notProcessed: { complaint: 1, repeat: 1, publication: 1, massiveRequests: 1, confirmInfo: 1 },
                            other: { overdueCorrection: 2, overdueFee: 2, otherReasons: 1 },
                            totalProcessed: 160, // This should match sum of all entities' totalProcessed
                            carriedForward: 25, // 15+10+0+0+0+0
                        },
                    },
                },
            },
            {
                type: 'table_4',
                reviewLitigationData: {
                    review: {
                        maintain: 5,
                        correct: 2,
                        other: 1,
                        unfinished: 2,
                        total: 10, // Should be 5+2+1+2=10 ✓
                    },
                    litigationDirect: {
                        maintain: 3,
                        correct: 1,
                        other: 0,
                        unfinished: 1,
                        total: 6, // Should be 3+1+0+1=5, so this is wrong
                    },
                    litigationPostReview: {
                        maintain: 1,
                        correct: 0,
                        other: 0,
                        unfinished: 0,
                        total: 1, // Should be 1+0+0+0=1 ✓
                    },
                },
            },
            {
                type: 'text',
                content: '本年度共新收政府信息公开申请170件，上年结转15件。'
            }
        ],
    };

    describe('runChecks', () => {
        it('should generate items for table3', () => {
            const items = service.runChecks(minimalFixture);
            const table3Items = items.filter(i => i.groupKey === 'table3');

            expect(table3Items.length).toBeGreaterThan(0);
        });

        it('should generate items for table4', () => {
            const items = service.runChecks(minimalFixture);
            const table4Items = items.filter(i => i.groupKey === 'table4');

            expect(table4Items.length).toBeGreaterThan(0);
        });

        it('should generate items with proper title format including Chinese column names', () => {
            const items = service.runChecks(minimalFixture);

            // Check that titles follow the format: "表三：...（XXX列）" or "表四：...（XXX）"
            const table3Items = items.filter(i => i.groupKey === 'table3');
            const hasProperTable3Title = table3Items.some(item =>
                item.title.includes('表三：') &&
                (item.title.includes('列）') || item.title.includes('合计校验）'))
            );
            expect(hasProperTable3Title).toBe(true);

            const table4Items = items.filter(i => i.groupKey === 'table4');
            const hasProperTable4Title = table4Items.some(item =>
                item.title.includes('表四：') && item.title.includes('）')
            );
            expect(hasProperTable4Title).toBe(true);
        });

        it('should detect FAIL status when totalProcessed does not match sum of components', () => {
            const items = service.runChecks(minimalFixture);

            // naturalPerson has totalProcessed=95 but sum should be 93
            const naturalPersonResultItem = items.find(i =>
                i.groupKey === 'table3' &&
                i.checkKey.includes('t3_result_total_naturalPerson')
            );

            expect(naturalPersonResultItem).toBeDefined();
            expect(naturalPersonResultItem?.autoStatus).toBe('FAIL');
        });

        it('should detect FAIL status for table4 when sum does not match total', () => {
            const items = service.runChecks(minimalFixture);

            // litigationDirect has total=6 but sum should be 5
            const litigationItem = items.find(i =>
                i.groupKey === 'table4' &&
                i.checkKey.includes('litigationDirect')
            );

            expect(litigationItem).toBeDefined();
            expect(litigationItem?.autoStatus).toBe('FAIL');
        });

        it('should generate stable fingerprints across multiple runs', () => {
            const items1 = service.runChecks(minimalFixture);
            const items2 = service.runChecks(minimalFixture);

            expect(items1.length).toBe(items2.length);

            for (let i = 0; i < items1.length; i++) {
                expect(items1[i].fingerprint).toBe(items2[i].fingerprint);
            }
        });

        it('should include evidence_json with paths and values', () => {
            const items = service.runChecks(minimalFixture);

            for (const item of items) {
                expect(item.evidenceJson).toBeDefined();
                expect(item.evidenceJson.paths).toBeDefined();
                expect(Array.isArray(item.evidenceJson.paths)).toBe(true);
                expect(item.evidenceJson.values).toBeDefined();
                expect(typeof item.evidenceJson.values).toBe('object');
            }
        });

        it('should handle missing table3 with NOT_ASSESSABLE status', () => {
            const fixtureWithoutTable3 = {
                sections: [
                    { type: 'table_4', reviewLitigationData: { review: { maintain: 1, correct: 0, other: 0, unfinished: 0, total: 1 } } }
                ]
            };

            const items = service.runChecks(fixtureWithoutTable3);
            const table3Missing = items.find(i => i.groupKey === 'table3' && i.checkKey === 't3_missing');

            expect(table3Missing).toBeDefined();
            expect(table3Missing?.autoStatus).toBe('NOT_ASSESSABLE');
        });

        it('should handle string input (JSON string)', () => {
            const jsonString = JSON.stringify(minimalFixture);
            const items = service.runChecks(jsonString);

            expect(items.length).toBeGreaterThan(0);
        });

        it('should surface parse rule gate failures as review items', () => {
            const items = service.runChecks({
                ...minimalFixture,
                parse_rule_gate: {
                    passed: false,
                    issues: ['table_3.total.results.totalProcessed expected 2, got 3'],
                },
            });

            const gateItem = items.find(item => item.checkKey === 'parse_rule_gate_1');
            expect(gateItem).toBeTruthy();
            expect(gateItem?.groupKey).toBe('table3');
            expect(gateItem?.autoStatus).toBe('FAIL');
            expect(gateItem?.evidenceJson.values.issue).toBe('table_3.total.results.totalProcessed expected 2, got 3');
        });

        it('should generate text items when text content matches table values', () => {
            // Add litigation text to fixture
            const fixtureWithLitigation = {
                ...minimalFixture,
                sections: [
                    ...minimalFixture.sections,
                    {
                        type: 'text',
                        content: '全年发生行政诉讼案件7件。' // 6 (direct) + 1 (postReview) = 7
                    }
                ]
            };

            const items = service.runChecks(fixtureWithLitigation);
            const textItems = items.filter(i => i.groupKey === 'text');

            // Our fixture has text: "本年度共新收政府信息公开申请170件，上年结转15件。"
            // This should match newReceived=170 and carriedOver=15
            expect(textItems.length).toBeGreaterThan(0);

            // Verify Litigation check
            const litigationItem = textItems.find(i => i.checkKey.includes('litigationTotal'));
            expect(litigationItem).toBeDefined();
            expect(litigationItem?.leftValue).toBe(7);
            expect(litigationItem?.rightValue).toBe(7); // 6 + 1
            expect(litigationItem?.autoStatus).toBe('PASS');
        });

        it('should prefer the reply count when received and replied counts appear in the same sentence', () => {
            const fixtureWithReceivedAndReplyCounts = {
                sections: [
                    {
                        type: 'table_3',
                        tableData: {
                            total: {
                                newReceived: 3259,
                                carriedOver: 77,
                                results: {
                                    totalProcessed: 3278,
                                    carriedForward: 58,
                                },
                            },
                        },
                    },
                    {
                        type: 'text',
                        content: '2025年，全市共受理政府信息公开申请3259件，答复3278件（含上年度结转申请77件，另有58件顺延到下年度答复）。',
                    },
                ],
            };

            const items = service.runChecks(fixtureWithReceivedAndReplyCounts);
            const processedItem = items.find(i => i.checkKey === 'text_vs_table3_totalProcessed');

            expect(processedItem).toBeDefined();
            expect(processedItem?.leftValue).toBe(3278);
            expect(processedItem?.rightValue).toBe(3278);
            expect(processedItem?.autoStatus).toBe('PASS');
        });

        it('should not treat a following withdrawn count as total processed', () => {
            const fixtureWithWithdrawnBranchCount = {
                sections: [
                    {
                        type: 'table_3',
                        tableData: {
                            total: {
                                newReceived: 19,
                                carriedOver: 0,
                                results: {
                                    totalProcessed: 19,
                                    carriedForward: 0,
                                },
                            },
                        },
                    },
                    {
                        type: 'text',
                        title: '一、总体情况',
                        content: '2025 年打浦桥街道共受理政府信息公开申请 19 件，其中 11 件均按规定程序办结，8 件申请人主动撤销。',
                    },
                ],
            };

            const items = service.runChecks(fixtureWithWithdrawnBranchCount);
            const processedItem = items.find(i => i.checkKey === 'text_vs_table3_totalProcessed');

            expect(processedItem).toBeUndefined();
        });

        it('should not treat carried-over handling text as total processed when a reply count follows', () => {
            const fixtureWithCarriedOverAndReplyCounts = {
                sections: [
                    {
                        type: 'table_3',
                        tableData: {
                            total: {
                                newReceived: 10,
                                carriedOver: 1,
                                results: {
                                    totalProcessed: 11,
                                    carriedForward: 0,
                                },
                            },
                        },
                    },
                    {
                        type: 'text',
                        title: '一、总体情况',
                        content: '2025年受理信息公开申请10件，办理上年度结转申请1件。答复11件，均在法定期限内答复。',
                    },
                ],
            };

            const items = service.runChecks(fixtureWithCarriedOverAndReplyCounts);
            const processedItem = items.find(i => i.checkKey === 'text_vs_table3_totalProcessed');

            expect(processedItem).toBeDefined();
            expect(processedItem?.leftValue).toBe(11);
            expect(processedItem?.rightValue).toBe(11);
            expect(processedItem?.autoStatus).toBe('PASS');
            expect(processedItem?.evidenceJson.values.matchedText).toBe('答复11件');
        });
    });

    // ... (existing fingerprint stability test) ...
    describe('fingerprint stability', () => {
        it('should produce the same fingerprint for the same groupKey+checkKey+expr', () => {
            // Run twice with the same input
            const items1 = service.runChecks(minimalFixture);
            const items2 = service.runChecks(minimalFixture);

            // Create maps for comparison
            const map1 = new Map(items1.map(i => [i.checkKey, i.fingerprint]));
            const map2 = new Map(items2.map(i => [i.checkKey, i.fingerprint]));

            for (const [key, fp1] of map1) {
                const fp2 = map2.get(key);
                expect(fp2).toBe(fp1);
            }
        });
    });

    // NEW TESTS FOR PREMIUM AUDIT FEATURES
    describe('Premium Audit Checks', () => {

        it('should FAIL visual audit when borders are missing', () => {
            const visualFixture = {
                ...minimalFixture,
                visual_audit: { border_missing: true }
            };
            const items = service.runChecks(visualFixture);

            const visualItem = items.find(i => i.checkKey === 'visual_border_missing');
            // 2026-02: Visual border checks are intentionally disabled due high false-positive rate.
            expect(visualItem).toBeUndefined();
        });

        it('should FAIL structure audit when Table 3 section exists but table data is missing', () => {
            const structureFixture = {
                sections: [
                    { title: '三、收到和处理政府信息公开申请情况', type: 'table_3', tableData: {} } // Empty data
                ]
            };
            const items = service.runChecks(structureFixture);

            const structItem = items.find(i => i.checkKey === 'visual_table3_missing');
            expect(structItem).toBeDefined();
            expect(structItem?.autoStatus).toBe('FAIL');
        });

        it('should FAIL narrative audit when Section 5 content is "无"', () => {
            const sec5Fixture = {
                sections: [
                    { title: '五、存在的主要问题及改进情况', type: 'text', content: '无' }
                ]
            };
            const items = service.runChecks(sec5Fixture);

            const sec5Item = items.find(i => i.checkKey === 'narrative_sec5_gap');
            expect(sec5Item).toBeDefined();
            expect(sec5Item?.autoStatus).toBe('FAIL');
        });

        it('should FAIL narrative audit when Section 5 content is too short', () => {
            const sec5Fixture = {
                sections: [
                    { title: '五、存在的主要问题及改进情况', type: 'text', content: '暂无问题' } // 4 chars < 10
                ]
            };
            const items = service.runChecks(sec5Fixture);

            const sec5Item = items.find(i => i.checkKey === 'narrative_sec5_gap');
            expect(sec5Item).toBeDefined();
            expect(sec5Item?.autoStatus).toBe('FAIL');
        });

        it('should FAIL narrative audit when Section 6 says "无" but fees exist', () => {
            const sec6Fixture = {
                sections: [
                    {
                        type: 'table_2',
                        activeDisclosureData: {
                            fees: { amount: 100 }
                        }
                    },
                    { title: '六、其他需要报告的事项', type: 'text', content: '无' }
                ]
            };
            const items = service.runChecks(sec6Fixture);

            const sec6Item = items.find(i => i.checkKey === 'narrative_sec6_fee_conflict');
            expect(sec6Item).toBeDefined();
            expect(sec6Item?.autoStatus).toBe('FAIL');
            expect(sec6Item?.leftValue).toBe(100);
        });

        it('should PASS narrative audit when Section 6 says "无" and NO fees exist', () => {
            const sec6Fixture = {
                sections: [
                    {
                        type: 'table_2',
                        activeDisclosureData: {
                            fees: { amount: 0 }
                        }
                    },
                    { title: '六、其他需要报告的事项', type: 'text', content: '无' }
                ]
            };
            const items = service.runChecks(sec6Fixture);

            const sec6Item = items.find(i => i.checkKey === 'narrative_sec6_fee_conflict');
            expect(sec6Item).toBeUndefined(); // Should not generate a fail item
        });
    });
    describe('Table2 low-risk rules', () => {
        const makeTable2Fixture = (activeDisclosureData: any) => ({
            sections: [
                {
                    type: 'table_2',
                    activeDisclosureData,
                },
            ],
        });

        it('triggers FAIL for negative count fields and suppresses t2_no_rules when table2 rules exist', () => {
            const items = service.runChecks(makeTable2Fixture({
                regulations: { valid: -1 },
            }));

            const item = items.find(i => i.checkKey === 't2_non_negative_counts_regulations_valid');
            expect(item).toBeDefined();
            expect(item?.groupKey).toBe('table2');
            expect(item?.autoStatus).toBe('FAIL');
            expect(item?.leftValue).toBe(-1);
            expect(item?.rightValue).toBe(0);
            expect(item?.evidenceJson.paths).toEqual(['activeDisclosureData.regulations.valid']);
            expect(item?.evidenceJson.values.cell_ref).toBe('active_disclosure:regulations:valid');
            expect(item?.evidenceJson.values.reason).toBe('count_field_negative');
            expect(items.find(i => i.checkKey === 't2_no_rules')).toBeUndefined();
            expect(classifyConsistencyIssueType({
                group_key: item?.groupKey,
                check_key: item?.checkKey,
                title: item?.title,
                expr: item?.expr,
                auto_status: item?.autoStatus,
                evidence: item?.evidenceJson,
            })).toBe('consistency_table2');
        });

        it('triggers UNCERTAIN for decimal count fields', () => {
            const items = service.runChecks(makeTable2Fixture({
                licensing: { processed: 1.5 },
            }));

            const item = items.find(i => i.checkKey === 't2_integer_counts_licensing_processed');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('UNCERTAIN');
            expect(item?.leftValue).toBe(1.5);
            expect(item?.evidenceJson.values.reason).toBe('count_field_not_integer');
        });

        it('triggers UNCERTAIN for non-numeric count fields', () => {
            const items = service.runChecks(makeTable2Fixture({
                punishment: { processed: 'abc' },
            }));

            const item = items.find(i => i.checkKey === 't2_numeric_parseable_counts_punishment_processed');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('UNCERTAIN');
            expect(item?.leftValue).toBeNull();
            expect(item?.evidenceJson.values.raw).toBe('abc');
            expect(item?.evidenceJson.values.reason).toBe('count_field_not_numeric');
        });

        it('does not flag decimal fee amount as integer issue or amount error', () => {
            const items = service.runChecks(makeTable2Fixture({
                fees: { amount: 3415.74 },
            }));

            expect(items.find(i => i.checkKey.includes('fees_amount'))).toBeUndefined();
            expect(items.find(i => i.checkKey === 't2_no_rules')).toBeUndefined();
        });

        it('triggers FAIL for negative fee amount', () => {
            const items = service.runChecks(makeTable2Fixture({
                fees: { amount: -10 },
            }));

            const item = items.find(i => i.checkKey === 't2_non_negative_fee_amount_fees_amount');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('FAIL');
            expect(item?.leftValue).toBe(-10);
            expect(item?.rightValue).toBe(0);
            expect(item?.evidenceJson.values.reason).toBe('fee_amount_negative');
        });

        it('triggers only empty semantics hint for null count value', () => {
            const items = service.runChecks(makeTable2Fixture({
                coercion: { processed: null },
            }));

            const item = items.find(i => i.checkKey === 't2_empty_semantics_hint_coercion_processed');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('UNCERTAIN');
            expect(item?.evidenceJson.values.semantic).toBe('EMPTY');
            expect(items.filter(i => i.groupKey === 'table2')).toHaveLength(1);
        });

        it('triggers only empty semantics hint for slash placeholder', () => {
            const items = service.runChecks(makeTable2Fixture({
                regulations: { made: '/' },
            }));

            const item = items.find(i => i.checkKey === 't2_empty_semantics_hint_regulations_made');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('UNCERTAIN');
            expect(item?.evidenceJson.values.semantic).toBe('NA');
        });

        it('triggers only empty semantics hint for em dash placeholder', () => {
            const items = service.runChecks(makeTable2Fixture({
                normativeDocuments: { valid: '—' },
            }));

            const item = items.find(i => i.checkKey === 't2_empty_semantics_hint_normativeDocuments_valid');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('UNCERTAIN');
            expect(item?.evidenceJson.values.semantic).toBe('NA');
        });

        it('triggers only empty semantics hint for 不适用 placeholder', () => {
            const items = service.runChecks(makeTable2Fixture({
                licensing: { processed: '不适用' },
            }));

            const item = items.find(i => i.checkKey === 't2_empty_semantics_hint_licensing_processed');
            expect(item).toBeDefined();
            expect(item?.autoStatus).toBe('UNCERTAIN');
            expect(item?.evidenceJson.values.semantic).toBe('NA');
        });

        it('does not flag zero as empty semantics or anomaly', () => {
            const items = service.runChecks(makeTable2Fixture({
                punishment: { processed: 0 },
            }));

            expect(items.filter(i => i.groupKey === 'table2')).toHaveLength(0);
        });

        it('keeps t2_no_rules as fallback when table2 is absent', () => {
            const items = service.runChecks({ sections: [] });
            const fallback = items.find(i => i.checkKey === 't2_no_rules');

            expect(fallback).toBeDefined();
            expect(fallback?.autoStatus).toBe('NOT_ASSESSABLE');
            expect(fallback?.evidenceJson.values.hasTable2).toBe(false);
        });

        it('keeps t2_no_rules as fallback when table2 exists but has no supported fields', () => {
            const items = service.runChecks(makeTable2Fixture({}));
            const fallback = items.find(i => i.checkKey === 't2_no_rules');

            expect(fallback).toBeDefined();
            expect(fallback?.autoStatus).toBe('NOT_ASSESSABLE');
            expect(fallback?.evidenceJson.values.hasTable2).toBe(true);
            expect(classifyConsistencyIssueType({
                group_key: fallback?.groupKey,
                check_key: fallback?.checkKey,
                title: fallback?.title,
                expr: fallback?.expr,
                auto_status: fallback?.autoStatus,
                evidence: fallback?.evidenceJson,
            })).toBe('unsupported_not_assessable');
        });

        it('summarizes table2 low-risk rules without changing top-level compatibility', () => {
            const summary = buildConsistencyRunSummary([
                { groupKey: 'table2', autoStatus: 'FAIL', humanStatus: 'pending' },
                { groupKey: 'table2', autoStatus: 'FAIL', humanStatus: 'pending' },
                { groupKey: 'table2', autoStatus: 'UNCERTAIN', humanStatus: 'pending' },
                { groupKey: 'table2', autoStatus: 'UNCERTAIN', humanStatus: 'pending' },
                { groupKey: 'table2', autoStatus: 'UNCERTAIN', humanStatus: 'pending' },
            ]);

            expect(summary.fail).toBe(2);
            expect(summary.uncertain).toBe(3);
            expect(summary.pass).toBe(0);
            expect(summary.notAssessable).toBe(0);
            expect(summary.total).toBe(5);
            expect(summary.byGroupKey.table2).toMatchObject({
                total: 5,
                fail: 2,
                uncertain: 3,
                pass: 0,
                notAssessable: 0,
                pending: 5,
                confirmed: 0,
                dismissed: 0,
                rawFailCount: 2,
                activeProblemCount: 2,
                reviewCount: 5,
            });
        });

        it('produces the expected five table2 rules for mixed abnormal raw values', () => {
            const items = service.runChecks(makeTable2Fixture({
                regulations: { valid: -1 },
                licensing: { processed: 1.5 },
                punishment: { processed: 'abc' },
                fees: { amount: -10 },
                coercion: { processed: '/' },
                normativeDocuments: { valid: 0 },
            }));
            const table2Items = items.filter(i => i.groupKey === 'table2');
            const summary = buildConsistencyRunSummary(table2Items);

            expect(table2Items.map(i => i.checkKey).sort()).toEqual([
                't2_empty_semantics_hint_coercion_processed',
                't2_integer_counts_licensing_processed',
                't2_non_negative_counts_regulations_valid',
                't2_non_negative_fee_amount_fees_amount',
                't2_numeric_parseable_counts_punishment_processed',
            ]);
            expect(items.find(i => i.checkKey === 't2_no_rules')).toBeUndefined();
            expect(summary.byGroupKey.table2).toMatchObject({
                total: 5,
                rawFailCount: 2,
                activeProblemCount: 2,
                reviewCount: 5,
                fail: 2,
                uncertain: 3,
                notAssessable: 0,
            });
        });

        it('keeps t2_no_rules fallback out of activeProblemCount and reviewCount', () => {
            const items = service.runChecks(makeTable2Fixture({}));
            const summary = buildConsistencyRunSummary(items);
            const table2Items = items.filter(i => i.groupKey === 'table2');

            expect(table2Items).toHaveLength(1);
            expect(table2Items[0].checkKey).toBe('t2_no_rules');
            expect(summary.byGroupKey.table2).toMatchObject({
                total: 1,
                fail: 0,
                uncertain: 0,
                pass: 0,
                notAssessable: 1,
                pending: 1,
                confirmed: 0,
                dismissed: 0,
                rawFailCount: 0,
                activeProblemCount: 0,
                reviewCount: 0,
            });
        });
    });

    describe('issueType classification on generated items', () => {
        it('classifies generated table3 items into identity, result_total and column_sum buckets', () => {
            const items = service.runChecks(minimalFixture).filter(i => i.groupKey === 'table3');

            const identityItem = items.find(i => i.checkKey.includes('identity'));
            const resultTotalItem = items.find(i => i.checkKey.includes('result_total'));
            const columnSumItem = items.find(i => i.checkKey.includes('column_sum') || i.checkKey.includes('col_sum'));

            expect(identityItem).toBeDefined();
            expect(resultTotalItem).toBeDefined();
            expect(columnSumItem).toBeDefined();

            expect(classifyConsistencyIssueType(identityItem!)).toBe('consistency_table3_identity');
            expect(classifyConsistencyIssueType(resultTotalItem!)).toBe('consistency_table3_result_total');
            expect(classifyConsistencyIssueType(columnSumItem!)).toBe('consistency_table3_column_sum');
        });

        it('classifies generated table4 items as row-sum issues', () => {
            const items = service.runChecks(minimalFixture).filter(i => i.groupKey === 'table4');

            expect(items.length).toBeGreaterThan(0);
            items.forEach((item) => {
                expect(classifyConsistencyIssueType(item)).toBe('consistency_table4_row_sum');
            });
        });
    });

    describe('hierarchy aggregation checks', () => {
        const mockSuccessfulRunPreamble = () => {
            mockedQuery
                .mockResolvedValueOnce({ rows: [{ year: 2024 }] })
                .mockResolvedValueOnce({ rows: [{ id: 9001 }] });
        };

        const mockFinalPersistQueries = () => {
            mockedQuery.mockImplementation(async () => ({ rows: [] }));
        };

        it('keeps a visible hierarchy group when report region context is unavailable', async () => {
            mockSuccessfulRunPreamble();
            mockedQuery.mockResolvedValueOnce({ rows: [] });
            mockFinalPersistQueries();

            const result = await service.runAndPersist(1000, { sections: [] });
            const contextMissing = result.items.find((item) => item.checkKey === 'hierarchy_context_missing');

            expect(contextMissing).toMatchObject({
                groupKey: 'hierarchy',
                autoStatus: 'NOT_ASSESSABLE',
                title: '层级汇总一致性：当前报告未绑定可用区域层级',
            });
            expect(contextMissing?.evidenceJson.values).toMatchObject({
                reason: 'hierarchy_context_missing',
                reportVersionId: 1000,
            });
        });

        it('flags parent metric when it does not equal direct child report sum', async () => {
            mockSuccessfulRunPreamble();
            mockedQuery
                .mockResolvedValueOnce({
                    rows: [{
                        report_id: 100,
                        version_id: 1000,
                        region_id: 10,
                        region_name: '淮安市',
                        region_level: 2,
                        unit_name: '淮安市人民政府',
                        year: 2024,
                    }],
                })
                .mockResolvedValueOnce({
                    rows: [
                        { region_id: 11, region_name: '淮安区', region_level: 3, sort_order: 1, report_id: 101, version_id: 1001, unit_name: '淮安区人民政府' },
                        { region_id: 12, region_name: '清江浦区', region_level: 3, sort_order: 2, report_id: 102, version_id: 1002, unit_name: '清江浦区人民政府' },
                    ],
                })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({
                    rows: [
                        { report_id: 100, version_id: 1000, region_id: 10, region_name: '淮安市', applicant_type: 'total', response_type: 'new_received', count: 100 },
                        { report_id: 101, version_id: 1001, region_id: 11, region_name: '淮安区', applicant_type: 'total', response_type: 'new_received', count: 40 },
                        { report_id: 102, version_id: 1002, region_id: 12, region_name: '清江浦区', applicant_type: 'total', response_type: 'new_received', count: 50 },
                    ],
                })
                .mockResolvedValueOnce({ rows: [] });
            mockFinalPersistQueries();

            const result = await service.runAndPersist(1000, { sections: [] });
            const hierarchyItems = result.items.filter((item) => item.groupKey === 'hierarchy');
            const newReceived = hierarchyItems.find((item) => item.checkKey === 'hierarchy_sum_v2_application__total__new_received');

            expect(newReceived).toMatchObject({
                autoStatus: 'FAIL',
                leftValue: 100,
                rightValue: 90,
                delta: 10,
            });
            expect(newReceived?.evidenceJson.values).toMatchObject({
                metricLabel: '合计-本年新收',
                childReportCount: 2,
                childMetricCount: 2,
            });
        });

        it('keeps comparable hierarchy metrics PASS/FAIL and emits one completeness prompt when a child report is missing', async () => {
            mockSuccessfulRunPreamble();
            mockedQuery
                .mockResolvedValueOnce({
                    rows: [{
                        report_id: 100,
                        version_id: 1000,
                        region_id: 10,
                        region_name: '淮安市',
                        region_level: 2,
                        unit_name: '淮安市人民政府',
                        year: 2024,
                    }],
                })
                .mockResolvedValueOnce({
                    rows: [
                        { region_id: 11, region_name: '淮安区', region_level: 3, sort_order: 1, report_id: 101, version_id: 1001, unit_name: '淮安区人民政府' },
                        { region_id: 12, region_name: '清江浦区', region_level: 3, sort_order: 2, report_id: null, version_id: null, unit_name: null },
                    ],
                })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({
                    rows: [
                        { report_id: 100, version_id: 1000, region_id: 10, region_name: '淮安市', applicant_type: 'total', response_type: 'new_received', count: 40 },
                        { report_id: 101, version_id: 1001, region_id: 11, region_name: '淮安区', applicant_type: 'total', response_type: 'new_received', count: 40 },
                    ],
                })
                .mockResolvedValueOnce({ rows: [] });
            mockFinalPersistQueries();

            const result = await service.runAndPersist(1000, { sections: [] });
            const newReceived = result.items.find((item) => item.checkKey === 'hierarchy_sum_v2_application__total__new_received');
            const missingReports = result.items.find((item) => item.checkKey === 'hierarchy_missing_child_reports');

            expect(newReceived).toMatchObject({
                groupKey: 'hierarchy',
                autoStatus: 'PASS',
                leftValue: 40,
                rightValue: 40,
                delta: 0,
            });
            expect(newReceived?.evidenceJson.values.missingReports).toEqual([
                { regionId: 12, regionName: '清江浦区' },
            ]);
            expect(missingReports).toMatchObject({
                groupKey: 'hierarchy',
                autoStatus: 'UNCERTAIN',
                leftValue: null,
                rightValue: null,
                delta: null,
            });
            expect(missingReports?.evidenceJson.values).toMatchObject({
                reason: 'hierarchy_missing_child_reports',
                missingReportCount: 1,
                missingReports: [
                    { regionId: 12, regionName: '清江浦区' },
                ],
            });
        });
    });

    describe('runAndPersist human review defaults', () => {
        it('persists PASS as confirmed and keeps FAIL/UNCERTAIN in pending review', async () => {
            mockedQuery
                .mockResolvedValueOnce({ rows: [{ year: 2024 }] })
                .mockResolvedValueOnce({ rows: [{ id: 9001 }] })
                .mockImplementation(async (sql: unknown) => {
                    const text = String(sql);
                    if (
                        text.includes('FROM report_consistency_items') &&
                        text.includes('AS total') &&
                        text.includes("COALESCE(human_status, 'pending') = 'pending'")
                    ) {
                        expect(text).toContain('WHERE TRUE');
                        return { rows: [{ total: '2', visual: '0', structure: '2', quality: '0' }] };
                    }
                    return { rows: [] };
                });

            const makeItem = (autoStatus: 'PASS' | 'FAIL' | 'UNCERTAIN') => ({
                groupKey: 'table2' as const,
                checkKey: `default_${autoStatus}`,
                fingerprint: `default-${autoStatus}`,
                title: `default ${autoStatus}`,
                expr: 'left = right',
                leftValue: autoStatus === 'FAIL' ? 1 : 0,
                rightValue: 0,
                delta: autoStatus === 'FAIL' ? 1 : 0,
                tolerance: 0,
                autoStatus,
                evidenceJson: {
                    paths: [],
                    values: {},
                },
            });
            jest.spyOn(service, 'runChecks').mockReturnValue([
                makeItem('PASS'),
                makeItem('FAIL'),
                makeItem('UNCERTAIN'),
            ]);
            jest.spyOn(service as any, 'generateHierarchyItems').mockResolvedValue([]);

            await service.runAndPersist(1000, { sections: [] });

            const persistCalls = mockedQuery.mock.calls.filter(([sql]) =>
                String(sql).includes('INSERT INTO report_consistency_items')
            );
            expect(persistCalls.length).toBeGreaterThan(0);

            const statusByAutoStatus = new Map<string, Set<string>>();
            for (const call of persistCalls) {
                const params = call[1] as any[];
                const autoStatus = params[11];
                const humanStatus = params[13];
                if (!statusByAutoStatus.has(autoStatus)) {
                    statusByAutoStatus.set(autoStatus, new Set());
                }
                statusByAutoStatus.get(autoStatus)?.add(humanStatus);
            }

            expect(statusByAutoStatus.get('PASS')).toEqual(new Set(['confirmed']));
            expect(statusByAutoStatus.get('FAIL')).toEqual(new Set(['pending']));
            expect(statusByAutoStatus.get('UNCERTAIN')).toEqual(new Set(['pending']));

            const cacheUpdateCall = mockedQuery.mock.calls.find(([sql]) =>
                String(sql).includes('SET check_total = $2')
            );
            expect(cacheUpdateCall?.[1]).toEqual([1000, 2, 0, 2, 0]);
            expect(String(cacheUpdateCall?.[0])).toContain('checks_updated_at = NOW()');
        });

        it('preserves reviewed abnormal items and writes only persisted pending items into cached counts', async () => {
            mockedQuery
                .mockResolvedValueOnce({ rows: [{ year: 2024 }] })
                .mockResolvedValueOnce({ rows: [{ id: 9001 }] })
                .mockImplementation(async (sql: unknown) => {
                    const text = String(sql);
                    if (
                        text.includes('FROM report_consistency_items') &&
                        text.includes('AS total') &&
                        text.includes("COALESCE(human_status, 'pending') = 'pending'")
                    ) {
                        expect(text).toContain('WHERE TRUE');
                        return { rows: [{ total: '1', visual: '0', structure: '1', quality: '0' }] };
                    }
                    return { rows: [] };
                });

            jest.spyOn(service, 'runChecks').mockReturnValue([
                {
                    groupKey: 'table2' as const,
                    checkKey: 'pending_fail',
                    fingerprint: 'pending-fail',
                    title: 'pending fail',
                    expr: 'left = right',
                    leftValue: 1,
                    rightValue: 0,
                    delta: 1,
                    tolerance: 0,
                    autoStatus: 'FAIL',
                    evidenceJson: { paths: [], values: {} },
                },
                {
                    groupKey: 'table3' as const,
                    checkKey: 'confirmed_pass',
                    fingerprint: 'confirmed-pass',
                    title: 'confirmed pass',
                    expr: 'left = right',
                    leftValue: 0,
                    rightValue: 0,
                    delta: 0,
                    tolerance: 0,
                    autoStatus: 'PASS',
                    evidenceJson: { paths: [], values: {} },
                },
                {
                    groupKey: 'structure' as const,
                    checkKey: 'not_assessable',
                    fingerprint: 'not-assessable',
                    title: 'not assessable',
                    expr: 'left = right',
                    leftValue: null,
                    rightValue: null,
                    delta: null,
                    tolerance: 0,
                    autoStatus: 'NOT_ASSESSABLE',
                    evidenceJson: { paths: [], values: {} },
                },
            ]);
            jest.spyOn(service as any, 'generateHierarchyItems').mockResolvedValue([]);

            await service.runAndPersist(1000, { sections: [] });

            const upsertCall = mockedQuery.mock.calls.find(([sql]) =>
                String(sql).includes('ON CONFLICT(report_version_id, fingerprint) DO UPDATE')
            );
            expect(String(upsertCall?.[0])).toContain("report_consistency_items.human_status IN ('confirmed', 'dismissed')");

            const cacheUpdateCall = mockedQuery.mock.calls.find(([sql]) =>
                String(sql).includes('SET check_total = $2')
            );
            expect(cacheUpdateCall?.[1]).toEqual([1000, 1, 0, 1, 0]);
        });
    });
});
