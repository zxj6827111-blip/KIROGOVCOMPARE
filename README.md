# KIROGOVCOMPARE LLM Backend

## Quickstart (Gemini)
1. Copy `.env.example` (if present) or create `.env` with:
   ```env
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=your_api_key
   GEMINI_MODEL=gemini-2.5-flash
   GEMINI_TIMEOUT_MS=120000
   ```
2. Install dependencies:
   ```bash
   npm ci
   ```
3. Start the LLM service (SQLite, port 8787):
   ```bash
   npm run dev:llm
   ```
4. Open another terminal and run the smoke test (requires valid Gemini key):
   ```bash
   npm run smoke:llm
   ```
   You should see the parse job reach `succeeded` and `/api/reports/:id` returning `parsed_json` with `tableData` and `reviewLitigationData`.

If `GEMINI_API_KEY` is missing while `LLM_PROVIDER=gemini`, the server will refuse to start to avoid stub mode confusion.
