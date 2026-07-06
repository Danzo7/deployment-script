import sirv from 'sirv';
import { createServer } from 'http';

const port = Number(process.env.PORT);
if (!port) throw new Error('PORT environment variable is required');

createServer(sirv(process.cwd(), { single: false })).listen(port, () => {
  console.log(`Static server listening on port ${port}`);
});
