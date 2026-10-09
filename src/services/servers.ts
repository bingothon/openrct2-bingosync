import { ManagerConfig } from '../config';
import { BingoSyncSession } from './bingoSync';
import { OpenRCT2Server } from './serverProcess';

const DEFAULT_SESSION = 'default';

/**
 * All managed OpenRCT2 servers and their BingoSync sessions, by server id
 */
export class Servers {
    private readonly servers = new Map<string, OpenRCT2Server>();
    private readonly sessions = new Map<string, BingoSyncSession>();
    private readonly bingosyncUrl: string;

    constructor(config: ManagerConfig) {
        this.bingosyncUrl = config.bingosyncUrl;
        for (const server of config.servers) {
            this.servers.set(server.id, new OpenRCT2Server(server, config));
        }
    }

    get(id: string | undefined): OpenRCT2Server | undefined {
        return id ? this.servers.get(id) : undefined;
    }

    /** BingoSync session of a server (connections that didn't say which server share one) */
    session(id: string | undefined): BingoSyncSession {
        const key = id && this.servers.has(id) ? id : DEFAULT_SESSION;
        let session = this.sessions.get(key);
        if (!session) {
            session = new BingoSyncSession(key, this.bingosyncUrl);
            this.sessions.set(key, session);
        }
        return session;
    }

    startAll() {
        this.servers.forEach((server) => server.start());
    }

    async stopAll() {
        await Promise.all([...this.servers.values()].map((server) => server.stop()));
    }
}
