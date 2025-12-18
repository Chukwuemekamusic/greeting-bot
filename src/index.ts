import { makeTownsBot, getSmartAccountFromUserId } from "@towns-protocol/bot";
import commands from "./commands";
import {
  checkAvailability,
  checkExpiry,
  getUserPortfolio,
  resolveENSToAddress,
} from "./services/ens";
import { normalizeENSName } from "./utils/ens";

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
      "• `/check <domain>` - Check ENS domain availability\n" +
      "• `/expiry <domain>` - Check ENS domain expiration date\n" +
      "• `/portfolio` - View your ENS domain portfolio\n" +
      "• `/portfolio <address>` - View portfolio for an address\n" +
      "• `/portfolio <domain>` - View portfolio for a domain owner\n\n" +
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
  if (!args || args.length === 0) {
    await handler.sendMessage(
      channelId,
      "⚠️ Please provide a domain name to check.\n\nUsage: `/check <domain>`\nExample: `/check vitalik`"
    );
    return;
  }

  // Normalize the domain name early
  const { normalized, valid, reason } = normalizeENSName(args[0]);
  const fullName = `${normalized}.eth`;

  // Check validity before proceeding
  if (!valid) {
    await handler.sendMessage(
      channelId,
      `⚠️ Invalid domain: ${reason}`
    );
    return;
  }

  await handler.sendMessage(
    channelId,
    `Checking availability for **${fullName}**...`
  );

  try {
    const result = await checkAvailability(normalized);

    if (result.available) {
      let message = `✅ **${fullName}** is available for registration!`;
      if (result.priceEth) {
        message += `\n💰 Price: ${result.priceEth} ETH/year`;
      }
      await handler.sendMessage(channelId, message);
    } else {
      await handler.sendMessage(
        channelId,
        `❌ **${fullName}** is already registered.`
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

bot.onSlashCommand("expiry", async (handler, { channelId, args }) => {
  if (!args || args.length === 0) {
    await handler.sendMessage(
      channelId,
      "⚠️ Please provide a domain name to check.\n\nUsage: `/expiry <domain>`\n\nExample: `/expiry vitalik`"
    );
    return;
  }

  // Normalize the domain name early
  const { normalized, valid, reason } = normalizeENSName(args[0]);
  const fullName = `${normalized}.eth`;

  // Check validity before proceeding
  if (!valid) {
    await handler.sendMessage(
      channelId,
      `⚠️ Invalid domain: ${reason}`
    );
    return;
  }

  await handler.sendMessage(
    channelId,
    `Checking expiry for **${fullName}**...`
  );

  try {
    const result = await checkExpiry(normalized);

    if (!result.registered) {
      await handler.sendMessage(
        channelId,
        `ℹ️ **${fullName}** is not registered.`
      );
      return;
    }

    // Build the expiry message
    let message = `**${fullName}** Expiry Information\n\n`;

    // Expiry status
    if (result.expired) {
      if (result.inGracePeriod) {
        message += `⚠️ **Status:** Expired (in grace period)\n`;
        message += `📅 **Expired on:** ${result.expirationDate?.toLocaleDateString()}\n`;
        message += `⏰ **Grace period ends:** ${result.gracePeriodEnds?.toLocaleDateString()}\n`;
        const daysUntilGraceEnd = Math.floor(
          ((result.gracePeriodEnds?.getTime() || 0) - Date.now()) /
            (1000 * 60 * 60 * 24)
        );
        message += `⌛ **Days until grace period ends:** ${daysUntilGraceEnd} days\n`;
      } else {
        message += `❌ **Status:** Expired (grace period ended)\n`;
        message += `📅 **Expired on:** ${result.expirationDate?.toLocaleDateString()}\n`;
      }
    } else {
      message += `✅ **Status:** Active\n`;
      message += `📅 **Expires on:** ${result.expirationDate?.toLocaleDateString()}\n`;
      message += `⌛ **Days remaining:** ${result.daysUntilExpiry} days\n`;

      // Add warning if expiring soon
      if (
        result.daysUntilExpiry !== undefined &&
        result.daysUntilExpiry <= 30
      ) {
        message += `\n⚠️ **Warning:** Domain expires in less than 30 days! Consider renewing soon.\n`;
      }
    }

    // Owner information
    if (result.registrant) {
      message += `\n👤 **Registrant (NFT holder):** \`${result.registrant}\`\n`;
    }
    if (result.owner && result.owner !== result.registrant) {
      message += `🔑 **Controller (ENS owner):** \`${result.owner}\`\n`;
    }

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Error checking ENS expiry:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while checking domain expiry. Please try again later."
    );
  }
});

bot.onSlashCommand(
  "portfolio",
  async (handler, { channelId, args, userId }) => {
    try {
      // Determine which address to check
      let addressToCheck: string;
      let isOwnWallet = false;
      let displayName: string | undefined;

      if (!args || args.length === 0) {
        // Case 1: No argument - check user's own wallet
        const userWallet = await getSmartAccountFromUserId(bot, { userId });
        addressToCheck = userWallet as string;
        isOwnWallet = true;
        await handler.sendMessage(channelId, `Fetching your ENS portfolio...`);
      } else if (args[0].startsWith("0x") && args[0].length === 42) {
        // Case 2: Ethereum address provided
        addressToCheck = args[0];
        await handler.sendMessage(
          channelId,
          `Fetching portfolio for \`${addressToCheck}\`...`
        );
      } else {
        // Case 3: ENS domain name provided - resolve it first
        const domainInput = args[0];
        await handler.sendMessage(
          channelId,
          `Resolving **${domainInput}** and fetching portfolio...`
        );

        const resolution = await resolveENSToAddress(domainInput);

        if (!resolution.success) {
          await handler.sendMessage(
            channelId,
            `⚠️ ${resolution.reason}\n\nUsage: \`/portfolio\`, \`/portfolio <address>\`, or \`/portfolio <domain>\``
          );
          return;
        }

        addressToCheck = resolution.address;
        displayName = resolution.fullName;
      }

      const portfolio = await getUserPortfolio(addressToCheck);

      // Build the portfolio message header
      let message = "";
      if (isOwnWallet) {
        message = `**Your ENS Portfolio**\n\n`;
      } else if (displayName) {
        message = `**ENS Portfolio for ${displayName}**\n`;
        message += `_Owner: \`${addressToCheck.slice(0, 6)}...${addressToCheck.slice(-4)}\`_\n\n`;
      } else {
        message = `**ENS Portfolio for \`${addressToCheck.slice(0, 6)}...${addressToCheck.slice(-4)}\`**\n\n`;
      }

      // No domains case
      if (portfolio.totalDomains === 0) {
        message += `ℹ️ No ENS domains found for this address.`;
        await handler.sendMessage(channelId, message);
        return;
      }

      // Summary stats
      message += `**📊 Summary**\n`;
      message += `• Total domains: ${portfolio.totalDomains}\n`;
      message += `• Active: ${portfolio.activeDomains}\n`;
      message += `• Expired: ${portfolio.expiredDomains}\n`;
      if (portfolio.expiringSoon > 0) {
        message += `• ⚠️ Expiring soon (<30 days): ${portfolio.expiringSoon}\n`;
      }
      if (portfolio.inGracePeriod > 0) {
        message += `• In grace period: ${portfolio.inGracePeriod}\n`;
      }

      // List domains grouped by status
      const activeDomains = portfolio.domains.filter((d) => !d.expired);
      const expiredDomains = portfolio.domains.filter((d) => d.expired);

      if (activeDomains.length > 0) {
        message += `\n**✅ Active Domains (${activeDomains.length})**\n`;
        activeDomains.slice(0, 10).forEach((d) => {
          const daysLeft = d.daysUntilExpiry || 0;
          const warningIcon = daysLeft <= 30 ? " ⚠️" : "";
          message += `\n• **${
            d.fullName
          }** - expires ${d.expirationDate?.toLocaleDateString()} (${daysLeft} days)${warningIcon}\n`;
        });
        if (activeDomains.length > 10) {
          message += `_... and ${activeDomains.length - 10} more_\n`;
        }
      }

      if (expiredDomains.length > 0) {
        message += `\n**❌ Expired Domains (${expiredDomains.length})**\n`;
        expiredDomains.slice(0, 5).forEach((d) => {
          const status = d.inGracePeriod
            ? " (in grace period)"
            : " (grace period ended)";
          message += `• **${
            d.fullName
          }** - expired ${d.expirationDate?.toLocaleDateString()}${status}\n`;
        });
        if (expiredDomains.length > 5) {
          message += `_... and ${expiredDomains.length - 5} more_\n`;
        }
      }

      message += `\n_Use \`/expiry <domain>\` for detailed info on a specific domain._`;

      await handler.sendMessage(channelId, message);
    } catch (error) {
      console.error("Error fetching portfolio:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while fetching the portfolio. Please try again later."
      );
    }
  }
);

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
