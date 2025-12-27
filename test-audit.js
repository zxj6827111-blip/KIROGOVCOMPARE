// Quick test for new structure audit rules
const { consistencyCheckService } = require('./dist/services/ConsistencyCheckService');

// Test case: Table 3 with some empty/slash cells
const testJson = {
    sections: [
        {
            title: '三、收到和处理政府信息公开申请情况',
            type: 'table_3',
            tableData: {
                naturalPerson: {
                    newReceived: 100,
                    carriedOver: 5,
                    results: {
                        granted: 80,
                        partialGrant: 10,
                        denied: {
                            stateSecret: '/',
                            lawForbidden: '',
                            safetyStability: null,
                            thirdPartyRights: '-',
                            internalAffairs: 0,
                            processInfo: '/',
                            enforcementCase: '/',
                            adminQuery: 0
                        }
                    }
                }
            }
        },
        { title: '五、存在的主要问题及改进情况', type: 'text', content: '增强队伍凝聚力。' },
        { title: '六、其他需要报告的事项', type: 'text', content: '无' }
    ],
    visual_audit: null
};

try {
    const items = consistencyCheckService.runChecks(testJson);
    console.log('Items found:', items.length);
    console.log('\n--- Audit Results ---');
    items.forEach(function (i) {
        console.log(`[${i.groupKey}] ${i.checkKey}: ${i.autoStatus}`);
        if (i.evidenceJson?.values?.empty_count) {
            console.log(`    Empty cells: ${i.evidenceJson.values.empty_count}`);
            console.log(`    Examples: ${JSON.stringify(i.evidenceJson.values.examples)}`);
        }
    });
} catch (error) {
    console.error('Error:', error.message);
}
