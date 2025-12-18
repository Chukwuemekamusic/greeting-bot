import { createPublicClient, http, formatEther } from "viem";
import { mainnet } from "viem/chains";
import { readContract } from "viem/actions";
import {
  ENS_CONTRACTS,
  TIME,
  CONTROLLER_ABI,
  BASE_REGISTRAR_ABI,
  ENS_REGISTRY_ABI,
} from "../constants/ens";
import { normalizeENSName, getTokenId, namehash } from "../utils/ens";
import type {
  ENSAvailabilityResult,
  ENSExpiryResult,
  ENSUserPortfolio,
} from "../types/ens";

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL;

if (!MAINNET_RPC_URL) {
  throw new Error("MAINNET_RPC_URL environment variable is required");
}

const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC_URL),
});

/**
 * Checks if an ENS domain is available for registration
 */
export async function checkAvailability(
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
    const isAvailable = await readContract(ethereumClient, {
      address: ENS_CONTRACTS.REGISTRAR_CONTROLLER,
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
      const priceData = (await readContract(ethereumClient, {
        address: ENS_CONTRACTS.REGISTRAR_CONTROLLER,
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
    console.error("Error checking availability:", error);
    return {
      label: "",
      fullName: "",
      available: false,
      valid: false,
      reason: "Error checking availability",
    };
  }
}

/**
 * Checks ENS domain expiration information
 */
export async function checkExpiry(
  domainName: string
): Promise<ENSExpiryResult> {
  try {
    // Normalize and validate the domain name
    const { normalized, valid, reason } = normalizeENSName(domainName);
    const fullName = `${normalized}.eth`;

    if (!valid) {
      return {
        label: normalized,
        fullName,
        valid: false,
        registered: false,
        reason,
      };
    }

    const tokenId = getTokenId(normalized);
    const nodeHash = namehash(fullName);

    // Check expiry timestamp from BaseRegistrar
    let expiryTimestamp: bigint;
    let registrant: string | undefined;

    try {
      expiryTimestamp = (await readContract(ethereumClient, {
        address: ENS_CONTRACTS.BASE_REGISTRAR,
        abi: BASE_REGISTRAR_ABI,
        functionName: "nameExpires",
        args: [tokenId],
      })) as bigint;

      // If expires is 0, domain is not registered
      if (expiryTimestamp === 0n) {
        return {
          label: normalized,
          fullName,
          valid: true,
          registered: false,
          reason: "Domain is not registered",
        };
      }

      // Get the registrant (NFT holder)
      try {
        registrant = (await readContract(ethereumClient, {
          address: ENS_CONTRACTS.BASE_REGISTRAR,
          abi: BASE_REGISTRAR_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        })) as string;
      } catch {
        // Registrant might not be available if domain expired beyond grace period
        registrant = undefined;
      }
    } catch (error) {
      // Domain not registered or error querying
      return {
        label: normalized,
        fullName,
        valid: true,
        registered: false,
        reason: "Domain is not registered or unavailable",
      };
    }

    // Get the ENS registry owner (who controls the records)
    let owner: string | undefined;
    try {
      owner = (await readContract(ethereumClient, {
        address: ENS_CONTRACTS.ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "owner",
        args: [nodeHash],
      })) as string;
    } catch {
      // Owner might not be set
      owner = undefined;
    }

    // Calculate expiry details
    const now = Math.floor(Date.now() / 1000);
    const expiryTimestampNum = Number(expiryTimestamp);
    const expiryDate = new Date(expiryTimestampNum * 1000);
    const daysUntilExpiry = Math.floor((expiryTimestampNum - now) / 86400);
    const isExpired = now > expiryTimestampNum;

    // Calculate grace period
    const gracePeriodEnds = new Date(
      (expiryTimestampNum + TIME.GRACE_PERIOD_SECONDS) * 1000
    );
    const inGracePeriod =
      isExpired && now < expiryTimestampNum + TIME.GRACE_PERIOD_SECONDS;

    return {
      label: normalized,
      fullName,
      valid: true,
      registered: true,
      expirationDate: expiryDate,
      daysUntilExpiry,
      expired: isExpired,
      inGracePeriod,
      gracePeriodEnds,
      owner,
      registrant,
    };
  } catch (error) {
    console.error("Error checking expiry:", error);
    return {
      label: "",
      fullName: "",
      valid: false,
      registered: false,
      reason: "Error checking expiry",
    };
  }
}

/**
 * Checks a user's ENS portfolio
 */
export async function getUserPortfolio(
  userAddress: string
): Promise<ENSUserPortfolio> {
  try {
    // Query subgraph for all user's domains
    const query = `
    query GetUserDomains($owner: String!) {
        account(id: $owner) {
          
          registrations(first: 1000) {
            domain {
              name
              labelName
            }
            expiryDate
            registrationDate
          }
        }
      }
    `;

    const response = await fetch(ENS_CONTRACTS.SUBGRAPH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          owner: userAddress.toLowerCase(),
        },
      }),
    });

    const { data } = await response.json();
    if (!data?.account) {
      return {
        address: userAddress,
        totalDomains: 0,
        activeDomains: 0,
        expiredDomains: 0,
        expiringSoon: 0,
        inGracePeriod: 0,
        domains: [],
      };
    }
    const { registrations } = data.account;
    const now = Math.floor(Date.now() / 1000);

    // Process domain data from subgraph (no contract calls for speed)
    const domains: ENSExpiryResult[] = registrations.map((reg: any) => {
      const label = reg.domain.labelName;
      const fullName = reg.domain.name;
      const expiryTimestamp = Number(reg.expiryDate);
      const expiryDate = new Date(expiryTimestamp * 1000);
      const daysUntilExpiry = Math.floor((expiryTimestamp - now) / 86400);
      const isExpired = now > expiryTimestamp;
      const inGracePeriod =
        isExpired && now < expiryTimestamp + TIME.GRACE_PERIOD_SECONDS;
      const gracePeriodEnds = new Date(
        (expiryTimestamp + TIME.GRACE_PERIOD_SECONDS) * 1000
      );

      return {
        label,
        fullName,
        valid: true,
        registered: true,
        expirationDate: expiryDate,
        daysUntilExpiry,
        expired: isExpired,
        inGracePeriod,
        gracePeriodEnds,
        registrant: userAddress,
      };
    });

    // Calculate stats
    const totalDomains = domains.length;
    const activeDomains = domains.filter((d) => !d.expired).length;
    const expiredDomains = domains.filter((d) => d.expired).length;
    const inGracePeriodCount = domains.filter((d) => d.inGracePeriod).length;
    const expiringSoon = domains.filter(
      (d) =>
        !d.expired && d.daysUntilExpiry !== undefined && d.daysUntilExpiry <= 30
    ).length;

    // Sort by expiry date (soonest first for active, then expired domains)
    domains.sort((a, b) => {
      // Active domains before expired
      if (a.expired && !b.expired) return 1;
      if (!a.expired && b.expired) return -1;

      // Within same status, sort by expiry date
      return (
        (a.expirationDate?.getTime() || 0) - (b.expirationDate?.getTime() || 0)
      );
    });

    return {
      address: userAddress,
      totalDomains,
      activeDomains,
      expiredDomains,
      expiringSoon,
      inGracePeriod: inGracePeriodCount,
      domains,
    };
  } catch (error) {
    console.error("Error fetching user domains:", error);
    throw error;
  }
}

// domains(first: 1000, where: { parent: "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae" }) {
//             name
//             labelName
//             createdAt
//           }
