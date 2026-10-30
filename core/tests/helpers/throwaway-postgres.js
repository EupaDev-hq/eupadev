// Throwaway PostgreSQL of the core's tests: the kit's helper (kit/throwaway-postgres.js) on the example tool.
import { fileURLToPath } from 'node:url';
import { startPostgres as start } from '../../kit/throwaway-postgres.js';

export { IMAGE, query } from '../../kit/throwaway-postgres.js';
export const TOOL = 'example';
export const startPostgres = () => start({ tool: TOOL, toolDir: fileURLToPath(new URL('../example/db/migrations', import.meta.url)) });
