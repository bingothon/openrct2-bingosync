import net from 'net';
import { Servers } from '../services/servers';
import { ClientActions } from '../types/actions';

/** What a connection told us about itself */
export interface ConnectionState {
    serverId?: string;
}

function reply(socket: net.Socket, message: object) {
    socket.write(JSON.stringify(message) + '\n');
}

export async function handleClientMessage(socket: net.Socket, msg: any, state: ConnectionState, servers: Servers) {
    try {
        switch (msg.action) {
            case ClientActions.HELLO: {
                if (!servers.get(msg.serverId)) {
                    reply(socket, { error: `Unknown server "${msg.serverId}"` });
                    return;
                }
                state.serverId = msg.serverId;
                console.log(`[${msg.serverId}] Plugin connected`);
                reply(socket, { message: `Hello ${msg.serverId}` });
                break;
            }
            case ClientActions.START:
            case ClientActions.STOP:
            case ClientActions.RESTART: {
                const id = msg.serverId || state.serverId;
                const server = servers.get(id);
                if (!server) {
                    reply(socket, { error: id ? `Unknown server "${id}"` : 'Say which server (send hello first).' });
                    return;
                }
                if (msg.action === ClientActions.START) server.start();
                if (msg.action === ClientActions.STOP) await server.stop();
                if (msg.action === ClientActions.RESTART) {
                    console.log(`[${id}] Restart requested`);
                    // The requesting plugin goes down with its server, so don't wait to reply
                    reply(socket, { message: `Restarting ${id}` });
                    await server.restart();
                }
                break;
            }
            case ClientActions.CONNECT_OR_CREATE:
                await servers.session(state.serverId).connectOrCreate(socket, msg);
                break;
            case ClientActions.SELECT_GOAL:
                await servers.session(state.serverId).selectGoal(socket, msg.slot, msg.color, msg.room);
                break;
            default:
                reply(socket, { error: 'Invalid action' });
        }
    } catch (error) {
        console.error('Error handling client message:', error);
        reply(socket, { error: 'Error processing action.' });
    }
}
