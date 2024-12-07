import * as net from "net";

export function startGameActions(server: net.Server) {
  console.log("Starting Game Actions Listener...");

  const clients: net.Socket[] = []; // Keep track of connected clients

  // Handle new client connections
  server.on("connection", (client) => {
    console.log("New client connected.");
    clients.push(client);

    client.on("close", () => {
      console.log("Client disconnected.");
      const index = clients.indexOf(client);
      if (index > -1) {
        clients.splice(index, 1);
      }
    });

    client.on("error", (err) => {
      console.error(`Client error: ${err.message}`);
    });
  });

  // Listen for and handle actions
  server.on("broadcast", (action: { action: string; [key: string]: any }) => {
    console.log(`Broadcasting game action: ${JSON.stringify(action)}`);

    // Send the action to all connected clients
    clients.forEach((client) => {
      client.write(JSON.stringify(action) + "\n"); // Send action JSON to each client
    });

    // Handle the action internally
    handleGameAction(action);
  });
}

function handleGameAction(action: { action: string; [key: string]: any }) {
  switch (action.action) {
    case "addCash":
      handleAddCash(action.amount);
      break;

    case "triggerEvent":
      handleTriggerEvent(action.eventId);
      break;

    // Add more game-specific actions as needed
    default:
      console.log(`Unknown game action: ${action.action}`);
  }
}

function handleAddCash(amount: number) {
  if (typeof amount !== "number" || isNaN(amount)) {
    console.error("Invalid amount for addCash action");
    return;
  }

  console.log(`Adding ${amount} cash to the game.`);
  // Emit action back to clients
  const server = net.createServer(); // Replace with your actual server instance
  server.emit("broadcast", { action: "addCash", amount });
}

function handleTriggerEvent(eventId: string) {
  if (!eventId) {
    console.error("Invalid eventId for triggerEvent action");
    return;
  }

  console.log(`Triggering event with ID: ${eventId}`);
  // Emit action back to clients
  const server = net.createServer(); // Replace with your actual server instance
  server.emit("broadcast", { action: "triggerEvent", eventId });
}
