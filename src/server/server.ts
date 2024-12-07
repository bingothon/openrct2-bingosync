import net from 'net';
import split2 from 'split2';
import { handleClientMessage } from './clientHandlers';

export function startTcpServer(port: number) {
    const clients: net.Socket[] = []; // Maintain a list of connected clients

    const server = net.createServer((socket) => {
        console.log("Client connected");
        clients.push(socket); // Add new client to the list

        socket.pipe(split2()).on("data", (line: string) => {
            try {
                console.log(`Received data from client: ${line}`); // Add this log
                const msg = JSON.parse(line);
                handleClientMessage(socket, msg);
            } catch (err) {
                console.error("Invalid message format:", err);
                socket.write(JSON.stringify({ error: "Invalid JSON format" }) + "\n");
            }
        });

        socket.on("close", () => {
            console.log("Client disconnected");
            // Remove the client from the list
            const index = clients.indexOf(socket);
            if (index > -1) {
                clients.splice(index, 1);
            }
        });

        socket.on("error", (error) => console.error("Socket error:", error));
    });

    // Handle broadcast events from Twitch IRC
    server.on("broadcast", (commandData) => {
        console.log(`Broadcasting command: ${commandData} to ${clients.length} clients`);

        // Forward the command to all connected clients
        clients.forEach((socket) => {
            socket.write(JSON.stringify({ action: "command", data: commandData }) + "\n");
        });
    });

    server.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });

    return server;
}
