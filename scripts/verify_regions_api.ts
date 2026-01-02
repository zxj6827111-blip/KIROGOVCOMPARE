
import axios from 'axios';

const BASE_URL = 'http://localhost:3000/api'; // Default PORT is 3000 in index.ts

async function testRegionsApi() {
    try {
        console.log(`Testing GET ${BASE_URL}/regions ...`);
        const response = await axios.get(`${BASE_URL}/regions`);
        console.log('Status:', response.status);
        console.log('Data count:', Array.isArray(response.data) ? response.data.length : 'Not an array');
    } catch (error: any) {
        console.error('Error fetching regions:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', error.response.data);
        }
    }
}

testRegionsApi();
