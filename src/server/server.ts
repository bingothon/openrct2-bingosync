import net from 'net';
import split2 from 'split2';
import { ConnectionState, handleClientMessage } from './clientHandlers';
import { Servers } from '../services/servers';

/**
 * TCP server the OpenRCT2 plugins connect to (one JSON message per line)
 */
export function startTcpServer(port: number, servers: Servers) {
    const server = net.createServer((socket) => {
        const state: ConnectionState = {};

        socket.pipe(split2()).on('data', (line: string) => {
            let msg: any;
            try {
                msg = JSON.parse(line);
            } catch {
                socket.write(JSON.stringify({ error: 'Invalid JSON format' }) + '\n');
                return;
            }
            handleClientMessage(socket, msg, state, servers);
        });

        socket.on('close', () => {
            if (state.serverId) console.log(`[${state.serverId}] Plugin disconnected`);
        });
        socket.on('error', (error) => console.error('Socket error:', error.message));
    });

    server.listen(port, '127.0.0.1', () => {
        console.log(`Listening for plugins on 127.0.0.1:${port}`);
    });

    return server;
}
