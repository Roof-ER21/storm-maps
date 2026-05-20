// Vercel serverless entry point — re-exports the Express app so Vercel
// treats it as a single function handler for all /api/* routes.
// `server/index.ts` skips app.listen() when VERCEL=1 (set by platform).
export { default } from '../server/index.js';
