
import { dbQuery } from '../src/config/db-llm';

async function checkRegions() {
    try {
        console.log('Checking gov_open_annual_stats view...');
        const specific = await dbQuery("SELECT org_id, org_name, org_type, parent_id FROM gov_open_annual_stats WHERE org_name IN ('江苏省', '淮安市', '黄浦区', '上海市')");
        console.log('View Data:', JSON.stringify(specific, null, 2));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkRegions();
