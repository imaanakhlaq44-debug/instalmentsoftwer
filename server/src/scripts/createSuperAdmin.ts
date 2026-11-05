/**
 * Create the platform's super admin from a shell on the server.
 *
 *   docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
 *     exec server node dist/scripts/createSuperAdmin.js --email you@example.com --name "Your Name"
 *
 * The password is typed at a hidden prompt (twice), so it never lands in shell
 * history, the process list or a log. For automation it may instead be piped on
 * stdin, one line.
 */
import readline from 'readline';

import { connectDatabase, disconnectDatabase } from '../db/prisma.js';
import { createSuperAdmin } from '../services/SuperAdminBootstrap.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Reads one line without echoing it when attached to a terminal. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) {
        out.output.write(s);
        prompted = true;
      }
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readPiped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
}

async function main(): Promise<void> {
  const email = arg('email');
  const name = arg('name');
  if (!email || !name) {
    console.error('Usage: node dist/scripts/createSuperAdmin.js --email <email> --name "<full name>" [--phone <phone>]');
    process.exit(2);
  }

  let password: string;
  if (process.stdin.isTTY) {
    password = await askHidden('Password: ');
    const again = await askHidden('Repeat password: ');
    if (password !== again) {
      console.error('The two passwords do not match. Nothing was created.');
      process.exit(1);
    }
  } else {
    password = await readPiped();
  }

  await connectDatabase();
  try {
    const user = await createSuperAdmin({ email, name, password, phone: arg('phone') });
    console.log(`Super admin created: ${user.email}. Sign in to the dashboard with this email.`);
  } catch (err) {
    console.error(`Not created: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void main();
