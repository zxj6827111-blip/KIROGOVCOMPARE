
import axios from 'axios';

async function checkReport() {
    try {
        const resp = await axios.get('http://localhost:8787/api/reports');
        const reports = resp.data.data;
        const report71 = reports.find((r: any) => r.report_id === 71);

        if (report71) {
            console.log('Report 71 found:', report71);
        } else {
            console.log('Report 71 NOT found in API response.');
            console.log('Total reports:', reports.length);
        }
    } catch (err: any) {
        console.error('Error fetching reports:', err.message);
    }
}
checkReport();
