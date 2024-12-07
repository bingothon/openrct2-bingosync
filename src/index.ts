import { startTcpServer } from './server/server';
import { startOpenRCT2Server } from './services/openRCT2';
import { parseArgs } from './server/utils';
import { OpenRCT2Options } from './types/options';
import { cacheOptions } from './server/clientHandlers';
import os from 'os';
import dotenv from 'dotenv';
import { startTwitchClient } from './twitch/twitch';
import { startGameActions } from './game/gameActions';

dotenv.config();

const defaultOptions: OpenRCT2Options = {
  port: process.env.TCP_PORT ? parseInt(process.env.TCP_PORT) : 11753,
  command: process.env.OPENRCT2_PATH || 'openrct2',
  userDirectory: process.env.OPENRCT2_USER_DIRECTORY || `${os.homedir()}/.config/OpenRCT2`,
  scenario: process.env.OPENRCT2_SCENARIO || 'blank',
  headless: process.env.OPENRCT2_HEADLESS === 'true' || false,
};

const argv: OpenRCT2Options = parseArgs(process.argv.slice(2), defaultOptions);

console.log('Caching server options...');
cacheOptions(argv);

console.log('Starting TCP server...');
const tcpServer = startTcpServer(argv.port);

console.log('Starting OpenRCT2 server...');
startOpenRCT2Server(argv);

console.log('Starting Twitch IRC client...');
startTwitchClient(tcpServer); 

console.log('Starting Game Actions...');
startGameActions(tcpServer); 
