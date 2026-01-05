import dotenv from "dotenv";
import { dbType } from "./config/database-llm";
import { runLLMMigrations } from "./db/migrations-llm";
import { llmJobRunner } from "./services/LlmJobRunner";
import { startPdfExportWorker } from "./services/PdfExportWorker";
import { createLlmApp } from "./app-llm";
import { redactSensitive } from "./utils/logRedactor";

dotenv.config();

const app = createLlmApp();
const PORT = process.env.PORT || 3000;

// Start server
async function start(): Promise<void> {
  try {
    console.log(`Starting LLM ingestion system with ${dbType} database...`);

    // Run migrations
    await runLLMMigrations();

    llmJobRunner.start();

    // Start PDF export worker for background PDF generation
    startPdfExportWorker();

    app.listen(PORT, () => {
      console.log(`LLM API server running on port ${PORT}`);
      console.log(`Database type: ${dbType}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', redactSensitive(error));
    process.exit(1);
  }
}

start();
