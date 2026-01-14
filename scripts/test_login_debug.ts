
import axios from 'axios';

async function testLogin() {
    const url = 'http://localhost:8787/api/auth/login';
    const credentials = {
        username: 'admin',
        password: 'admin123'
    };

    console.log(`Attempting login to ${url} with:`, credentials);

    try {
        const response = await axios.post(url, credentials);
        console.log('✅ Login Successful!');
        console.log('Response:', response.data);
    } catch (error: any) {
        console.error('❌ Login Failed');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error('Message:', error.message);
        }
    }
}

testLogin();
