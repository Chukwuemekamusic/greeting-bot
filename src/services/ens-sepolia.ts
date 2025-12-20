import { createPublicClient, http, formatEther } from "viem";
import { sepolia } from "viem/chains";
import { readContract } from "viem/actions";
import {
  SEPOLIA_ENS_CONFIG,
  TIME,
  CONTROLLER_ABI,
  BASE_REGISTRAR_ABI,
  REGISTRATION,
} from "../constants/ens";
import { normalizeENSName, getTokenId } from "../utils/ens";
import type {
  ENSAvailabilityResult,
  RegistrationParams,
} from "../types/ens";

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;

if (!SEPOLIA_RPC_URL) {
  throw new Error("SEPOLIA_RPC_URL environment variable is required");
}

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC_URL),
});

/**
 * Checks if an ENS domain is available for registration on Sepolia testnet
 */
export async function checkAvailabilitySepolia(
  domainName: string
): Promise<ENSAvailabilityResult> {
  try {
    // Normalize and validate the domain name
    const { normalized, valid, reason } = normalizeENSName(domainName);
    const fullName = `${normalized}.eth`;

    if (!valid) {
      return {
        label: normalized,
        fullName,
        available: false,
        valid: false,
        reason,
      };
    }

    // Check availability on the controller
    const isAvailable = await readContract(sepoliaClient, {
      address: SEPOLIA_ENS_CONFIG.REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "available",
      args: [normalized],
    });

    if (!isAvailable) {
      return {
        label: normalized,
        fullName,
        available: false,
        valid: true,
        reason: "Domain is already registered",
      };
    }

    // Get the price for 1 year registration
    try {
      const priceData = (await readContract(sepoliaClient, {
        address: SEPOLIA_ENS_CONFIG.REGISTRAR_CONTROLLER,
        abi: CONTROLLER_ABI,
        functionName: "rentPrice",
        args: [normalized, TIME.SECONDS_PER_YEAR],
      })) as { base: bigint; premium: bigint };

      const totalPrice = priceData.base + priceData.premium;
      const priceEth = Number(formatEther(totalPrice)).toFixed(4);

      return {
        label: normalized,
        fullName,
        available: true,
        valid: true,
        priceEth,
      };
    } catch (priceError) {
      // If price fetch fails, still return availability
      console.error("Error fetching price:", priceError);
      return {
        label: normalized,
        fullName,
        available: true,
        valid: true,
        reason: "Available (price unavailable)",
      };
    }
  } catch (error) {
    console.error("Error checking availability on Sepolia:", error);
    throw error;
  }
}

/**
 * Generates registration parameters for Sepolia ENS registration
 */
export function generateRegistrationParamsSepolia(
  domainName: string,
  ownerAddress: `0x${string}`,
  years: number = 1
): RegistrationParams {
  const { normalized } = normalizeENSName(domainName);

  // Generate a random 32-byte secret
  const secret = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("")}` as `0x${string}`;

  const duration = BigInt(years) * TIME.SECONDS_PER_YEAR;

  return {
    label: normalized,
    owner: ownerAddress,
    duration,
    secret,
    resolver: SEPOLIA_ENS_CONFIG.PUBLIC_RESOLVER,
    data: [] as `0x${string}`[],
    reverseRecord: true,
    ownerControlledFuses: 0,
  };
}

/**
 * Creates a commitment hash for Sepolia ENS registration
 */
export async function makeCommitmentSepolia(
  params: RegistrationParams
): Promise<`0x${string}`> {
  try {
    const commitment = await readContract(sepoliaClient, {
      address: SEPOLIA_ENS_CONFIG.REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "makeCommitment",
      args: [
        params.label,
        params.owner,
        params.duration,
        params.secret,
        params.resolver,
        params.data,
        params.reverseRecord,
        params.ownerControlledFuses,
      ],
    });

    return commitment as `0x${string}`;
  } catch (error) {
    console.error("Error making commitment on Sepolia:", error);
    throw error;
  }
}

/**
 * Calculates the total cost for registering a domain on Sepolia
 */
export async function calculateRegistrationCostSepolia(
  domainName: string,
  years: number = 1
): Promise<{ totalWei: bigint; totalEth: string }> {
  try {
    const { normalized } = normalizeENSName(domainName);
    const duration = BigInt(years) * TIME.SECONDS_PER_YEAR;

    const priceData = (await readContract(sepoliaClient, {
      address: SEPOLIA_ENS_CONFIG.REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "rentPrice",
      args: [normalized, duration],
    })) as { base: bigint; premium: bigint };

    const totalWei = priceData.base + priceData.premium;
    const totalEth = Number(formatEther(totalWei)).toFixed(6);

    return {
      totalWei,
      totalEth,
    };
  } catch (error) {
    console.error("Error calculating registration cost on Sepolia:", error);
    throw error;
  }
}
