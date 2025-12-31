const { apiClient } = require('./frontend/src/apiClient');
// Mocking apiClient or just using fetch since we are in node
// Actually simpler to just use fetch with absolute URL
const axios = require('axios');

async function analyze() {
    try {
        const resp = await axios.get('http://localhost:8787/api/regions');
        const list = resp.data.data || resp.data.regions || resp.data;

        const levels = {};
        const parents = {};

        list.forEach(r => {
            levels[r.level] = (levels[r.level] || 0) + 1;
            if (r.level === 1) {
                console.log(`[Level 1] Region: ${r.name}, ID: ${r.id}`);
            }
        });

        console.log('Level Counts:', levels);
    } catch (e) {
        console.error(e);
    }
}

analyze();
