/**
 * FOCUS Cost Export Ingestion Pipeline
 * Modular TypeScript entrypoint
 */
import { runIngestionPipeline } from './focus-export/index';

runIngestionPipeline().catch((err) => {
    console.error('Fatal error in focus export ingestion:', err);
    process.exit(1);
});
