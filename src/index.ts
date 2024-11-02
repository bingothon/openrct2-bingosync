import net from 'net';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const BINGOSYNC_URL = 'https://bingosync.com/';
const ROOM_PASSPHRASE = generatePassphrase();
const PORT = 3000;

// Constants for default values
const DEFAULT_ROOM_NAME = 'OpenRCT2 Bingo';
const DEFAULT_USERNAME = 'openrct2';


let roomId: string | null = null;
let board: { name: string }[] = [];

function generatePassphrase(length: number = 8): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let passphrase = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    passphrase += characters[randomIndex];
  }
  return passphrase;
}

// Initialize Axios with cookie jar support
const jar = new CookieJar();
const client = wrapper(axios.create({ jar } as any));

// Utility function to send messages with consistent newline termination
function writeMessage(socket: net.Socket, message: object) {
  const messageString = JSON.stringify(message) + '\n';
  socket.write(messageString, 'utf8', () => {
    console.log("Sent message:", messageString);
  });
}

const server = net.createServer((socket) => {
  console.log('Client connected');
  let buffer = '';

  socket.on('data', async (data) => {
    buffer += data.toString();
    let messages = buffer.split('\n');
    buffer = messages.pop() || ''; // Keep any incomplete message in the buffer

    for (const message of messages) {
      if (message.trim()) {
        console.log('Received message from client:', message);
        try {
          const msg = JSON.parse(message);

          if (msg.action === 'createBoard') {
            console.log('Creating board with client-provided data...');
            await createBoard(socket, msg.boardData, msg.room_name, msg.username);
          } else if (msg.action === 'getBoard') {
            console.log('Fetching board...');
            await getBoard(socket);
          } else if (msg.action === 'selectGoal') {
            console.log(`Selecting goal in slot ${msg.slot} with color ${msg.color}...`);
            await selectGoal(socket, msg.slot, msg.color);
          } else {
            writeMessage(socket, { error: 'Invalid action' });
          }
        } catch (err) {
          console.error('Failed to parse client message:', err);
          writeMessage(socket, { error: 'Invalid JSON format' });
        }
      }
    }
  });

  socket.on('close', () => {
    console.log('Client disconnected');
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
});

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

// Matches room ID from the response data
function roomMatcher(data: string): string | null {
  const match = data.match(/window\.sessionStorage\.setItem\(["']room["'],\s*["']([a-zA-Z0-9-_]+)["']\);/s);
  return match ? match[1] : null;
}

// Create bingo board
// Create bingo board
async function createBoard(socket: net.Socket, boardData: { name: string }[], room_name: string, username: string) {
  try {
    const csrfToken = await fetchCsrfToken();
    if (!csrfToken) {
      writeMessage(socket, { error: 'CSRF token is missing. Cannot create bingo board.' });
      return;
    }

    const goalsJson = JSON.stringify(boardData);
    const payload = {
      room_name: room_name || DEFAULT_ROOM_NAME, // Use provided room name or default
      passphrase: ROOM_PASSPHRASE,
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
    roomId = roomMatcher(data);

    if (roomId) {
      const roomUrl = `${BINGOSYNC_URL}room/${roomId}`;
      writeMessage(socket, {
        message: 'Bingo board created successfully!',
        roomUrl,
        passphrase: ROOM_PASSPHRASE,
      });
    } else {
      writeMessage(socket, { error: 'Room ID not found in response data.' });
    }
  } catch (error) {
    console.error('Error creating bingo board:', error);
    writeMessage(socket, { error: 'Error creating bingo board' });
  }
}

// Function to get bingo board
async function getBoard(socket: net.Socket) {
  try {
    if (!roomId) {
      writeMessage(socket, { error: 'Room ID is missing. Cannot get bingo board.' });
      return;
    }
    const boardResponse = await client.get(`${BINGOSYNC_URL}room/${roomId}/board`);
    writeMessage(socket, boardResponse.data as object);
  } catch (error) {
    console.error('Error getting bingo board:', error);
    writeMessage(socket, { error: 'Error getting bingo board' });
  }
}

// Function to select a goal
async function selectGoal(socket: net.Socket, slot: string, color: string) {
  try {
    if (!roomId) {
      writeMessage(socket, { error: 'Room ID is missing. Cannot select goal.' });
      return;
    }

    const csrfToken = jar.getCookiesSync(BINGOSYNC_URL).find(cookie => cookie.key === 'csrftoken')?.value;
    if (!csrfToken) {
      writeMessage(socket, { error: 'CSRF token is missing. Cannot select goal.' });
      return;
    }

    const payload = {
      room: roomId,
      slot,
      color,
      remove_color: false,
    };

    const response = await client.put(
      `${BINGOSYNC_URL}api/select`,
      JSON.stringify(payload),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'X-CSRFToken': csrfToken,
        },
      }
    );

    if (response.status === 200) {
      writeMessage(socket, { message: `Goal in slot ${slot} selected with color ${color}.` });
    } else {
      console.error('Unexpected response status:', response.status);
      console.error('Response data:', response.data);
      writeMessage(socket, { error: `Failed to select goal. Status: ${response.status}.` });
    }
  } catch (error) {
    console.error('Error selecting goal:', error);
    writeMessage(socket, { error: 'An error occurred while selecting the goal.' });
  }
}

// Start the TCP server
server.listen(PORT, () => {
  console.log(`Openrct2-bingosync server listening on port ${PORT}, waiting for clients...`);
});
