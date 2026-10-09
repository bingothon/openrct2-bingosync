import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import axios, { AxiosInstance } from 'axios';
import net from 'net';
import { generatePassphrase, roomMatcher } from '../server/utils';
import { GameMode } from '../config';

const DEFAULT_ROOM_NAME = 'OpenRCT2 Bingo';
const DEFAULT_USERNAME = 'openrct2';
/** BingoSync room types */
const LOCKOUT_MODE = { nonLockout: '1', lockout: '2' };
/** BingoSync can be down for a while: keep trying to create/join the room for 30 minutes */
const RETRY_DELAY_MS = 60_000;
const MAX_ATTEMPTS = 30;

export interface ConnectOrCreateRequest {
    boardData: { name: string }[];
    room_name?: string;
    username?: string;
    roomId?: string;
    roomPassword?: string;
    mode?: GameMode;
}

function writeMessage(socket: net.Socket, message: object) {
    socket.write(JSON.stringify(message) + '\n');
}

/**
 * One BingoSync connection: its own cookies (session, CSRF token) and room. Every
 * OpenRCT2 server gets its own, so their rooms don't get mixed up.
 */
export class BingoSyncSession {
    private readonly jar = new CookieJar();
    private readonly client: AxiosInstance = wrapper(axios.create({ jar: this.jar } as any));
    private readonly passphrase = generatePassphrase();
    private roomId: string | null = null;
    /** Bumped by every new room request, so an older one stops retrying */
    private requestCount = 0;

    constructor(
        private readonly name: string,
        /** BingoSync instance, e.g. https://bingosync.bingothon.com/ */
        private readonly baseUrl: string,
    ) {}

    private log(message: string) {
        console.log(`[${this.name}] [BingoSync] ${message}`);
    }

    /**
     * Create or join the room, retrying while BingoSync is unreachable. Stops when the plugin
     * disconnects or asks again; the plugin only hears about the last failure.
     */
    async connectOrCreate(socket: net.Socket, request: ConnectOrCreateRequest) {
        const thisRequest = ++this.requestCount;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (socket.destroyed || thisRequest !== this.requestCount) return;

            let error: string | null;
            try {
                error =
                    request.roomId && request.roomPassword
                        ? await this.connect(socket, request.roomId, request.roomPassword, request.username)
                        : await this.create(socket, request);
            } catch (err) {
                error = `Error creating or connecting to bingo board (${err instanceof Error ? err.message : err})`;
            }
            if (!error) return;

            if (attempt === MAX_ATTEMPTS) {
                this.log(`${error} - giving up`);
                writeMessage(socket, { error });
                return;
            }
            this.log(`${error} - retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }

    /** Join an existing room. Returns an error message, or null when the plugin got the room. */
    private async connect(socket: net.Socket, roomId: string, roomPassword: string, username?: string): Promise<string | null> {
        this.log(`Connecting to existing room ${roomId}`);
        const csrfToken = await this.fetchCsrfToken();
        if (!csrfToken) return 'CSRF token is missing. Cannot connect to bingo board.';

        const payload = new URLSearchParams({
            csrfmiddlewaretoken: csrfToken,
            encoded_room_uuid: roomId,
            player_name: username || DEFAULT_USERNAME,
            passphrase: roomPassword,
        });
        const response = await this.client.post(`${this.baseUrl}room/${roomId}`, payload, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: this.baseUrl,
                'X-CSRFToken': csrfToken,
            },
        });
        const board = await this.client.get(`${this.baseUrl}room/${roomId}/board`);

        if (response.status === 200 && board.status === 200) {
            this.roomId = roomId;
            writeMessage(socket, {
                message: 'Successfully connected to existing bingo board!',
                roomUrl: `${this.baseUrl}room/${roomId}`,
                passphrase: roomPassword,
                boardData: board.data,
            });
            return null;
        }
        return 'Failed to connect to the existing room. Check room ID and password.';
    }

    /** Create a new room for the board. Returns an error message, or null when the plugin got the room. */
    private async create(socket: net.Socket, request: ConnectOrCreateRequest): Promise<string | null> {
        this.log('Creating a new room');
        const csrfToken = await this.fetchCsrfToken();
        if (!csrfToken) return 'CSRF token is missing. Cannot create bingo board.';

        const passphrase = request.roomPassword || this.passphrase;
        const payload = {
            room_name: request.room_name || DEFAULT_ROOM_NAME,
            passphrase,
            nickname: request.username || DEFAULT_USERNAME,
            game_type: '18',
            variant_type: '18',
            custom_json: JSON.stringify(request.boardData),
            lockout_mode: request.mode === 'lockout' ? LOCKOUT_MODE.lockout : LOCKOUT_MODE.nonLockout,
            seed: '',
            hide_card: 'on',
        };
        const response = await this.client.post(this.baseUrl, new URLSearchParams(payload), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: this.baseUrl,
                'X-CSRFToken': csrfToken,
            },
        });

        const createdRoomId = roomMatcher(typeof response.data === 'string' ? response.data : '');
        if (createdRoomId) {
            this.roomId = createdRoomId;
            this.log(`Created room ${createdRoomId}`);
            writeMessage(socket, {
                message: 'Bingo board created successfully!',
                roomUrl: `${this.baseUrl}room/${createdRoomId}`,
                passphrase,
            });
            return null;
        }
        return 'Room ID not found in response data.';
    }

    async selectGoal(socket: net.Socket, slot: string, color: string, room?: string) {
        const roomId = room || this.roomId;
        try {
            if (!roomId) {
                writeMessage(socket, { error: 'Room ID is missing. Cannot select goal.' });
                return;
            }

            const csrfToken = this.jar.getCookiesSync(this.baseUrl).find((cookie) => cookie.key === 'csrftoken')?.value;
            if (!csrfToken) {
                writeMessage(socket, { error: 'CSRF token is missing. Cannot select goal.' });
                return;
            }

            const response = await this.client.put(
                `${this.baseUrl}api/select`,
                JSON.stringify({ room: roomId, slot, color, remove_color: false }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest',
                        'X-CSRFToken': csrfToken,
                    },
                },
            );

            if (response.status === 200) {
                writeMessage(socket, { message: `Goal in slot ${slot} selected with color ${color}.` });
            } else {
                console.error(`[${this.name}] [BingoSync] Unexpected response ${response.status}:`, response.data);
                writeMessage(socket, { error: `Failed to select goal. Status: ${response.status}.` });
            }
        } catch (error) {
            console.error(`[${this.name}] [BingoSync] Error selecting goal:`, error);
            writeMessage(socket, { error: 'An error occurred while selecting the goal.' });
        }
    }

    private async fetchCsrfToken(): Promise<string | null> {
        try {
            await this.client.get(this.baseUrl);
            const cookies = await this.jar.getCookies(this.baseUrl);
            const csrfTokenCookie = cookies.find((cookie) => cookie.key === 'csrftoken');
            return csrfTokenCookie ? csrfTokenCookie.value : null;
        } catch (error) {
            this.log(`Couldn't reach ${this.baseUrl}: ${error instanceof Error ? error.message : error}`);
            return null;
        }
    }
}
