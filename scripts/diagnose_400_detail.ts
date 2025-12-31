import axios from 'axios';
import * as dotenv from 'dotenv';
import { querySqlite, sqlValue } from '../src/config/sqlite';
import path from 'path';
import fs from 'fs';

dotenv.config();

async function diagnose() {
    const versionId = 59;
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    // Get the exact raw_text from database
    const version = querySqlite(`SELECT raw_text, storage_path FROM report_versions WHERE id = ${sqlValue(versionId)}`)[0];
    if (!version || !version.raw_text) {
        console.error('Text not found for version 59');
        return;
    }

    const userText = version.raw_text;
    console.log(`Diagnosing Version 59`);
    console.log(`Text Length: ${userText.length}`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemInstructionText = `You are a professional assistant for extracting structured data from Chinese Government Information Disclosure Annual Reports... (shortened for test)`;

    try {
        const response = await axios.post(
            url,
            {
                contents: [{ role: 'user', parts: [{ text: userText }] }],
                systemInstruction: { parts: [{ text: systemInstructionText }] },
                generationConfig: { responseMimeType: 'application/json' },
            },
            { timeout: 30000 }
        );
        console.log('✅ Success! (Wait, it worked now?)');
    } catch (error: any) {
        if (error.response) {
            console.log(`❌ Status: ${error.response.status}`);
            console.log('❌ Error Details:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('❌ Request Failed:', error.message);
        }
    }
}

diagnose();
