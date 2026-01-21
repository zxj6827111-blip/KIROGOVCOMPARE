import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function listModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const response = await axios.get(url);
        console.log('Available models:', response.data.models.map((m: any) => m.name));
    } catch (error: any) {
        console.error('List models failed:', error.response?.data || error.message);
    }
}
listModels();
