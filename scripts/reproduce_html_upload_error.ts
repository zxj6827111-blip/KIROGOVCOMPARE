
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';

// Copied from src/middleware/auth.ts
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-key-min-32-chars!!';
const TOKEN_EXPIRY_HOURS = 24;

function generateToken(userId: number, username: string): string {
    const payload = {
        id: userId,
        username,
        exp: Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    };

    const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(payloadStr)
        .digest('base64url');

    return `${payloadStr}.${signature}`;
}

async function main() {
    // 300 chars > 255 chars (DB limit)
    const longName = 'A'.repeat(300) + '.html';
    const filePath = path.join(__dirname, 'temp_short.html');
    // Create a file
    const content = '<html><body>' + 'Test Content '.repeat(100) + '</body></html>';
    fs.writeFileSync(filePath, content, 'utf8');

    // Generate token for user ID 1 (admin)
    const token = generateToken(1, 'admin');

    try {
        // Step 1: Get a valid region ID
        console.log('Fetching reports to find a valid region ID...');
        const listRes = await axios.get('http://localhost:8787/api/reports', {
            headers: { 'Authorization': `Bearer ${token}` },
            validateStatus: () => true
        });

        let regionId = '1';
        if (listRes.status === 200 && listRes.data.data && listRes.data.data.length > 0) {
            regionId = String(listRes.data.data[0].region_id);
            console.log(`Found valid region ID: ${regionId}`);
        } else {
            console.log('Could not find existing reports, trying default region ID 1');
        }

        const formData = new FormData();
        formData.append('region_id', regionId);
        formData.append('year', '2020');
        formData.append('unit_name', 'Test Unit Long Name');
        // Pass the file stream, but specify the LONG filename in the options
        formData.append('file', fs.createReadStream(filePath), { filename: longName });

        console.log(`Uploading file with ${longName.length} chars filename...`);
        const response = await axios.post('http://localhost:8787/api/reports', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${token}`
            },
            validateStatus: () => true
        });

        console.log('Status:', response.status);
        console.log('Data:', response.data);
    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    } finally {
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                // ignore
            }
        }
    }
}

main();
