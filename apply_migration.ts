
import { runLLMMigrations } from './src/db/migrations-llm';
import dotenv from 'dotenv';
dotenv.config();

console.log('Applying migrations...');
runLLMMigrations().then(() => {
    console.log('Migrations applied successfully.');
    process.exit(0);
}).catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
