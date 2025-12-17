import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

// ETHRegistrarController on Ethereum mainnet
const CONTROLLER_ADDRESS = "0x253553366Da8546fC250F225fe3d25d0C782303b";

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL;

if (!MAINNET_RPC_URL) {
  throw new Error("MAINNET_RPC_URL environment variable is required");
}

const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC_URL),
});

export interface ENSAvailabilityResult {
  available: boolean;
  valid: boolean;
  reason?: string;
}

export async function checkAvailability(
  domainName: string
): Promise<ENSAvailabilityResult> {
  try {
    // Remove .eth if user included it
    const label = domainName.replace(".eth", "");

    // Normalize the name (handles Unicode, etc.)
    const normalizedLabel = normalize(label);

    // Check if name is valid length (3+ characters typically)
    if (normalizedLabel.length < 3) {
      return {
        available: false,
        valid: false,
        reason: "Name must be at least 3 characters",
      };
    }

    // Query the controller's available() function
    const isAvailable = await ethereumClient.readContract({
      address: CONTROLLER_ADDRESS,
      abi: [
        {
          name: "available",
          type: "function",
          stateMutability: "view",
          inputs: [{ name: "name", type: "string" }],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "available",
      args: [normalizedLabel],
    });

    return {
      available: isAvailable,
      valid: true,
      reason: isAvailable ? "Available for registration" : "Already registered",
    };
  } catch (error) {
    console.error("Error checking availability:", error);
    return {
      available: false,
      valid: false,
      reason: "Error checking availability",
    };
  }
}
