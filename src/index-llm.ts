import dotenv from "dotenv";
import { dbType } from "./config/database-llm";
import { runLLMMigrations } from "./db/migrations-llm";
import { llmJobRunner } from "./services/LlmJobRunner";
import { startGovInsightReportJobWorker } from "./services/GovInsightReportJobWorker";
import { startPdfExportWorker } from "./services/PdfExportWorker";
import { createLlmApp } from "./app-llm";
import { redactSensitive } from "./utils/logRedactor";

dotenv.config();

const app = createLlmApp();
const PORT = process.env.PORT || 3000;
const WORKER_ONLY = process.env.LLM_WORKER_ONLY === '1';
const ENABLE_JOB_RUNNER = process.env.LLM_ENABLE_JOB_RUNNER !== '0';
const RUN_MIGRATIONS = process.env.LLM_RUN_MIGRATIONS !== '0';

// Start server
async function start(): Promise<void> {
  try {
    console.log(`Starting LLM ingestion system with ${dbType} database...`);

    // Run migrations (can be disabled for worker-only processes)
    if (RUN_MIGRATIONS) {
      await runLLMMigrations();
    }

    if (ENABLE_JOB_RUNNER) {
      llmJobRunner.start();
    }

    startGovInsightReportJobWorker();

    // Start PDF export worker for background PDF generation
    startPdfExportWorker();

    if (!WORKER_ONLY) {
      app.listen(PORT, () => {
        console.log(`LLM API server running on port ${PORT}`);
        console.log(`Database type: ${dbType}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
      });
    } else {
      console.log('LLM worker-only mode: HTTP server disabled.');
      console.log(`Database type: ${dbType}`);
    }
  } catch (error) {
    console.error('Failed to start server:', redactSensitive(error));
    process.exit(1);
  }
}

start();
