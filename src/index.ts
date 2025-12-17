import { makeTownsBot } from "@towns-protocol/bot";
import commands from "./commands";
import { checkAvailability } from "./services/ens";

const bot = await makeTownsBot(
  process.env.APP_PRIVATE_DATA!,
  process.env.JWT_SECRET!,
  {
    commands,
  }
);

bot.onSlashCommand("help", async (handler, { channelId }) => {
  await handler.sendMessage(
    channelId,
    "**Available Commands:**\n\n" +
      "• `/help` - Show this help message\n" +
      "• `/time` - Get the current time\n" +
      "• `/check <domain>` - Check ENS domain availability\n\n" +
      "**Message Triggers:**\n\n" +
      "• Mention me - I'll respond\n" +
      "• React with 👋 - I'll wave back" +
      '• Say "hello" - I\'ll greet you back\n' +
      '• Say "ping" - I\'ll show latency\n' +
      '• Say "react" - I\'ll add a reaction\n'
  );
});

bot.onSlashCommand("time", async (handler, { channelId }) => {
  const currentTime = new Date().toLocaleString();
  await handler.sendMessage(channelId, `Current time: ${currentTime} ⏰`);
});

bot.onSlashCommand("check", async (handler, { channelId, args }) => {
  // Check if domain name was provided
  if (!args || args.length === 0) {
    await handler.sendMessage(
      channelId,
      "⚠️ Please provide a domain name to check.\n\nUsage: `/check <domain>`\nExample: `/check vitalik`"
    );
    return;
  }

  const domainName = args[0];

  // Send a "checking..." message first
  await handler.sendMessage(
    channelId,
    `Checking availability for **${domainName}.eth**...`
  );

  try {
    const result = await checkAvailability(domainName);

    if (!result.valid) {
      await handler.sendMessage(
        channelId,
        `⚠️ Invalid domain: ${result.reason}`
      );
      return;
    }

    if (result.available) {
      await handler.sendMessage(
        channelId,
        `✅ **${domainName}.eth** is available for registration!`
      );
    } else {
      await handler.sendMessage(
        channelId,
        `❌ **${domainName}.eth** is already registered.`
      );
    }
  } catch (error) {
    console.error("Error checking ENS availability:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while checking domain availability. Please try again later."
    );
  }
});

bot.onMessage(async (handler, { message, channelId, eventId, createdAt }) => {
  if (message.includes("hello")) {
    await handler.sendMessage(channelId, "Hello there! 👋");
    return;
  }
  if (message.includes("ping")) {
    const now = new Date();
    await handler.sendMessage(
      channelId,
      `Pong! 🏓 ${now.getTime() - createdAt.getTime()}ms`
    );
    return;
  }
  if (message.includes("react")) {
    await handler.sendReaction(channelId, eventId, "👍");
    return;
  }
});

bot.onReaction(async (handler, { reaction, channelId }) => {
  if (reaction === "👋") {
    await handler.sendMessage(channelId, "I saw your wave! 👋");
  }
});

const app = bot.start();
// After your /webhook route
app.get("/.well-known/agent-metadata.json", async (c) => {
  return c.json(await bot.getIdentityMetadata());
});
export default app;
