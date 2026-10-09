import fs from 'fs';
import os from 'os';
import path from 'path';

export type GameMode = 'coop' | 'pvp' | 'lockout';

export interface ServerConfig {
    /** Unique id, also the name of the server's data folder */
    id: string;
    mode: GameMode;
    /** OpenRCT2 multiplayer port */
    port: number;
    /** Server name shown in the server list (optional) */
    name?: string;
}

export interface ManagerConfig {
    /** OpenRCT2 executable */
    openrct2Path: string;
    /** Park or scenario every game starts from */
    scenario: string;
    /** Normal OpenRCT2 user folder: config, groups, objects and plugins are taken from here */
    baseUserDirectory: string;
    /** Each server gets its own OpenRCT2 user folder in here */
    dataDirectory: string;
    headless: boolean;
    /** Port the plugin connects to (BingoSync, restarts) */
    tcpPort: number;
    /** Game length in in-game years */
    gameDurationYears: number;
    /** BingoSync instance the games' rooms are created on */
    bingosyncUrl: string;
    servers: ServerConfig[];
}

const DEFAULTS: Omit<ManagerConfig, 'servers' | 'scenario'> = {
    openrct2Path: 'openrct2',
    baseUserDirectory: '~/.config/OpenRCT2',
    dataDirectory: '~/.config/openrct2-bingo-servers',
    headless: true,
    tcpPort: 12414,
    gameDurationYears: 2,
    bingosyncUrl: 'https://bingosync.bingothon.com/',
};

const MODES: GameMode[] = ['coop', 'pvp', 'lockout'];

/** "~/x" -> "/home/me/x" (spawned processes don't go through a shell, so ~ isn't expanded) */
export function expandHome(p: string): string {
    return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function loadConfig(file: string): ManagerConfig {
    if (!fs.existsSync(file)) {
        throw new Error(`Config file not found: ${file} (copy servers.example.json to get started)`);
    }

    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const config: ManagerConfig = { ...DEFAULTS, ...raw };

    if (!config.scenario) throw new Error('"scenario" is required');
    if (!Array.isArray(config.servers) || config.servers.length === 0) throw new Error('"servers" needs at least one server');

    const ids = new Set<string>();
    const ports = new Set<number>();
    for (const server of config.servers) {
        if (!server.id || !/^[a-z0-9-]+$/.test(server.id)) throw new Error(`Invalid server id "${server.id}" (use a-z, 0-9 and -)`);
        if (!MODES.includes(server.mode)) throw new Error(`Server "${server.id}": mode must be one of ${MODES.join(', ')}`);
        if (!Number.isInteger(server.port)) throw new Error(`Server "${server.id}": port must be a number`);
        if (ids.has(server.id)) throw new Error(`Duplicate server id "${server.id}"`);
        if (ports.has(server.port) || server.port === config.tcpPort) throw new Error(`Port ${server.port} is used twice`);
        ids.add(server.id);
        ports.add(server.port);
    }

    config.openrct2Path = expandHome(config.openrct2Path);
    config.scenario = expandHome(config.scenario);
    config.baseUserDirectory = expandHome(config.baseUserDirectory);
    config.dataDirectory = expandHome(config.dataDirectory);
    if (!config.bingosyncUrl.endsWith('/')) config.bingosyncUrl += '/';
    return config;
}
