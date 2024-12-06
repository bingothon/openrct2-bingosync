import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';
import net from 'net';
import { generatePassphrase, roomMatcher } from '../server/utils';

const BINGOSYNC_URL = 'https://bingosync.com/';
const jar = new CookieJar();
const client = wrapper(axios.create({ jar } as any));
const ROOM_PASSPHRASE = generatePassphrase();

// Constants for default values
const DEFAULT_ROOM_NAME = 'OpenRCT2 Bingo';
const DEFAULT_USERNAME = 'openrct2';

export async function createOrConnectBoard(
    socket: net.Socket,
    boardData: { name: string }[],
    room_name: string,
    username: string,
    roomId?: string,
    roomPassword?: string
) {
    try {
        // If roomId and roomPassword are provided, attempt to connect to an existing room
        if (roomId && roomPassword) {
            console.log(`Attempting to connect to existing room with ID: ${roomId}`);
            const csrfToken = await fetchCsrfToken();
            if (!csrfToken) {
                writeMessage(socket, { error: 'CSRF token is missing. Cannot connect to bingo board.' });
                return;
            }

            // Prepare the payload with all necessary parameters
            const payload = new URLSearchParams({
                csrfmiddlewaretoken: csrfToken,
                encoded_room_uuid: roomId,     // Room ID as encoded UUID
                player_name: username || DEFAULT_USERNAME,  // Player's name
                passphrase: roomPassword,      // Room password
            });

            try {
                // Attempt to connect to the existing room
                const response = await client.post(
                    `${BINGOSYNC_URL}room/${roomId}`,
                    payload,
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Referer': BINGOSYNC_URL,
                            'X-CSRFToken': csrfToken,
                        },
                    }
                );

                const board = await client.get(`${BINGOSYNC_URL}room/${roomId}/board`);

                // Check the response to determine connection success
                if (response.status === 200 && board.status === 200) {
                    const roomUrl = `${BINGOSYNC_URL}room/${roomId}`;
                    writeMessage(socket, {
                        message: 'Successfully connected to existing bingo board!',
                        roomUrl,
                        passphrase: roomPassword,
                        boardData: board.data,
                    });
                } else {
                    writeMessage(socket, { error: 'Failed to connect to the existing room. Check room ID and password.' });
                }
            } catch (error) {
                console.error('Error connecting to existing room:', error);
                writeMessage(socket, { error: 'Error connecting to existing room' });
            }
        } else {
            // Create a new room if no roomId and roomPassword are provided
            console.log('Creating new bingo board with client-provided data...');
            const csrfToken = await fetchCsrfToken();
            if (!csrfToken) {
                writeMessage(socket, { error: 'CSRF token is missing. Cannot create bingo board.' });
                return;
            }

            const goalsJson = JSON.stringify(boardData);
            const payload = {
                room_name: room_name || DEFAULT_ROOM_NAME, // Use provided room name or default
                passphrase: roomPassword || ROOM_PASSPHRASE,
                nickname: username || DEFAULT_USERNAME, // Use provided username or default
                game_type: '18',
                variant_type: '18',
                custom_json: goalsJson,
                lockout_mode: '1',
                seed: '',
                hide_card: 'on',
            };

            const response = await client.post(
                BINGOSYNC_URL,
                new URLSearchParams(payload),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Referer': BINGOSYNC_URL,
                        'X-CSRFToken': csrfToken,
                    },
                }
            );

            const data = typeof response.data === 'string' ? response.data : '';
            const createdRoomId = roomMatcher(data);


            if (createdRoomId) {
                console.log('Created room ID:', createdRoomId);
                roomId = createdRoomId;
                console.log('Room ID at connected:', roomId);
                console.log('Room ID set to:', roomId, 'at', new Date().toISOString());
                const roomUrl = `${BINGOSYNC_URL}room/${createdRoomId}`;
                writeMessage(socket, {
                    message: 'Bingo board created successfully!',
                    roomUrl,
                    passphrase: ROOM_PASSPHRASE,
                });
            } else {
                writeMessage(socket, { error: 'Room ID not found in response data.' });
            }
        }
    } catch (error) {
        console.error('Error creating or connecting to bingo board:', error);
        writeMessage(socket, { error: 'Error creating or connecting to bingo board' });
    }
}

export async function getBoard(socket: net.Socket) {
    // Implementation for fetching the bingo board
}

export async function selectGoal(socket: net.Socket, slot: string, color: string, room: string) {
    // Implementation for selecting a goal
}

// Fetch a new CSRF token
async function fetchCsrfToken(): Promise<string | null> {
    try {
        await client.get(BINGOSYNC_URL);
        const cookies = await jar.getCookies(BINGOSYNC_URL);
        const csrfTokenCookie = cookies.find(cookie => cookie.key === 'csrftoken');
        return csrfTokenCookie ? csrfTokenCookie.value : null;
    } catch (error) {
        console.error('Error fetching CSRF token:', error);
        return null;
    }
}

function writeMessage(socket: net.Socket, message: object) {
    const messageString = JSON.stringify(message) + '\n';
    socket.write(messageString, 'utf8', () => {
        console.log("Sent message:", messageString);
    });
}
