import { readContract } from "viem/actions";
import { formatEther, type PublicClient } from "viem";
import walletLinkAbi from "@towns-protocol/generated/dev/abis/WalletLink.abi";
import { getBalance } from "./ens";
import type { WalletInfo, RecommendedWallet } from "../types/wallet";

/**
 * Get all linked wallets for a user from the WalletLink contract
 * @param bot - Towns bot instance
 * @param userId - User ID (root key)
 * @returns Array of linked wallet addresses
 */
export async function getLinkedWallets(
  bot: any,
  userId: `0x${string}`
): Promise<`0x${string}`[]> {
  try {
    const walletLinkAddress =
      bot.client.config.base.chainConfig.addresses.spaceFactory;

    const linkedWallets = (await readContract(bot.viem, {
      address: walletLinkAddress as `0x${string}`,
      abi: walletLinkAbi,
      functionName: "getWalletsByRootKey",
      args: [userId],
    })) as `0x${string}`[];

    return linkedWallets || [];
  } catch (error) {
    console.error("Error fetching linked wallets:", error);
    return [];
  }
}

/**
 * Check if an address is a smart account (has bytecode) or an EOA
 * @param address - Address to check
 * @param client - Viem public client
 * @returns True if smart account, false if EOA
 */
export async function isSmartAccount(
  address: `0x${string}`,
  client: any
): Promise<boolean> {
  try {
    const code = await client.getBytecode({ address });
    // If bytecode exists and is not '0x', it's a smart account
    return code !== undefined && code !== "0x";
  } catch (error) {
    console.error(`Error checking bytecode for ${address}:`, error);
    // Assume EOA on error
    return false;
  }
}

/**
 * Filter wallet addresses to get only EOAs (not smart accounts)
 * @param wallets - Array of wallet addresses
 * @param client - Viem public client
 * @returns Array of EOA addresses
 */
export async function filterEOAs(
  wallets: `0x${string}`[],
  client: any
): Promise<`0x${string}`[]> {
  const eoaChecks = await Promise.all(
    wallets.map(async (wallet) => ({
      wallet,
      isEOA: !(await isSmartAccount(wallet, client)),
    }))
  );

  return eoaChecks.filter((check) => check.isEOA).map((check) => check.wallet);
}

/**
 * Get comprehensive balance information for a wallet
 * @param wallet - Wallet address
 * @param mainnetClient - Mainnet public client
 * @param baseClient - Base public client
 * @returns WalletInfo with balance data
 */
export async function getWalletBalances(
  wallet: `0x${string}`,
  mainnetClient: any,
  baseClient: any
): Promise<WalletInfo> {
  const [mainnetBalance, baseBalance, isEOA] = await Promise.all([
    getBalance(mainnetClient, wallet),
    getBalance(baseClient, wallet),
    isSmartAccount(wallet, baseClient).then((isSmart) => !isSmart),
  ]);

  return {
    address: wallet,
    isEOA,
    balances: {
      mainnet: mainnetBalance,
      base: baseBalance,
    },
  };
}

/**
 * Smart algorithm to recommend the best wallet based on balances
 * @param walletsWithBalances - Array of WalletInfo with balance data
 * @param requiredMainnetAmount - Amount needed on Mainnet
 * @param bridgeFee - Estimated bridge fee
 * @returns Recommended wallet with reasoning
 */
export function recommendWallet(
  walletsWithBalances: WalletInfo[],
  requiredMainnetAmount: bigint,
  bridgeFee: bigint = 0n
): RecommendedWallet | null {
  // Only consider EOAs
  const eoaWallets = walletsWithBalances.filter((w) => w.isEOA);

  if (eoaWallets.length === 0) {
    return null;
  }

  // Path A: Check if any EOA has sufficient Mainnet funds
  const mainnetReady = eoaWallets.find(
    (w) => w.balances.mainnet >= requiredMainnetAmount
  );

  if (mainnetReady) {
    return {
      address: mainnetReady.address,
      reason: `Has ${formatEther(mainnetReady.balances.mainnet)} ETH on Mainnet (sufficient for direct registration)`,
      path: "A",
      estimatedCost: requiredMainnetAmount,
    };
  }

  // Path B: Check if any EOA has sufficient Base funds for bridging
  const totalNeededOnBase = requiredMainnetAmount + bridgeFee;
  const baseReady = eoaWallets.find(
    (w) => w.balances.base >= totalNeededOnBase
  );

  if (baseReady) {
    return {
      address: baseReady.address,
      reason: `Has ${formatEther(baseReady.balances.base)} ETH on Base (sufficient for bridging to Mainnet)`,
      path: "B",
      estimatedCost: totalNeededOnBase,
    };
  }

  // Path C: Check if smart account + EOA combination works
  const smartAccounts = walletsWithBalances.filter((w) => !w.isEOA);
  const smartAccountWithFunds = smartAccounts.find(
    (w) => w.balances.base >= totalNeededOnBase
  );

  if (smartAccountWithFunds && eoaWallets.length > 0) {
    // Recommend the first EOA (as recipient of smart account transfer)
    return {
      address: eoaWallets[0].address,
      reason: `Your smart account has ${formatEther(smartAccountWithFunds.balances.base)} ETH on Base. Will transfer to this EOA, then bridge to Mainnet.`,
      path: "C",
      estimatedCost: totalNeededOnBase,
    };
  }

  // No sufficient funds anywhere
  return null;
}

/**
 * Extract the signer address from a transaction hash
 * @param txHash - Transaction hash
 * @param client - Public client for the chain where tx was executed
 * @returns The address that signed the transaction
 */
export async function getSignerFromTxHash(
  txHash: `0x${string}`,
  client: any
): Promise<`0x${string}` | null> {
  try {
    const tx = await client.getTransaction({ hash: txHash });

    if (!tx) {
      console.error(`Transaction ${txHash} not found`);
      return null;
    }

    // The 'from' field is the address that signed the transaction
    return tx.from;
  } catch (error) {
    console.error("Error fetching transaction:", error);
    return null;
  }
}

/**
 * Format wallet info for display
 * @param wallet - WalletInfo object
 * @returns Formatted string for display
 */
export function formatWalletDisplay(wallet: WalletInfo): string {
  const shortAddr = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
  const type = wallet.isEOA ? "EOA" : "Smart Account";
  const mainnetEth = formatEther(wallet.balances.mainnet);
  const baseEth = formatEther(wallet.balances.base);

  return (
    `${type}: \`${shortAddr}\`\n` +
    `  • Mainnet: ${mainnetEth} ETH\n` +
    `  • Base: ${baseEth} ETH`
  );
}
