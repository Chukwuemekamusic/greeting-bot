import { makeTownsBot, getSmartAccountFromUserId } from "@towns-protocol/bot";
import { hexToBytes } from "viem";
import { encodeFunctionData } from "viem";
import commands from "./commands";
import {
  checkAvailability,
  checkExpiry,
  getUserPortfolio,
  resolveENSToAddress,
  getDomainHistory,
  generateRegistrationParams,
  makeCommitment,
  calculateRegistrationCost,
} from "./services/ens";
import { normalizeENSName } from "./utils/ens";
import { ENS_CONFIG, CONTROLLER_ABI, REGISTRATION } from "./constants/ens";
import type { CommitmentState } from "./types/ens";

// In-memory store for pending commitments
const pendingCommitments = new Map<string, CommitmentState>();

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
      "• `/history <domain>` - View complete history of an ENS domain\n" +
      "• `/portfolio` - View your ENS domain portfolio\n" +
      "• `/portfolio <address>` - View portfolio for an address\n" +
      "• `/portfolio <domain>` - View portfolio for a domain owner\n" +
      "• `/register <domain> [years]` - Register an ENS domain (you pay gas)\n\n" +
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
    await handler.sendMessage(channelId, `⚠️ Invalid domain: ${reason}`);
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
    await handler.sendMessage(channelId, `⚠️ Invalid domain: ${reason}`);
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

bot.onSlashCommand("history", async (handler, { channelId, args }) => {
  if (!args || args.length === 0) {
    await handler.sendMessage(
      channelId,
      "⚠️ Please provide a domain name to check.\n\nUsage: `/history <domain>`\n\nExample: `/history vitalik`"
    );
    return;
  }

  // Normalize the domain name early
  const { normalized, valid, reason } = normalizeENSName(args[0]);
  const fullName = `${normalized}.eth`;

  // Check validity before proceeding
  if (!valid) {
    await handler.sendMessage(channelId, `⚠️ Invalid domain: ${reason}`);
    return;
  }

  await handler.sendMessage(
    channelId,
    `Fetching history for **${fullName}**...`
  );

  try {
    const result = await getDomainHistory(normalized);

    if (!result.registered) {
      await handler.sendMessage(
        channelId,
        `ℹ️ **${fullName}** is not registered or not found in the subgraph.`
      );
      return;
    }

    // Build the history message
    let message = `**${fullName}** Domain History\n\n`;

    // Current state
    message += `**📊 Current State**\n`;
    if (result.currentRegistrant) {
      message += `• Owner (NFT): \`${result.currentRegistrant}\n`;
    }
    if (
      result.currentOwner &&
      result.currentOwner !== result.currentRegistrant
    ) {
      message += `• Controller: \`${result.currentOwner}\n`;
    }
    if (result.expiryDate) {
      message += `• Expires: ${result.expiryDate.toLocaleDateString()}\n`;
    }

    // Registration info
    if (result.registrationDate) {
      message += `\n**📅 Registration Info**\n`;
      message += `• Registered: ${result.registrationDate.toLocaleDateString()}\n`;
      if (result.initialRegistrant) {
        message += `• First Owner: \`${result.initialRegistrant}\`\n`;
      }
      if (result.registrationCost) {
        message += `• Cost: ${parseFloat(result.registrationCost).toFixed(
          4
        )} ETH\n`;
      }
    }

    // Stats
    message += `\n**📈 Activity Summary**\n`;
    message += `• Total Events: ${result.events.length}\n`;
    if (result.totalTransfers > 0) {
      message += `• Transfers: ${result.totalTransfers}\n`;
    }
    if (result.totalRenewals > 0) {
      message += `• Renewals: ${result.totalRenewals}\n`;
    }
    if (result.totalResolverChanges > 0) {
      message += `• Resolver Changes: ${result.totalResolverChanges}\n`;
    }

    // Recent events (last 10)
    const recentEvents = result.events.slice(-10).reverse();
    if (recentEvents.length > 0) {
      message += `\n**🕐 Recent Events** (last ${Math.min(
        10,
        result.events.length
      )})\n`;
      for (const event of recentEvents) {
        const emoji =
          event.type === "registered"
            ? "🆕"
            : event.type === "renewed"
            ? "🔄"
            : event.type === "transferred"
            ? "↔️"
            : event.type === "resolver_changed"
            ? "⚙️"
            : event.type === "wrapped"
            ? "📦"
            : event.type === "unwrapped"
            ? "📂"
            : "⏰";

        message += `\n${emoji} ${event.details}\n`;
        message += `   _Block: ${event.blockNumber} • [Tx](https://etherscan.io/tx/${event.transactionHash})_\n`;
      }
    }

    if (result.events.length > 10) {
      message += `\n_Showing last 10 of ${result.events.length} total events_`;
    }

    await handler.sendMessage(channelId, message);
  } catch (error) {
    console.error("Error fetching domain history:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while fetching domain history. Please try again later."
    );
  }
});

bot.onSlashCommand("register", async (handler, { channelId, args, userId }) => {
  if (!args || args.length === 0) {
    await handler.sendMessage(
      channelId,
      "⚠️ Please provide a domain name to register.\n\nUsage: `/register <domain> [years]`\n\nExample: `/register myname` (1 year)\nExample: `/register myname 2` (2 years)"
    );
    return;
  }

  // Parse arguments
  const domainArg = args[0];
  const yearsArg = args[1] ? parseInt(args[1]) : 1;

  // Validate years
  if (isNaN(yearsArg) || yearsArg < 1 || yearsArg > 10) {
    await handler.sendMessage(
      channelId,
      "⚠️ Invalid duration. Please specify 1-10 years.\n\nExample: `/register myname 2`"
    );
    return;
  }

  // Normalize the domain name
  const { normalized, valid, reason } = normalizeENSName(domainArg);
  const fullName = `${normalized}.eth`;

  // Check validity before proceeding
  if (!valid) {
    await handler.sendMessage(channelId, `⚠️ Invalid domain: ${reason}`);
    return;
  }

  await handler.sendMessage(
    channelId,
    `Checking availability for **${fullName}**...`
  );

  try {
    // Check availability
    const availability = await checkAvailability(normalized);

    if (!availability.available) {
      await handler.sendMessage(
        channelId,
        `❌ **${fullName}** is not available for registration.${
          availability.reason ? `\n\nReason: ${availability.reason}` : ""
        }`
      );
      return;
    }

    // Calculate registration cost
    const { totalEth } = await calculateRegistrationCost(normalized, yearsArg);

    // Get user's wallet address
    const userWallet = (await getSmartAccountFromUserId(bot, {
      userId,
    })) as `0x${string}`;

    // Generate registration parameters
    const params = generateRegistrationParams(normalized, userWallet, yearsArg);

    // Generate commitment hash
    const commitmentHash = await makeCommitment(params);

    // Create commitment ID (using channelId + userId + domain for uniqueness)
    const commitmentId = `commit-${channelId}-${userId}-${normalized}`;

    // Store commitment state
    pendingCommitments.set(commitmentId, {
      userId,
      channelId,
      domain: fullName,
      label: normalized,
      commitment: commitmentHash,
      secret: params.secret,
      owner: userWallet,
      duration: params.duration,
      timestamp: Date.now(),
    });

    // Send confirmation message
    await handler.sendMessage(
      channelId,
      `✅ **${fullName}** is available!\n\n` +
        `📋 **Registration Details:**\n` +
        `• Duration: ${yearsArg} year${yearsArg > 1 ? "s" : ""}\n` +
        `• Cost: ${totalEth} ETH\n` +
        `• Owner: \`${userWallet}\`\n\n` +
        `🔐 **Starting registration process...**\n` +
        `Step 1/2: Submitting commitment transaction...`
    );

    // Prepare commit transaction data
    const commitData = encodeFunctionData({
      abi: CONTROLLER_ABI,
      functionName: "commit",
      args: [commitmentHash],
    });

    // Send commit transaction interaction request
    await handler.sendInteractionRequest(
      channelId,
      {
        case: "transaction",
        value: {
          id: commitmentId,
          title: `Commit ENS Registration: ${fullName}`,
          content: {
            case: "evm",
            value: {
              chainId: REGISTRATION.CHAIN_ID,
              to: ENS_CONFIG.REGISTRAR_CONTROLLER,
              value: "0",
              data: commitData,
              signerWallet: undefined,
            },
          },
        },
      },
      hexToBytes(userId as `0x${string}`)
    );

    await handler.sendMessage(
      channelId,
      `📤 **Transaction request sent!**\n\n` +
        `Please approve the commit transaction in your wallet.\n` +
        `After confirmation, you'll need to wait 60 seconds before completing the registration.`
    );
  } catch (error) {
    console.error("Error initiating registration:", error);
    await handler.sendMessage(
      channelId,
      "❌ An error occurred while initiating registration. Please try again later."
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
        message += `_Owner: \`${addressToCheck.slice(
          0,
          6
        )}...${addressToCheck.slice(-4)}\`_\n\n`;
      } else {
        message = `**ENS Portfolio for \`${addressToCheck.slice(
          0,
          6
        )}...${addressToCheck.slice(-4)}\`**\n\n`;
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

bot.onInteractionResponse(async (handler, event) => {
  const { response, channelId, userId } = event;

  // Only handle transaction responses
  if (response.payload.content?.case !== "transaction") {
    return;
  }

  const txResponse = response.payload.content.value;
  const requestId = txResponse.requestId;

  // Check if this is a commit transaction
  if (requestId.startsWith("commit-")) {
    const commitment = pendingCommitments.get(requestId);

    if (!commitment) {
      console.error(`No commitment found for ID: ${requestId}`);
      return;
    }

    // Check if the transaction was successful
    if (txResponse.txHash) {
      // Store the transaction hash
      commitment.commitTxHash = txResponse.txHash;
      pendingCommitments.set(requestId, commitment);

      await handler.sendMessage(
        channelId,
        `✅ **Commit transaction confirmed!**\n\n` +
          `Transaction: [View on Etherscan](https://etherscan.io/tx/${txResponse.txHash})\n\n` +
          `⏳ **Waiting 60 seconds before next step...**\n` +
          `This is required by ENS to prevent front-running attacks.`
      );

      // Wait 60 seconds, then send the register transaction request
      setTimeout(async () => {
        try {
          // Recalculate cost to ensure it hasn't changed
          const { totalWei, totalEth } = await calculateRegistrationCost(
            commitment.label,
            Number(commitment.duration / BigInt(31557600))
          );

          // Prepare register transaction data
          const registerData = encodeFunctionData({
            abi: CONTROLLER_ABI,
            functionName: "register",
            args: [
              commitment.label,
              commitment.owner,
              commitment.duration,
              commitment.secret,
              "0x0000000000000000000000000000000000000000" as `0x${string}`, // resolver
              [] as `0x${string}`[], // data
              true, // reverseRecord
              0, // ownerControlledFuses
            ],
          });

          // Create register request ID
          const registerRequestId = requestId.replace("commit-", "register-");

          await handler.sendMessage(
            channelId,
            `⏰ **60 seconds have passed!**\n\n` +
              `🔐 **Step 2/2: Final registration transaction**\n` +
              `Please approve the registration transaction to complete the process.\n\n` +
              `💰 **Amount to pay:** ${totalEth} ETH`
          );

          // Send register transaction interaction request
          await handler.sendInteractionRequest(
            channelId,
            {
              case: "transaction",
              value: {
                id: registerRequestId,
                title: `Register ${commitment.domain}`,
                content: {
                  case: "evm",
                  value: {
                    chainId: REGISTRATION.CHAIN_ID,
                    to: ENS_CONFIG.REGISTRAR_CONTROLLER,
                    value: totalWei.toString(),
                    data: registerData,
                    signerWallet: undefined,
                  },
                },
              },
            },
            hexToBytes(userId as `0x${string}`)
          );
        } catch (error) {
          console.error("Error sending register transaction:", error);
          await handler.sendMessage(
            channelId,
            `❌ An error occurred while preparing the registration transaction. Please try again with a new \`/register\` command.`
          );
          pendingCommitments.delete(requestId);
        }
      }, REGISTRATION.MIN_COMMITMENT_AGE * 1000);
    } else {
      // Transaction was rejected or failed
      await handler.sendMessage(
        channelId,
        `❌ Commit transaction was not confirmed. Registration cancelled.`
      );
      pendingCommitments.delete(requestId);
    }
  }
  // Check if this is a register transaction
  else if (requestId.startsWith("register-")) {
    const commitRequestId = requestId.replace("register-", "commit-");
    const commitment = pendingCommitments.get(commitRequestId);

    if (!commitment) {
      console.error(`No commitment found for ID: ${commitRequestId}`);
      return;
    }

    // Check if the transaction was successful
    if (txResponse.txHash) {
      await handler.sendMessage(
        channelId,
        `🎉 **Registration successful!**\n\n` +
          `**${commitment.domain}** is now registered to your wallet!\n\n` +
          `📋 **Details:**\n` +
          `• Owner: \`${commitment.owner}\`\n` +
          `• Registration Tx: [View on Etherscan](https://etherscan.io/tx/${txResponse.txHash})\n` +
          `• Commitment Tx: [View on Etherscan](https://etherscan.io/tx/${commitment.commitTxHash})\n\n` +
          `✨ Your domain will be active shortly. Use \`/expiry ${commitment.label}\` to check details.`
      );

      // Clean up the commitment
      pendingCommitments.delete(commitRequestId);
    } else {
      // Transaction was rejected or failed
      await handler.sendMessage(
        channelId,
        `❌ Registration transaction was not confirmed.\n\n` +
          `The commitment is still valid for 24 hours. You can try again with the same domain.`
      );
    }
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
