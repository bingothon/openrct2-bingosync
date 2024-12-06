import * as net from "net";
import dotenv from "dotenv";
dotenv.config();

const SERVER = "irc.chat.twitch.tv";
const PORT = 6667;
const NICKNAME = `justinfan${Math.floor(Math.random() * 100000)}`;
const CHANNEL = process.env.TWITCH_CHANNEL || "#channel";

// Allowed color list (all in lowercase for consistent matching)
const validColors = [
  "black",
  "grey",
  "white",
  "dark purple",
  "light purple",
  "bright purple",
  "dark blue",
  "light blue",
  "icy blue",
  "dark water",
  "light water",
  "saturated green",
  "dark green",
  "moss green",
  "bright green",
  "olive green",
  "dark olive green",
  "bright yellow",
  "yellow",
  "dark yellow",
  "pastel orange",
  "dark orange",
  "light brown",
  "saturated brown",
  "dark brown",
  "salmon pink",
  "bordeaux red",
  "saturated red",
  "bright red",
  "dark pink",
  "bright pink",
  "light pink",
  "army green",
  "honeydew",
  "tan",
  "maroon",
  "coral pink",
  "forest green",
  "chartreuse",
  "hunter green",
  "celadon",
  "lime green",
  "sepia",
  "peach",
  "periwinkle",
  "viridian",
  "seafoam green",
  "violet",
  "lavender",
  "orange light",
  "deep water",
  "pastel pink",
  "umber",
  "beige",
];

// Allowed animations list (in lowercase for consistent matching)
const validAnimations: string[] = [
  "walking",
  "checktime",
  "watchride",
  "eatfood",
  "shakehead",
  "emptypockets",
  "holdmat",
  "sittingidle",
  "sittingeatfood",
  "sittinglookaroundleft",
  "sittinglookaroundright",
  "hanging",
  "wow",
  "throwup",
  "jump",
  "drowning",
  "joy",
  "readmap",
  "wave",
  "wave2",
  "takephoto",
  "clap",
  "disgust",
  "drawpicture",
  "beingwatched",
  "withdrawmoney",
];

// Allowed commands and their valid arguments
const commandValidation: Record<string, string[]> = {
  shirt: validColors,
  pants: validColors,
  anim: validAnimations, // Valid animations
  start: [], // No arguments required
};

// Cooldown management
let lastCommandTimestamp: number | null = null;

export function startTwitchClient(server: net.Server) {
  const client = new net.Socket();

  console.log("Starting Twitch IRC client...");

  client.connect(PORT, SERVER, () => {
    console.log(`Connected to Twitch IRC as ${NICKNAME}`);
    console.log(`Joining channel: #${CHANNEL}`);
    client.write(`NICK ${NICKNAME}\r\n`);
    client.write(`JOIN #${CHANNEL}\r\n`);
  });

  client.on("data", (data) => {
    const messages = data.toString().split("\r\n");
    messages.forEach((message) => {
      if (message.trim() === "") return; // Skip empty lines

      if (message.startsWith("PING")) {
        client.write("PONG :tmi.twitch.tv\r\n");
        return;
      }

      // Match commands in the format "!rct <command> <args>"
      const match = message.match(/PRIVMSG #[^ ]+ :!rct (\w+)(.*)/);
      if (match) {
        const command = match[1]; // Extract the command (e.g., "shirt")
        const args = match[2]?.trim().toLowerCase(); // Convert arguments to lowercase for case-insensitive matching

        // Implement cooldown logic
        const currentTime = Date.now();
        if (lastCommandTimestamp && currentTime - lastCommandTimestamp < 3000) {
          // Silent cooldown: discard command
          return;
        }
        lastCommandTimestamp = currentTime;

        if (command in commandValidation) {
          // Validate arguments if required
          if (
            commandValidation[command].length === 0 || // Command doesn't require specific args
            commandValidation[command].includes(args)
          ) {
            const commandData = `${command} ${args}`.trim();
            server.emit("broadcast", commandData); // Emit the validated command
          } else {
            console.log(
              `Invalid arguments for command: ${command}. Received args: "${args}"`
            );
          }
        } else {
          console.log(`Ignoring unsupported command: ${command}`);
        }
      }
    });
  });

  client.on("error", (err) => {
    console.error("Error:", err.message);
  });

  client.on("close", () => {
    console.log("Twitch IRC connection closed");
  });
}
