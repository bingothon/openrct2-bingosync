import { loadConfig } from './config';
import { startTcpServer } from './server/server';
import { Servers } from './services/servers';

function getConfigPath(args: string[]): string {
    const index = args.indexOf('--config');
    return index !== -1 && args[index + 1] ? args[index + 1] : 'servers.json';
}

const config = loadConfig(getConfigPath(process.argv.slice(2)));
const servers = new Servers(config);

startTcpServer(config.tcpPort, servers);
servers.startAll();

let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Stopping all servers...');
    await servers.stopAll();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
