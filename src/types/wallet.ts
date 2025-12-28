/**
 * Wallet information including balance data
 */
export type WalletInfo = {
  address: `0x${string}`;
  isEOA: boolean;
  balances: {
    mainnet: bigint;
    base: bigint;
  };
};

/**
 * Recommended wallet with reasoning
 */
export type RecommendedWallet = {
  address: `0x${string}`;
  reason: string;
  path: "A" | "B" | "C";
  estimatedCost: bigint;
};

/**
 * Flow path type for bridge registration
 */
export type FlowPath = "A" | "B" | "C";

/**
 * Wallet capability for a specific registration
 */
export type WalletCapability = {
  canUsePathA: boolean;
  canUsePathB: boolean;
  canUsePathC: boolean;
  recommendedPath: FlowPath | null;
  reason: string;
};

/**
 * Pending wallet selection state
 */
export type PendingWalletSelection = {
  userId: string;
  channelId: string;
  domain: string;
  label: string;
  years: number;
  allWallets: WalletInfo[];
  requiredMainnetAmount: bigint;
  bridgeFee: bigint;
  timestamp: number;
};
