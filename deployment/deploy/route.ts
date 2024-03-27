//import rateLimit from '@/lib/ratelimit';
import { ChildProcess, spawn } from 'child_process';
import { closeSync, openSync } from 'fs';
import path from 'path';

//set DEPLOY_SCRIPT and DEPLOY_TOKEN in .env
//DEPLOY_TOKEN is optional and corresponds to gitlab's X-Gitlab-Token header


let child = null as ChildProcess | null; //prevents multiple deployment scripts from running concurrently

export async function GET(request: Request) {
  try {
    // await limiter.check(res, 2, 'CACHE_TOKEN'); //Enable later(rate limit)
    const headers = new Headers(request.headers);

    if (
      !process.env.DEPLOY_TOKEN ||
      process.env.DEPLOY_TOKEN == headers.get('x-hub-signature-256')
    ) {
      if (!child) {
        const batchFilePath = path.resolve(process.cwd(), 'rundeploy.bat');
        const logPipe = openSync(String('last_deploy.log'), 'w'); //perhaps redundant with pm2 logs
        child = spawn(batchFilePath, [], {
          shell: true, //windows compatibility
          //detached: true,  //not needed with pm2 using the --no-treekill flag
          stdio: [logPipe, logPipe, logPipe],
        });
        child?.stdout?.setEncoding('utf8');
        child?.stdout?.on('data', function (data) {
          console.log(data); //logs to pm2
        });
        child.on('close', function () {
          console.log('Deploy script finished');
          closeSync(logPipe);
          child = null;
        });
      } else {
        console.error('A deployment is already running!');

        return Response.json(
          { error: 'A deployment is already running!' },
          {
            status: 429,
          },
        );
      }
    } else {
      console.error('Invalid deployment token!');
      return Response.json(
        {
          error: 'Invalid deployment token!',
        },
        {
          status: 403,
        },
      );
    }

    return Response.json({ deploying: true });
  } catch {
    console.error('Rate limit exceeded');
    return Response.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }
}
