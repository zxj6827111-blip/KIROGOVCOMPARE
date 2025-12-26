import { ConsistencyCheckService, ConsistencyItem } from '../services/ConsistencyCheckService';

describe('ConsistencyCheckService', () => {
    let service: ConsistencyCheckService;

    beforeEach(() => {
        service = new ConsistencyCheckService();
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
    });

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
});
