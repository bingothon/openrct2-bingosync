import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

let serverProcess: ChildProcessWithoutNullStreams | null = null;

export function startOpenRCT2Server(options: {
  command: string;
  scenario: string;
  userDirectory: string;
  headless: boolean;
}) {
  if (serverProcess) {
    console.log('Server is already running.');
    return;
  }

  const { command, scenario, userDirectory, headless } = options;

  const args = [
    'host',
    scenario,
    ...(headless ? ['--headless'] : []),
    '--user-data-path',
    userDirectory,
  ];

  console.log('Starting OpenRCT2 process...');
  console.log('Command:', command);
  console.log('Arguments:', args);

  serverProcess = spawn(command, args, { env: process.env });

  serverProcess.stdout.on('data', (data) => {
    console.log(`[OpenRCT2]: ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`[OpenRCT2 Error]: ${data}`);
  });

  serverProcess.on('close', (code) => {
    console.log(`OpenRCT2 server exited with code ${code}`);
    serverProcess = null;
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start OpenRCT2 process:', err);
  });
}

export function stopOpenRCT2Server() {
  if (!serverProcess) {
    console.log('No server is currently running.');
    return;
  }

  console.log('Stopping server...');
  serverProcess.kill('SIGTERM');
  serverProcess = null;

  console.log('Server stopped successfully.');
}
