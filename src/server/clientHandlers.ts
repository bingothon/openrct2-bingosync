import net from 'net';
import { startOpenRCT2Server, stopOpenRCT2Server } from '../services/openRCT2';
import { createOrConnectBoard, getBoard, selectGoal } from '../services/bingoSync';
import { OpenRCT2Options } from '../types/options';
import { ClientActions } from '../types/actions';

let cachedOptions: OpenRCT2Options | null = null;

export async function handleClientMessage(socket: net.Socket, msg: any) {
    try {
        switch (msg.action) {
            case ClientActions.START:
                if (!cachedOptions) {
                    socket.write(JSON.stringify({ error: 'Server options are missing.' }) + '\n');
                    return;
                }
                startOpenRCT2Server(cachedOptions);
                socket.write(JSON.stringify({ message: 'Server started successfully.' }) + '\n');
                break;
            case ClientActions.STOP:
                stopOpenRCT2Server();
                socket.write(JSON.stringify({ message: 'Server stopped successfully.' }) + '\n');
                break;
            case ClientActions.RESTART:
                console.log('Restarting OpenRCT2 server...');
                if (!cachedOptions) {
                    socket.write(JSON.stringify({ error: 'Server options are missing.' }) + '\n');
                    return;
                }
                stopOpenRCT2Server();
                const options = cachedOptions; // Capture upfront
                setTimeout(() => {
                    startOpenRCT2Server(options);
                    socket.write(JSON.stringify({ message: 'Server restarted successfully.' }) + '\n');
                }, 3000);
                break;
            case ClientActions.CONNECT_OR_CREATE:
                await createOrConnectBoard(socket, msg.boardData, msg.room_name, msg.username, msg.roomId, msg.roomPassword);
                break;
            case ClientActions.GET_BOARD:
                await getBoard(socket);
                break;
            case ClientActions.SELECT_GOAL:
                await selectGoal(socket, msg.slot, msg.color, msg.room);
                break;
            case ClientActions.ADD_CASH:
                if (typeof msg.amount !== 'number' || isNaN(msg.amount)) {
                    socket.write(JSON.stringify({ error: 'Invalid or missing amount.' }) + '\n');
                    return;
                }
                console.log(`Adding ${msg.amount} cash to OpenRCT2 server...`);
                // Replace the following line with your implementation to add cash
                socket.write(JSON.stringify({ action: 'addCash', amount: msg.amount, message: `Cash added successfully: ${msg.amount}` }) + '\n');
                break;
            default:
                socket.write(JSON.stringify({ error: 'Invalid action' }) + '\n');
        }
    } catch (error) {
        console.error('Error handling client message:', error);
        socket.write(JSON.stringify({ error: 'Error processing action.' }) + '\n');
    }
}

export function cacheOptions(options: OpenRCT2Options) {
    cachedOptions = options;
}
