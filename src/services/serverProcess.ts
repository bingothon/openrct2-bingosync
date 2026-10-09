import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ManagerConfig, ServerConfig } from '../config';

const STOP_TIMEOUT_MS = 10_000;
const CRASH_RESTART_DELAY_MS = 5_000;
/** Give up restarting after this many crashes in a row that happened shortly after starting */
const MAX_QUICK_CRASHES = 3;
const QUICK_CRASH_MS = 30_000;

/** Files copied once from the base user folder (edit the copy to customise one server).
 * users.json holds who is in which group, e.g. the admins. */
const COPIED_FILES = ['config.ini', 'groups.json', 'users.json', 'objects.idx'];
/** Folders shared with the base user folder */
const LINKED_FOLDERS = ['object', 'plugin'];

/**
 * One OpenRCT2 server: its own user folder (so it has its own port, groups and plugin
 * settings), started headless with the bingo scenario, restarted cleanly on request.
 */
export class OpenRCT2Server {
    private process: ChildProcessWithoutNullStreams | null = null;
    private stopping = false;
    private startedAt = 0;
    private quickCrashes = 0;
    private exited: Promise<void> = Promise.resolve();

    constructor(
        readonly server: ServerConfig,
        private readonly config: ManagerConfig,
    ) {}

    get userDirectory(): string {
        return path.join(this.config.dataDirectory, this.server.id);
    }

    get running(): boolean {
        return this.process !== null;
    }

    private log(message: string) {
        console.log(`[${this.server.id}] ${message}`);
    }

    /**
     * Create the server's user folder and tell the plugin which server this is. The plugin
     * reads these settings with context.sharedStorage (plugin.store.json).
     */
    private prepareUserDirectory() {
        const dir = this.userDirectory;
        const base = this.config.baseUserDirectory;
        fs.mkdirSync(dir, { recursive: true });

        for (const file of COPIED_FILES) {
            const target = path.join(dir, file);
            if (!fs.existsSync(target) && fs.existsSync(path.join(base, file))) {
                fs.copyFileSync(path.join(base, file), target);
            }
        }
        for (const folder of LINKED_FOLDERS) {
            const target = path.join(dir, folder);
            if (!fs.existsSync(target) && fs.existsSync(path.join(base, folder))) {
                fs.symlinkSync(path.join(base, folder), target);
            }
        }

        const configFile = path.join(dir, 'config.ini');
        if (this.server.name && fs.existsSync(configFile)) {
            const ini = fs.readFileSync(configFile, 'utf8');
            fs.writeFileSync(configFile, ini.replace(/^server_name = .*$/m, `server_name = "${this.server.name}"`));
        }

        const storeFile = path.join(dir, 'plugin.store.json');
        let store: Record<string, unknown> = {};
        try {
            store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
        } catch {
            // No settings yet
        }
        store.bingoServer = {
            id: this.server.id,
            mode: this.server.mode,
            durationYears: this.config.gameDurationYears,
            managerPort: this.config.tcpPort,
        };
        fs.writeFileSync(storeFile, JSON.stringify(store));
    }

    start() {
        if (this.process) {
            this.log('Already running.');
            return;
        }

        this.prepareUserDirectory();
        const args = [
            'host',
            this.config.scenario,
            '--port',
            String(this.server.port),
            '--user-data-path',
            this.userDirectory,
            ...(this.config.headless ? ['--headless'] : []),
        ];
        this.log(`Starting ${this.server.mode.toUpperCase()} server on port ${this.server.port}`);

        const child = spawn(this.config.openrct2Path, args, { env: process.env });
        this.process = child;
        this.stopping = false;
        this.startedAt = Date.now();

        const prefix = (data: Buffer) =>
            data
                .toString()
                .split('\n')
                .filter((line) => line.trim())
                .map((line) => `[${this.server.id}] ${line}`)
                .join('\n');
        child.stdout.on('data', (data) => console.log(prefix(data)));
        child.stderr.on('data', (data) => console.error(prefix(data)));
        child.on('error', (err) => this.log(`Failed to start OpenRCT2: ${err.message}`));

        this.exited = new Promise((resolve) => {
            child.on('close', (code, signal) => {
                this.process = null;
                this.log(`OpenRCT2 exited (${signal || `code ${code}`})`);
                if (!this.stopping) this.handleCrash();
                resolve();
            });
        });
    }

    private handleCrash() {
        this.quickCrashes = Date.now() - this.startedAt < QUICK_CRASH_MS ? this.quickCrashes + 1 : 0;
        if (this.quickCrashes >= MAX_QUICK_CRASHES) {
            this.log(`Crashed ${this.quickCrashes} times right after starting - not restarting it again.`);
            return;
        }
        this.log(`Unexpected exit, restarting in ${CRASH_RESTART_DELAY_MS / 1000}s`);
        setTimeout(() => {
            if (!this.process && !this.stopping) this.start();
        }, CRASH_RESTART_DELAY_MS);
    }

    /** Ask OpenRCT2 to quit and wait until it has exited (killing it if it takes too long) */
    async stop(): Promise<void> {
        const child = this.process;
        this.stopping = true;
        if (!child) return;

        this.log('Stopping');
        child.kill('SIGINT');
        const timeout = setTimeout(() => {
            if (this.process === child) {
                this.log('Still running, killing it');
                child.kill('SIGKILL');
            }
        }, STOP_TIMEOUT_MS);
        await this.exited;
        clearTimeout(timeout);
    }

    /** Fresh game: stop, wait for the old process to be gone, start again from the scenario */
    async restart(): Promise<void> {
        await this.stop();
        this.quickCrashes = 0;
        this.start();
    }
}
