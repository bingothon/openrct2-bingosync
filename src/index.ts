import net from 'net';
import axios from 'axios';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
let serverProcess: ChildProcessWithoutNullStreams | null = null;

import os from "os";
import { promisify } from "util";
import { exec } from "child_process";
import path from "path";

async function getOpenRCT2Directory() {
  try {
    const platform = process.platform;

    if (platform === "win32") {
      // Windows
      const { stdout } = await promisify(exec)(
        "powershell -command \"[Environment]::GetFolderPath('MyDocuments')\""
      );
      return path.join(stdout.trim(), "OpenRCT2");
    } else if (platform === "darwin") {
      // MacOS
      return path.join(os.homedir(), "Library", "Application Support", "OpenRCT2");
    } else {
      // Linux
      const configFolder = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
      return path.join(configFolder, "OpenRCT2");
    }
  } catch (error) {
    console.error("Error in getOpenRCT2Directory:", error);
    throw error; // Re-throw to prevent silent failure
  }
}


// Main async wrapper to pre-resolve async values
(async () => {

  try {

    const server = net.createServer((socket) => {
      console.log('Client connected');
      let buffer = '';

      socket.on('data', async (data) => {
        buffer += data.toString();
        let messages = buffer.split('\n');
        buffer = messages.pop() || ''; // Keep incomplete message in buffer

        for (const message of messages) {
          if (message.trim()) {
            console.log('Received message from client:', message);
            try {
              const msg = JSON.parse(message);
              await handleClientMessage(socket, msg);
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
    const openRCT2Directory = await getOpenRCT2Directory() || "./OpenRCT2";
    const defaultOptions = {
      port: 3000,
      command: './OpenRCT2-v0.4.16-linux-x86_64.AppImage',
      userDirectory: openRCT2Directory,
      scenario: `${openRCT2Directory}/scenario/bingothon-map.park`,
      headless: true,
    };

    function parseArgs(args: string[], defaults: Record<string, any>) {
      const parsed: Record<string, any> = { ...defaults };

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
          const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // CamelCase keys
          const next = args[i + 1];
          if (next && !next.startsWith('--')) {
            parsed[key] = isNaN(Number(next)) ? next : Number(next); // Auto-convert numbers
            i++; // Skip next argument
          } else {
            parsed[key] = true; // Boolean flag
          }
        }
      }

      return parsed;
    }

    // Manual argument parsing
    const argv = parseArgs(process.argv.slice(2), defaultOptions);

    console.log('Parsed arguments:', argv);


    // Extract values from argv
    const PORT = argv.port;
    const OPENRCT2_COMMAND = argv.command;

    console.log(PORT, OPENRCT2_COMMAND);

    // Construct arguments dynamically
    const OPENRCT2_ARGS = [
      'host',
      argv.scenario,
      ...(argv.headless ? ['--headless'] : []), // Add headless only if true
      '--user-data-path',
      argv.userDirectory
    ];

    console.log("Resolved OpenRCT2 Directory:", openRCT2Directory);
    console.log("Command Line Arguments:", argv);
    console.log("Spawn Arguments:", OPENRCT2_ARGS);

    const BINGOSYNC_URL = 'https://bingosync.com/';
    const ROOM_PASSPHRASE = generatePassphrase();

    // Constants for default values
    const DEFAULT_ROOM_NAME = 'OpenRCT2 Bingo';
    const DEFAULT_USERNAME = 'openrct2';

    let roomId: string | null = null;
    let board: { name: string }[] = [];

    // Function to start the OpenRCT2 server
    function startServer(socket?: net.Socket) {
      if (serverProcess) {
        console.log('Server is already running. Cannot start a new instance.');
        if (socket) writeMessage(socket, { error: 'Server is already running.' });
        return;
      }

      console.log('Starting OpenRCT2 server...');
      console.log('Using Command:', OPENRCT2_COMMAND);
      console.log('With Arguments:', OPENRCT2_ARGS);

      serverProcess = spawn(OPENRCT2_COMMAND, OPENRCT2_ARGS);

      serverProcess.stdout.on('data', (data) => {
        console.log(`[OpenRCT2]: ${data}`);
      });

      serverProcess.stderr.on('data', (data) => {
        console.error(`[OpenRCT2 Error]: ${data}`);
      });

      serverProcess.on('close', (code) => {
        console.log(`OpenRCT2 server exited with code ${code}`);
        serverProcess = null;
      });

      if (socket) writeMessage(socket, { message: 'OpenRCT2 server started successfully.' });
    }

    // Function to stop the OpenRCT2 server
    function stopServer(socket?: net.Socket) {
      if (!serverProcess) {
        console.log('No server is currently running.');
        if (socket) writeMessage(socket, { error: 'No server is currently running.' });
        return;
      }

      console.log('Stopping OpenRCT2 server...');
      serverProcess.kill('SIGTERM');
      serverProcess = null;

      if (socket) writeMessage(socket, { message: 'OpenRCT2 server stopped successfully.' });
    }

    // Function to restart the OpenRCT2 server
    function restartServer(socket?: net.Socket) {
      console.log('Restarting OpenRCT2 server...');
      if (serverProcess) {
        stopServer();
      }
      startServer(socket);
    }
    startServer();
    // Function to handle client actions
    async function handleClientMessage(socket: net.Socket, msg: any) {
      try {
        switch (msg.action) {
          case 'start':
            startServer(socket);
            break;
          case 'stop':
            stopServer(socket);
            break;
          case 'restart':
            restartServer(socket);
            break;
          case 'connectOrCreate':
            console.log('Creating board with client-provided data...');
            await createOrConnectBoard(socket, msg.boardData, msg.room_name, msg.username, msg.roomId, msg.roomPassword);
            break;
          case 'getBoard':
            console.log('Fetching board...');
            await getBoard(socket);
            break;
          case 'selectGoal':
            console.log(`Selecting goal in slot ${msg.slot} with color ${msg.color}...`);
            await selectGoal(socket, msg.slot, msg.color, msg.room);
            break;
          default:
            writeMessage(socket, { error: 'Invalid action' });
        }
      } catch (err) {
        console.error('Error handling client message:', err);
        writeMessage(socket, { error: 'Error processing action.' });
      }
    }

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
    // Create or connect to a bingo board
    async function createOrConnectBoard(
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
    async function selectGoal(socket: net.Socket, slot: string, color: string, room: string) {
      try {

        console.log('Calling selectGoal at', new Date().toISOString());
        console.log('Room ID at selectGoal:', room);
        if (!room) {
          writeMessage(socket, { error: 'Room ID is missing. Cannot select goal.' });
          return;
        }

        const csrfToken = jar.getCookiesSync(BINGOSYNC_URL).find(cookie => cookie.key === 'csrftoken')?.value;
        if (!csrfToken) {
          writeMessage(socket, { error: 'CSRF token is missing. Cannot select goal.' });
          return;
        }

        const payload = {
          room,
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
    // Clean up on process exit
    process.on('exit', () => {
      if (serverProcess) {
        console.log('Cleaning up OpenRCT2 server process...');
        serverProcess.kill('SIGTERM');
      }
    });

    process.on('SIGINT', () => process.exit());
    process.on('SIGTERM', () => process.exit());
  } catch (error) {
    console.error("Error in main async wrapper:", error);
    process.exit(1);
  }
})();