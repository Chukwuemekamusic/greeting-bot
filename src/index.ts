import { makeTownsBot, getSmartAccountFromUserId } from "@towns-protocol/bot";
import { hexToBytes, formatEther } from "viem";
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
  prepareDomainTransfer,
} from "./services/ens";
import { prepareSubdomainAssignment } from "./services/subdomain";
import {
  checkAvailabilitySepolia,
  generateRegistrationParamsSepolia,
  makeCommitmentSepolia,
  calculateRegistrationCostSepolia,
} from "./services/ens-sepolia";
import { normalizeENSName, isValidEOAAddress, getBalance } from "./utils/ens";
import {
  getLinkedWallets,
  filterEOAs,
  getWalletBalances,
  formatWalletDisplay,
  getWalletCapability,
  determinePathForWallet,
  formatWalletOption,
} from "./utils/wallets";
import {
  ENS_CONFIG,
  SEPOLIA_ENS_CONFIG,
  CONTROLLER_ABI,
  BASE_REGISTRAR_ABI,
  ENS_REGISTRY_ABI,
  ENS_RESOLVER_ABI,
  REGISTRATION,
  ENS_VALIDATION,
} from "./constants/ens";
import type { CommitmentState } from "./types/ens";
import type { SubdomainAssignmentState } from "./types/subdomain";

import {
  getBridgeQuote,
  calculateRequiredMainnetETH,
  prepareBridgeTransactionEOA,
} from "./services/bridge";

import { CHAIN_IDS } from "./constants/bridge";
import type { BridgeState } from "./types/bridge";
import type {
  PendingWalletSelection,
  PendingTestSelection,
} from "./types/wallet";

// In-memory store for pending commitments
const pendingCommitments = new Map<string, CommitmentState>();

// In-memory store for pending bridges
const pendingBridges = new Map<string, BridgeState>();

// In-memory store for pending wallet selections
const pendingWalletSelections = new Map<string, PendingWalletSelection>();

// In-memory store for pending test selections
const pendingTestSelections = new Map<string, PendingTestSelection>();

// In-memory store for pending subdomain assignments
const pendingSubdomainAssignments = new Map<string, SubdomainAssignmentState>();

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
      "• `/register <domain> [years]` - Register an ENS domain on mainnet (you pay gas)\n" +
      "• `/test_register <domain> [years]` - Test ENS registration on Sepolia testnet 🧪\n" +
      "• `/test_transfer <domain> <recipient>` - Transfer ENS domain on Sepolia testnet 🧪\n" +
      "• `/bridge_register <domain> [years]` - Register an ENS domain on mainnet (bridge + gas) 🧪\n" +
      "• `/test_wallet_pick` - Test wallet selection with all linked wallets 🧪\n" +
      "• `/assign_subdomain <subdomain.domain.eth> <recipient>` - Assign a subdomain to an address\n\n" +
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
  "test_register",
  async (handler, { channelId, args, userId }) => {
    if (!args || args.length === 0) {
      await handler.sendMessage(
        channelId,
        "⚠️ Please provide a domain name to register.\n\nUsage: `/test_register <domain> [years]`\n\nExample: `/test_register myname` (1 year)\nExample: `/test_register myname 2` (2 years)\n\n⚠️ **Note:** This uses Sepolia testnet!"
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
        "⚠️ Invalid duration. Please specify 1-10 years.\n\nExample: `/test_register myname 2`"
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
      `🧪 **Testing on Sepolia testnet**\n\nChecking availability for **${fullName}**...`
    );

    try {
      // Check availability on Sepolia
      const availability = await checkAvailabilitySepolia(normalized);

      if (!availability.available) {
        await handler.sendMessage(
          channelId,
          `❌ **${fullName}** is not available for registration on Sepolia.${
            availability.reason ? `\n\nReason: ${availability.reason}` : ""
          }`
        );
        return;
      }

      // Calculate registration cost
      const { totalEth } = await calculateRegistrationCostSepolia(
        normalized,
        yearsArg
      );

      // Get user's wallet address
      const userWallet = (await getSmartAccountFromUserId(bot, {
        userId,
      })) as `0x${string}`;

      // Generate registration parameters for Sepolia
      const params = generateRegistrationParamsSepolia(
        normalized,
        userWallet,
        yearsArg
      );

      // Generate commitment hash
      const commitmentHash = await makeCommitmentSepolia(params);

      // Create commitment ID (using channelId + userId + domain for uniqueness)
      const commitmentId = `testcommit-${channelId}-${userId}-${normalized}`;

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
        `✅ **${fullName}** is available on Sepolia!\n\n` +
          `📋 **Registration Details:**\n` +
          `• Network: Sepolia Testnet\n` +
          `• Duration: ${yearsArg} year${yearsArg > 1 ? "s" : ""}\n` +
          `• Cost: ${totalEth} SepoliaETH\n` +
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

      // Send commit transaction interaction request (Sepolia chainId is "11155111")
      await handler.sendInteractionRequest(
        channelId,
        {
          case: "transaction",
          value: {
            id: commitmentId,
            title: `Commit ENS Registration: ${fullName} (Sepolia)`,
            content: {
              case: "evm",
              value: {
                chainId: "11155111", // Sepolia chainId
                to: SEPOLIA_ENS_CONFIG.REGISTRAR_CONTROLLER,
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
          `After confirmation, you'll need to wait 60 seconds before completing the registration.\n\n` +
          `⚠️ **Make sure you're connected to Sepolia testnet!**`
      );
    } catch (error) {
      console.error("Error initiating test registration:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while initiating registration on Sepolia. Please try again later."
      );
    }
  }
);

bot.onSlashCommand(
  "test_transfer",
  async (handler, { channelId, args, userId }) => {
    if (!args || args.length < 2) {
      await handler.sendMessage(
        channelId,
        "⚠️ Please provide domain name and recipient address.\n\n" +
          "Usage: `/test_transfer <domain> <recipient>`\n\n" +
          "Examples:\n" +
          "• `/test_transfer myname 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`\n" +
          "• `/test_transfer myname vitalik.eth`\n\n" +
          "⚠️ **Note:** This uses Sepolia testnet!"
      );
      return;
    }

    const domainArg = args[0];
    const recipientArg = args[1];

    await handler.sendMessage(
      channelId,
      `🧪 **Testing on Sepolia testnet**\n\nPreparing to transfer **${domainArg}.eth**...`
    );

    try {
      // Get user's wallet address
      const userWallet = (await getSmartAccountFromUserId(bot, {
        userId,
      })) as `0x${string}`;

      // Prepare and validate the transfer
      const prepareResult = await prepareDomainTransfer(
        domainArg,
        userWallet,
        recipientArg,
        true // isSepolia
      );

      if (!prepareResult.success) {
        await handler.sendMessage(
          channelId,
          `❌ **Transfer failed**\n\n${prepareResult.reason}`
        );
        return;
      }

      const { fullName, tokenId, resolvedRecipient } = prepareResult;

      // Format recipient for display
      const recipientDisplay =
        recipientArg === resolvedRecipient
          ? resolvedRecipient
          : `${recipientArg} (${resolvedRecipient.slice(
              0,
              8
            )}...${resolvedRecipient.slice(-6)})`;

      // Prepare transfer transaction data
      const transferData = encodeFunctionData({
        abi: BASE_REGISTRAR_ABI,
        functionName: "safeTransferFrom",
        args: [userWallet, resolvedRecipient, tokenId],
      });

      // Create transfer request ID
      const transferId = `testtransfer-${channelId}-${userId}-${prepareResult.label}`;

      // Send confirmation message
      await handler.sendMessage(
        channelId,
        `✅ **Transfer validation passed!**\n\n` +
          `📋 **Transfer Details:**\n` +
          `• Network: Sepolia Testnet\n` +
          `• Domain: **${fullName}**\n` +
          `• From: \`${userWallet.slice(0, 8)}...${userWallet.slice(-6)}\`\n` +
          `• To: \`${recipientDisplay}\`\n\n` +
          `🔐 **Sending transfer request...**`
      );

      // Send transfer transaction interaction request
      await handler.sendInteractionRequest(
        channelId,
        {
          case: "transaction",
          value: {
            id: transferId,
            title: `Transfer ${fullName} (Sepolia)`,
            content: {
              case: "evm",
              value: {
                chainId: "11155111", // Sepolia chainId
                to: SEPOLIA_ENS_CONFIG.BASE_REGISTRAR,
                value: "0",
                data: transferData,
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
          `Please approve the transfer in your wallet.\n\n` +
          `⚠️ **Make sure you're connected to Sepolia testnet!**`
      );
    } catch (error) {
      console.error("Error initiating test transfer:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while initiating transfer on Sepolia. Please try again later."
      );
    }
  }
);

bot.onSlashCommand(
  "bridge_register",
  async (handler, { channelId, args, userId }) => {
    if (!args || args.length === 0) {
      await handler.sendMessage(
        channelId,
        "⚠️ Please provide a domain name to register.\n\nUsage: `/bridge_register <domain> [years]`\n\nExample: `/bridge_register myname` (1 year)\nExample: `/bridge_register myname 2` (2 years)\n\n✨ Your linked wallets will be detected automatically!"
      );
      return;
    }

    // Parse arguments (no EOA address needed anymore!)
    const domainArg = args[0];
    const yearsArg = args[1] ? parseInt(args[1]) : 1;

    // Validate years
    if (isNaN(yearsArg) || yearsArg < 1 || yearsArg > 10) {
      await handler.sendMessage(
        channelId,
        "⚠️ Invalid duration. Please specify 1-10 years.\n\nExample: `/bridge_register myname 2`"
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

    // Check minimum length requirement
    if (normalized.length < ENS_VALIDATION.MIN_LENGTH) {
      await handler.sendMessage(
        channelId,
        `⚠️ **Domain too short**\n\n` +
          `ENS domains must be at least ${ENS_VALIDATION.MIN_LENGTH} characters long.\n` +
          `**${normalized}** is only ${normalized.length} character${
            normalized.length === 1 ? "" : "s"
          }.`
      );
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
      const { totalWei } = await calculateRegistrationCost(
        normalized,
        yearsArg
      );

      // Calculate total ETH needed on Mainnet (registration + gas + buffer)
      const requiredMainnetETH = calculateRequiredMainnetETH(totalWei);

      // === STEP 1: AUTO-DETECT LINKED WALLETS ===
      await handler.sendMessage(
        channelId,
        `🔍 Detecting your linked wallets...`
      );

      const linkedWallets = await getLinkedWallets(
        bot,
        userId as `0x${string}`
      );

      if (!linkedWallets || linkedWallets.length === 0) {
        await handler.sendMessage(
          channelId,
          `⚠️ **No linked wallets found**\n\n` +
            `Please link an EOA wallet to your account:\n` +
            `1. Go to Towns settings\n` +
            `2. Link your MetaMask/Coinbase wallet\n` +
            `3. Try again\n\n` +
            `Smart accounts alone cannot be used for cross-chain operations.`
        );
        return;
      }

      // Create clients for balance checking
      const { createPublicClient, http } = await import("viem");
      const { mainnet, base } = await import("viem/chains");

      const mainnetClient = createPublicClient({
        chain: mainnet,
        transport: http(process.env.MAINNET_RPC_URL),
      });

      const baseClient = createPublicClient({
        chain: base,
        transport: http(`https://mainnet.base.org`),
      });

      // Filter to get only EOAs
      await handler.sendMessage(
        channelId,
        `🔍 Analyzing wallet types and balances...`
      );

      const eoaWallets = await filterEOAs(linkedWallets, baseClient);

      if (eoaWallets.length === 0) {
        await handler.sendMessage(
          channelId,
          `⚠️ **No EOA wallets found**\n\n` +
            `You have ${linkedWallets.length} linked wallet(s), but they are all smart accounts.\n\n` +
            `Please link an EOA wallet (MetaMask, Coinbase, etc.) to use this feature.`
        );
        return;
      }

      // Get balance information for all wallets
      const allWalletsWithBalances = await Promise.all(
        linkedWallets.map((wallet) =>
          getWalletBalances(wallet, mainnetClient, baseClient)
        )
      );

      // Get bridge quote to calculate total needed
      const bridgeQuote = await getBridgeQuote(
        requiredMainnetETH,
        CHAIN_IDS.BASE,
        CHAIN_IDS.MAINNET
      );

      const bridgeFee = BigInt(bridgeQuote.totalRelayFee.total || "0");

      // Filter wallets to get only capable EOAs with sufficient funds
      const capableWallets = allWalletsWithBalances
        .filter((w) => w.isEOA) // Only EOAs
        .map((w) => ({
          wallet: w,
          capability: getWalletCapability(w, requiredMainnetETH, bridgeFee),
        }))
        .filter((wc) => wc.capability.recommendedPath !== null); // Only wallets with a valid path

      if (capableWallets.length === 0) {
        // No wallet has sufficient funds
        await handler.sendMessage(
          channelId,
          `❌ **No capable wallets found**\n\n` +
            `**Required:** ${formatEther(
              requiredMainnetETH
            )} ETH on Mainnet OR ${formatEther(
              requiredMainnetETH + bridgeFee
            )} ETH on Base\n\n` +
            `**Your Wallets:**\n` +
            allWalletsWithBalances.map(formatWalletDisplay).join("\n\n") +
            `\n\n**To proceed, you need:**\n` +
            `• Option A: ${formatEther(
              requiredMainnetETH
            )} ETH on Mainnet (direct registration)\n` +
            `• Option B: ${formatEther(
              requiredMainnetETH + bridgeFee
            )} ETH on Base (bridge then register)\n\n` +
            `Please fund one of your EOA wallets and try again.`
        );
        return;
      }

      // Create interactive wallet selection form
      const selectionId = `wallet-select-${channelId}-${userId}-${Date.now()}`;

      // Store selection state
      pendingWalletSelections.set(selectionId, {
        userId,
        channelId,
        domain: fullName,
        label: normalized,
        years: yearsArg,
        allWallets: capableWallets.map((wc) => wc.wallet),
        requiredMainnetAmount: requiredMainnetETH,
        bridgeFee,
        timestamp: Date.now(),
      });

      // Build form components - dropdown with wallet options
      const walletOptions = capableWallets.map((wc) => ({
        id: wc.wallet.address,
        component: {
          case: "button" as const,
          value: {
            label: formatWalletOption(wc.wallet, wc.capability),
          },
        },
      }));

      // Show wallet selection form
      await handler.sendMessage(
        channelId,
        `✅ **Wallet Analysis Complete!**\n\n` +
          `Found ${capableWallets.length} capable EOA wallet(s) for registration.\n\n` +
          `**Domain:** ${fullName}\n` +
          `**Duration:** ${yearsArg} year${yearsArg > 1 ? "s" : ""}\n` +
          `**Cost:** ${formatEther(totalWei)} ETH\n\n` +
          `Please select which wallet to use:`
      );

      // Send interactive form
      await handler.sendInteractionRequest(
        channelId,
        {
          case: "form",
          value: {
            id: selectionId,
            title: "Select Wallet for Registration",
            components: walletOptions,
          },
        },
        hexToBytes(userId as `0x${string}`)
      );

      return;
    } catch (error) {
      console.error("Error initiating registration:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while initiating registration. Please try again later."
      );
    }
  }
);

// ===== TEST WALLET PICK COMMAND =====
bot.onSlashCommand(
  "test_wallet_pick",
  async (handler, { channelId, userId }) => {
    try {
      await handler.sendMessage(
        channelId,
        `🔍 Detecting your linked wallets...`
      );

      // Get all linked wallets (no filtering - include smart accounts)
      const linkedWallets = await getLinkedWallets(
        bot,
        userId as `0x${string}`
      );

      if (!linkedWallets || linkedWallets.length === 0) {
        await handler.sendMessage(
          channelId,
          `⚠️ **No linked wallets found**\n\n` +
            `Please link a wallet to your account in Towns settings.`
        );
        return;
      }

      // Create clients for balance checking
      const { createPublicClient, http } = await import("viem");
      const { mainnet, base } = await import("viem/chains");

      const mainnetClient = createPublicClient({
        chain: mainnet,
        transport: http(process.env.MAINNET_RPC_URL),
      });

      const baseClient = createPublicClient({
        chain: base,
        transport: http(`https://mainnet.base.org`),
      });

      // Get balance information for ALL wallets (including smart accounts)
      await handler.sendMessage(
        channelId,
        `🔍 Analyzing wallet types and balances...`
      );

      const allWalletsWithBalances = await Promise.all(
        linkedWallets.map((wallet) =>
          getWalletBalances(wallet, mainnetClient, baseClient)
        )
      );

      // Create interactive wallet selection form
      const selectionId = `test-wallet-pick-${channelId}-${userId}-${Date.now()}`;

      // Store selection state
      pendingTestSelections.set(selectionId, {
        userId,
        channelId,
        allWallets: allWalletsWithBalances,
        timestamp: Date.now(),
      });

      // Build form components - buttons for all wallets
      const walletOptions = allWalletsWithBalances.map((wallet) => {
        const shortAddr = `${wallet.address.slice(
          0,
          6
        )}...${wallet.address.slice(-4)}`;
        const type = wallet.isEOA ? "EOA" : "Smart Account";
        const mainnetEth = formatEther(wallet.balances.mainnet);
        const baseEth = formatEther(wallet.balances.base);

        return {
          id: wallet.address,
          component: {
            case: "button" as const,
            value: {
              label: `${shortAddr} (${type}) - M: ${mainnetEth} / B: ${baseEth}`,
            },
          },
        };
      });

      // Show wallet selection form
      await handler.sendMessage(
        channelId,
        `✅ **Wallet Detection Complete!**\n\n` +
          `Found ${allWalletsWithBalances.length} linked wallet(s).\n\n` +
          `**Your Wallets:**\n` +
          allWalletsWithBalances.map(formatWalletDisplay).join("\n\n") +
          `\n\n**Select a wallet to test with:**`
      );

      // Send interactive form
      await handler.sendInteractionRequest(
        channelId,
        {
          case: "form",
          value: {
            id: selectionId,
            title: "Select Wallet for Test",
            components: walletOptions,
          },
        },
        hexToBytes(userId as `0x${string}`)
      );
    } catch (error) {
      console.error("Error in test_wallet_pick:", error);
      await handler.sendMessage(
        channelId,
        "❌ An error occurred while detecting wallets. Please try again later."
      );
    }
  }
);

// ===== ASSIGN SUBDOMAIN COMMAND =====
bot.onSlashCommand(
  "assign_subdomain",
  async (handler, { channelId, args, userId }) => {
    try {
      // Step 1: Validate arguments
      if (!args || args.length < 2) {
        await handler.sendMessage(
          channelId,
          "❌ **Invalid usage**\n\n" +
            "**Syntax:** `/assign_subdomain <subdomain.domain.eth> <recipient>`\n\n" +
            "**Example:** `/assign_subdomain alice.mydomain.eth vitalik.eth`\n" +
            "**Example:** `/assign_subdomain alice.mydomain.eth 0x1234...5678`"
        );
        return;
      }

      const subdomainInput = args[0];
      const recipientInput = args[1];

      await handler.sendMessage(
        channelId,
        `🔍 **Preparing subdomain assignment...**\n\n` +
          `• Subdomain: **${subdomainInput}**\n` +
          `• Recipient: **${recipientInput}**`
      );

      // Step 2: Prepare and validate the subdomain assignment
      const prepareResult = await prepareSubdomainAssignment(
        subdomainInput,
        recipientInput,
        bot,
        userId as `0x${string}`
      );

      if (!prepareResult.success) {
        await handler.sendMessage(
          channelId,
          `❌ **Validation Failed**\n\n${prepareResult.reason}`
        );
        return;
      }

      const {
        fullName,
        subdomain,
        domain,
        parentNode,
        subdomainNode,
        labelHash,
        recipient,
        ownerWallet,
      } = prepareResult;

      // Step 3: Display validation success
      await handler.sendMessage(
        channelId,
        `✅ **Validation Passed!**\n\n` +
          `• Subdomain: **${fullName}**\n` +
          `• Parent Domain: **${domain}.eth**\n` +
          `• Owner Wallet: \`${ownerWallet!.slice(0, 6)}...${ownerWallet!.slice(
            -4
          )}\`\n` +
          `• Recipient: \`${recipient!.slice(0, 6)}...${recipient!.slice(
            -4
          )}\`\n\n` +
          `📝 **Setup Process:**\n` +
          `This will create a fully configured subdomain in **one atomic transaction**:\n` +
          `• Create subdomain and set owner\n` +
          `• Set ENS Public Resolver\n` +
          `• Point subdomain to recipient's address\n\n` +
          `🔐 **Preparing transaction...**`
      );

      // Step 4: Prepare transaction data
      // Using setSubnodeRecord to set owner + resolver in one atomic call
      const setSubnodeRecordData = encodeFunctionData({
        abi: ENS_REGISTRY_ABI,
        functionName: "setSubnodeRecord",
        args: [parentNode!, labelHash!, recipient!, ENS_CONFIG.PUBLIC_RESOLVER, 0n],
      });

      // Step 5: Create state for tracking single transaction
      const assignmentId = `subdomain-${channelId}-${Date.now()}`;

      pendingSubdomainAssignments.set(assignmentId, {
        userId,
        channelId,
        subdomain: subdomain!,
        domain: domain!,
        fullName: fullName!,
        recipient: recipient!,
        ownerWallet: ownerWallet!,
        timestamp: Date.now(),
      });

      // Step 6: Send single transaction request with setSubnodeRecord
      await handler.sendInteractionRequest(
        channelId,
        {
          case: "transaction",
          value: {
            id: assignmentId,
            title: `Assign ${fullName}`,
            content: {
              case: "evm",
              value: {
                chainId: REGISTRATION.CHAIN_ID, // Mainnet
                to: ENS_CONFIG.ENS_REGISTRY,
                value: "0",
                data: setSubnodeRecordData,
                signerWallet: ownerWallet, // The EOA wallet that owns the parent domain
              },
            },
          },
        },
        hexToBytes(userId as `0x${string}`)
      );

      await handler.sendMessage(
        channelId,
        `📤 **Transaction sent!**\n\n` +
          `Please approve the transaction to create and configure the subdomain.\n\n` +
          `This will set up **${fullName}** with:\n` +
          `• Owner: Recipient\n` +
          `• Resolver: ENS Public Resolver\n` +
          `• Ready for address configuration`
      );
    } catch (error) {
      console.error("Error in assign_subdomain:", error);
      await handler.sendMessage(
        channelId,
        "❌ An unexpected error occurred. Please try again later."
      );
    }
  }
);

// ===== WALLET SELECTION INTERACTION HANDLER =====
bot.onInteractionResponse(async (handler, event) => {
  const response = event.response;

  if (response.payload.content?.case !== "form") {
    return;
  }

  const formResponse = response.payload.content.value;
  const requestId = formResponse.requestId;

  // ===== HANDLE TEST WALLET PICK =====
  if (requestId.startsWith("test-wallet-pick-")) {
    const selection = pendingTestSelections.get(requestId);
    if (!selection) {
      await handler.sendMessage(
        event.channelId,
        "⚠️ Selection expired. Please run `/test_wallet_pick` again."
      );
      return;
    }

    // Extract selected wallet address from button click
    let selectedAddress: `0x${string}` | null = null;

    for (const component of formResponse.components) {
      if (component.component.case === "button") {
        selectedAddress = component.id as `0x${string}`;
        break;
      }
    }

    if (!selectedAddress) {
      await handler.sendMessage(
        event.channelId,
        "⚠️ No wallet selected. Please try again."
      );
      return;
    }

    // Find the selected wallet info
    const selectedWallet = selection.allWallets.find(
      (w) => w.address === selectedAddress
    );

    if (!selectedWallet) {
      await handler.sendMessage(
        event.channelId,
        "⚠️ Invalid wallet selection. Please try again."
      );
      return;
    }

    // Clean up pending selection
    pendingTestSelections.delete(requestId);

    // Show confirmation
    const shortAddr = `${selectedAddress.slice(0, 6)}...${selectedAddress.slice(
      -4
    )}`;
    const walletType = selectedWallet.isEOA ? "EOA" : "Smart Account";

    await handler.sendMessage(
      event.channelId,
      `✅ **Wallet Selected!**\n\n` +
        `**Address:** \`${shortAddr}\`\n` +
        `**Type:** ${walletType}\n` +
        `**Mainnet Balance:** ${formatEther(
          selectedWallet.balances.mainnet
        )} ETH\n` +
        `**Base Balance:** ${formatEther(
          selectedWallet.balances.base
        )} ETH\n\n` +
        `📝 Preparing test transaction...`
    );

    // Send zero-value test transaction
    try {
      const testTxId = `test-tx-${event.channelId}-${Date.now()}`;

      await handler.sendInteractionRequest(
        event.channelId,
        {
          case: "transaction",
          value: {
            id: testTxId,
            title: "Test Transaction (Zero Value)",
            content: {
              case: "evm",
              value: {
                chainId: "8453", // Base
                to: selectedAddress, // Send to self
                value: "0", // Zero value
                data: "0x", // No data
                signerWallet: selectedAddress, // Selected wallet signs
              },
            },
          },
        },
        hexToBytes(selection.userId as `0x${string}`)
      );

      await handler.sendMessage(
        event.channelId,
        `📤 **Test transaction sent!**\n\n` +
          `Please approve the transaction from your selected wallet (\`${shortAddr}\`).\n\n` +
          `This is a zero-value transaction (no ETH will be transferred).\n` +
          `You'll only pay gas fees.`
      );
    } catch (error) {
      console.error("Error sending test transaction:", error);
      await handler.sendMessage(
        event.channelId,
        "❌ An error occurred while preparing the test transaction."
      );
    }

    return;
  }

  // ===== HANDLE BRIDGE REGISTER WALLET SELECTION =====
  if (!requestId.startsWith("wallet-select-")) {
    return;
  }

  // Retrieve the pending selection
  const selection = pendingWalletSelections.get(requestId);
  if (!selection) {
    await handler.sendMessage(
      event.channelId,
      "⚠️ Selection expired. Please run `/bridge_register` again."
    );
    return;
  }

  // Extract selected wallet address from button click
  let selectedAddress: `0x${string}` | null = null;

  for (const component of formResponse.components) {
    if (component.component.case === "button") {
      // The component ID is the wallet address
      selectedAddress = component.id as `0x${string}`;
      break;
    }
  }

  if (!selectedAddress) {
    await handler.sendMessage(
      event.channelId,
      "⚠️ No wallet selected. Please try again."
    );
    return;
  }

  // Find the selected wallet
  const selectedWallet = selection.allWallets.find(
    (w) => w.address === selectedAddress
  );

  if (!selectedWallet) {
    await handler.sendMessage(
      event.channelId,
      "⚠️ Invalid wallet selection. Please try again."
    );
    return;
  }

  // Determine which path to use for this wallet
  const path = determinePathForWallet(
    selectedWallet,
    selection.requiredMainnetAmount,
    selection.bridgeFee
  );

  if (!path) {
    await handler.sendMessage(
      event.channelId,
      "⚠️ Selected wallet no longer has sufficient funds. Please try again."
    );
    return;
  }

  // Clean up pending selection
  pendingWalletSelections.delete(requestId);

  // Show confirmation
  const shortAddr = `${selectedAddress.slice(0, 6)}...${selectedAddress.slice(
    -4
  )}`;
  await handler.sendMessage(
    event.channelId,
    `✅ **Wallet Selected:** \`${shortAddr}\`\n\n` +
      `**Path:** ${path}\n` +
      `**Domain:** ${selection.domain}\n\n` +
      `Proceeding with registration...`
  );

  // Execute the selected path
  try {
    // Create clients for blockchain operations
    const { createPublicClient, http } = await import("viem");
    const { mainnet, base } = await import("viem/chains");

    const mainnetClient = createPublicClient({
      chain: mainnet,
      transport: http(process.env.MAINNET_RPC_URL),
    });

    const baseClient = createPublicClient({
      chain: base,
      transport: http(`https://mainnet.base.org`),
    });

    if (path === "A") {
      // PATH A: Direct registration from Mainnet EOA
      const mainnetBalance = await mainnetClient.getBalance({
        address: selectedAddress,
      });

      await handler.sendMessage(
        event.channelId,
        `✅ **Sufficient Mainnet balance found!**\n\n` +
          `• Your Mainnet EOA has ${formatEther(mainnetBalance)} ETH\n` +
          `• Required: ${formatEther(
            selection.requiredMainnetAmount
          )} ETH\n\n` +
          `📝 Proceeding directly with ENS registration...`
      );

      // Generate registration parameters with EOA as owner
      const params = generateRegistrationParams(
        selection.label,
        selectedAddress,
        selection.years
      );

      // Generate commitment hash
      const commitmentHash = await makeCommitment(params);

      // Create commitment ID
      const commitmentId = `commit-${event.channelId}-${selection.userId}-${selection.label}`;

      // Store commitment state
      pendingCommitments.set(commitmentId, {
        userId: selection.userId,
        channelId: event.channelId,
        domain: selection.domain,
        label: selection.label,
        commitment: commitmentHash,
        secret: params.secret,
        owner: selectedAddress,
        duration: params.duration,
        timestamp: Date.now(),
      });

      // Prepare commit transaction data
      const commitData = encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "commit",
        args: [commitmentHash],
      });

      // Send commit transaction interaction request
      await handler.sendInteractionRequest(
        event.channelId,
        {
          case: "transaction",
          value: {
            id: commitmentId,
            title: `Commit ENS Registration: ${selection.domain}`,
            content: {
              case: "evm",
              value: {
                chainId: REGISTRATION.CHAIN_ID,
                to: ENS_CONFIG.REGISTRAR_CONTROLLER,
                value: "0",
                data: commitData,
                signerWallet: selectedAddress,
              },
            },
          },
        },
        hexToBytes(selection.userId as `0x${string}`)
      );

      await handler.sendMessage(
        event.channelId,
        `📤 **Transaction request sent!**\n\n` +
          `Please approve the commit transaction from your EOA wallet.\n` +
          `After confirmation, wait 60 seconds before completing registration.`
      );
    } else if (path === "B") {
      // PATH B: Bridge from Base EOA to Mainnet EOA
      const baseBalance = await baseClient.getBalance({
        address: selectedAddress,
      });

      const outputAmount =
        selection.requiredMainnetAmount > selection.bridgeFee
          ? selection.requiredMainnetAmount - selection.bridgeFee
          : 0n;

      await handler.sendMessage(
        event.channelId,
        `✅ **Base EOA has sufficient funds!**\n\n` +
          `**Bridge Details:**\n` +
          `• From: Base EOA (${formatEther(baseBalance)} ETH)\n` +
          `• To: Mainnet EOA\n` +
          `• Amount to bridge: ${formatEther(
            selection.requiredMainnetAmount
          )} ETH\n` +
          `• Bridge fee: ~${formatEther(selection.bridgeFee)} ETH\n` +
          `• You'll receive: ~${formatEther(outputAmount)} ETH on Mainnet\n\n` +
          `📝 Preparing bridge transaction...`
      );

      // Prepare EOA-to-EOA bridge transaction
      const bridgeData = prepareBridgeTransactionEOA(
        selection.requiredMainnetAmount,
        selectedAddress, // depositor (Base EOA)
        selectedAddress, // recipient (Mainnet EOA - same address)
        outputAmount,
        CHAIN_IDS.BASE,
        CHAIN_IDS.MAINNET
      );

      // Create bridge ID
      const bridgeId = `bridge-eoa-${event.channelId}-${selection.userId}-${selection.label}`;

      // Store bridge state
      pendingBridges.set(bridgeId, {
        userId: selection.userId,
        channelId: event.channelId,
        domain: selection.domain,
        label: selection.label,
        years: selection.years,
        fromChain: CHAIN_IDS.BASE,
        toChain: CHAIN_IDS.MAINNET,
        amount: selection.requiredMainnetAmount,
        recipient: selectedAddress,
        timestamp: Date.now(),
        status: "pending",
      });

      // Send bridge transaction request
      await handler.sendInteractionRequest(
        event.channelId,
        {
          case: "transaction",
          value: {
            id: bridgeId,
            title: `Bridge ${formatEther(
              selection.requiredMainnetAmount
            )} ETH to Mainnet`,
            content: {
              case: "evm",
              value: {
                chainId: CHAIN_IDS.BASE.toString(),
                to: bridgeData.to,
                value: bridgeData.value,
                data: bridgeData.data,
                signerWallet: selectedAddress,
              },
            },
          },
        },
        hexToBytes(selection.userId as `0x${string}`)
      );

      await handler.sendMessage(
        event.channelId,
        `📤 **Bridge transaction sent!**\n\n` +
          `Please approve the bridge from your Base EOA wallet.\n` +
          `After bridging completes, I'll help you register the domain.`
      );
    }
    // Note: Path C is not supported in interactive selection as it requires smart account
  } catch (error) {
    console.error("Error executing wallet selection:", error);
    await handler.sendMessage(
      event.channelId,
      "❌ An error occurred while processing your selection. Please try again."
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

  // Check if this is a test commit transaction (Sepolia)
  if (requestId.startsWith("testcommit-")) {
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
        `✅ **Commit transaction confirmed on Sepolia!**\n\n` +
          `Transaction: [View on Sepolia Etherscan](https://sepolia.etherscan.io/tx/${txResponse.txHash})\n\n` +
          `⏳ **Waiting 60 seconds before next step...**\n` +
          `This is required by ENS to prevent front-running attacks.`
      );

      // Wait 60 seconds, then send the register transaction request
      setTimeout(async () => {
        try {
          // Recalculate cost to ensure it hasn't changed
          const { totalWei, totalEth } = await calculateRegistrationCostSepolia(
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
              SEPOLIA_ENS_CONFIG.PUBLIC_RESOLVER,
              [] as `0x${string}`[], // data
              true, // reverseRecord
              0, // ownerControlledFuses
            ],
          });

          // Create register request ID
          const registerRequestId = requestId.replace(
            "testcommit-",
            "test_register-"
          );

          await handler.sendMessage(
            channelId,
            `⏰ **60 seconds have passed!**\n\n` +
              `🔐 **Step 2/2: Final registration transaction (Sepolia)**\n` +
              `Please approve the registration transaction to complete the process.\n\n` +
              `💰 **Amount to pay:** ${totalEth} SepoliaETH`
          );

          // Send register transaction interaction request
          await handler.sendInteractionRequest(
            channelId,
            {
              case: "transaction",
              value: {
                id: registerRequestId,
                title: `Register ${commitment.domain} (Sepolia)`,
                content: {
                  case: "evm",
                  value: {
                    chainId: "11155111", // Sepolia chainId
                    to: SEPOLIA_ENS_CONFIG.REGISTRAR_CONTROLLER,
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
            `❌ An error occurred while preparing the registration transaction. Please try again with a new \`/test_register\` command.`
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
  // Check if this is a test register transaction (Sepolia)
  else if (requestId.startsWith("test_register-")) {
    const commitRequestId = requestId.replace("test_register-", "testcommit-");
    const commitment = pendingCommitments.get(commitRequestId);

    if (!commitment) {
      console.error(`No commitment found for ID: ${commitRequestId}`);
      return;
    }

    // Check if the transaction was successful
    if (txResponse.txHash) {
      await handler.sendMessage(
        channelId,
        `🎉 **Registration successful on Sepolia!**\n\n` +
          `**${commitment.domain}** is now registered to your wallet on Sepolia testnet!\n\n` +
          `📋 **Details:**\n` +
          `• Network: Sepolia Testnet\n` +
          `• Owner: \`${commitment.owner}\`\n` +
          `• Registration Tx: [View on Sepolia Etherscan](https://sepolia.etherscan.io/tx/${txResponse.txHash})\n` +
          `• Commitment Tx: [View on Sepolia Etherscan](https://sepolia.etherscan.io/tx/${commitment.commitTxHash})\n\n` +
          `✨ Your domain will be active shortly on Sepolia testnet.`
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
  // Check if this is a test transfer transaction (Sepolia)
  else if (requestId.startsWith("testtransfer-")) {
    // Extract domain label from requestId (format: testtransfer-{channelId}-{userId}-{label})
    const parts = requestId.split("-");
    const label = parts.slice(3).join("-"); // In case label has hyphens
    const fullName = `${label}.eth`;

    if (txResponse.txHash) {
      await handler.sendMessage(
        channelId,
        `🎉 **Transfer successful on Sepolia!**\n\n` +
          `**${fullName}** has been transferred!\n\n` +
          `📋 **Details:**\n` +
          `• Network: Sepolia Testnet\n` +
          `• Transaction: [View on Sepolia Etherscan](https://sepolia.etherscan.io/tx/${txResponse.txHash})\n\n` +
          `✨ The domain ownership has been updated on Sepolia testnet.`
      );
    } else {
      await handler.sendMessage(
        channelId,
        `❌ Transfer transaction was cancelled or failed.\n\n` +
          `No changes were made to **${fullName}** ownership.`
      );
    }
  }
  // Check if this is a commit transaction (Mainnet)
  else if (requestId.startsWith("commit-")) {
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
  // Check if this is a subdomain assignment transaction
  else if (requestId.startsWith("subdomain-")) {
    const state = pendingSubdomainAssignments.get(requestId);

    if (!state) {
      console.error(`No subdomain assignment found for ID: ${requestId}`);
      return;
    }

    // Handle transaction failure/cancellation
    if (!txResponse.txHash) {
      await handler.sendMessage(
        channelId,
        `❌ **Transaction cancelled**\n\n` +
          `Subdomain assignment for **${state.fullName}** has been cancelled.\n` +
          `You can try again with \`/assign_subdomain ${state.fullName} ${state.recipient}\``
      );
      pendingSubdomainAssignments.delete(requestId);
      return;
    }

    // Handle successful transaction
    await handler.sendMessage(
      channelId,
      `🎉 **Subdomain assignment complete!**\n\n` +
        `**${state.fullName}** is now configured and live!\n\n` +
        `📋 **Summary:**\n` +
        `• Subdomain: **${state.fullName}**\n` +
        `• Owner: \`${state.recipient.slice(0, 6)}...${state.recipient.slice(
          -4
        )}\`\n` +
        `• Resolver: ENS Public Resolver\n` +
        `• Transaction: [View on Etherscan](https://etherscan.io/tx/${txResponse.txHash})\n\n` +
        `✨ The subdomain is now ready! The recipient can set additional records like ETH address using the ENS app.`
    );

    // Clean up the assignment state
    pendingSubdomainAssignments.delete(requestId);
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
