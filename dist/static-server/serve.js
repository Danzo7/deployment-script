import sirv from 'sirv';
import { createServer } from 'http';
import { Logger } from '../utils/logger.js';
const port = Number(process.env.PORT);
if (!port)
    throw new Error('PORT environment variable is required');
createServer(sirv(process.cwd(), { single: false })).listen(port, () => {
    Logger.print(`Static server listening on port ${port}`);
});
