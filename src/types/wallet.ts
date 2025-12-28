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
