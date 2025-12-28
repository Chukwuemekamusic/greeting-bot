import { createPublicClient, http } from "viem"
import { mainnet } from "viem/chains"
import { readContract } from "viem/actions"
import { ENS_CONFIG, BASE_REGISTRAR_ABI, ENS_REGISTRY_ABI } from "../constants/ens"
import { getTokenId, isValidEOAAddress } from "../utils/ens"
import {
  parseSubdomainInput,
  calculateParentNode,
  calculateSubdomainNode,
  calculateLabelHash,
  validateSubdomainParts,
} from "../utils/subdomain"
import { getLinkedWallets, filterEOAs } from "../utils/wallets"
import type { SubdomainPrepareResult } from "../types/subdomain"

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL

if (!MAINNET_RPC_URL) {
  throw new Error("MAINNET_RPC_URL environment variable is required")
}

const ethereumClient = createPublicClient({
  chain: mainnet,
  transport: http(MAINNET_RPC_URL),
})

/**
 * Resolves an ENS name or validates an Ethereum address
 * Returns the resolved address or null if invalid
 */
export async function resolveRecipient(
  recipient: string
): Promise<{ address: `0x${string}` | null; error?: string }> {
  // Check if it's already an address
  if (isValidEOAAddress(recipient)) {
    return { address: recipient as `0x${string}` }
  }

  // Try to resolve as ENS name
  if (recipient.endsWith(".eth")) {
    try {
      // Use ENS Registry to resolve
      const address = await ethereumClient.getEnsAddress({
        name: recipient,
      })

      if (!address) {
        return {
          address: null,
          error: `ENS name "${recipient}" does not resolve to an address`,
        }
      }

      return { address }
    } catch (error) {
      return {
        address: null,
        error: `Failed to resolve ENS name "${recipient}"`,
      }
    }
  }

  return {
    address: null,
    error: `Invalid recipient "${recipient}". Must be an Ethereum address or ENS name.`,
  }
}

/**
 * Verifies that the parent domain is owned by one of the user's EOA wallets
 * Returns the owning EOA wallet if found
 */
export async function verifyParentDomainOwnership(
  domainLabel: string,
  bot: any,
  userId: `0x${string}`
): Promise<{ owned: boolean; ownerWallet?: `0x${string}`; error?: string }> {
  try {
    // Get all linked wallets
    const linkedWallets = await getLinkedWallets(bot, userId)

    if (linkedWallets.length === 0) {
      return {
        owned: false,
        error: "No linked wallets found for your account",
      }
    }

    // Filter to get only EOAs
    const eoaWallets = await filterEOAs(linkedWallets, ethereumClient)

    if (eoaWallets.length === 0) {
      return {
        owned: false,
        error: "No EOA wallets found. Only EOA wallets can own ENS domains.",
      }
    }

    // Get the domain's token ID
    const tokenId = getTokenId(domainLabel)

    // Check who owns the domain
    let currentOwner: string
    try {
      currentOwner = (await readContract(ethereumClient, {
        address: ENS_CONFIG.BASE_REGISTRAR,
        abi: BASE_REGISTRAR_ABI,
        functionName: "ownerOf",
        args: [tokenId],
      })) as string
    } catch (error) {
      return {
        owned: false,
        error: `Domain "${domainLabel}.eth" is not registered or has expired`,
      }
    }

    // Check if any of the user's EOAs own the domain
    const ownerWallet = eoaWallets.find(
      (wallet) => wallet.toLowerCase() === currentOwner.toLowerCase()
    )

    if (!ownerWallet) {
      return {
        owned: false,
        error: `You don't own "${domainLabel}.eth". Current owner: ${currentOwner.slice(0, 6)}...${currentOwner.slice(-4)}`,
      }
    }

    return {
      owned: true,
      ownerWallet,
    }
  } catch (error) {
    console.error("Error verifying domain ownership:", error)
    return {
      owned: false,
      error: "Failed to verify domain ownership",
    }
  }
}

/**
 * Prepares and validates all data needed for subdomain assignment
 * Returns complete preparation result with transaction data
 */
export async function prepareSubdomainAssignment(
  subdomainInput: string,
  recipientInput: string,
  bot: any,
  userId: `0x${string}`
): Promise<SubdomainPrepareResult> {
  try {
    // Step 1: Parse subdomain input
    const parsed = parseSubdomainInput(subdomainInput)
    if (!parsed) {
      return {
        success: false,
        reason:
          'Invalid format. Use "subdomain.domain.eth" (e.g., "alice.mydomain.eth")',
      }
    }

    const { subdomain, domain, fullName } = parsed

    // Step 2: Validate subdomain and domain labels
    const validation = validateSubdomainParts(subdomain, domain)
    if (!validation.valid) {
      return {
        success: false,
        reason: validation.reason,
      }
    }

    // Step 3: Verify parent domain ownership
    const ownershipCheck = await verifyParentDomainOwnership(
      domain,
      bot,
      userId
    )
    if (!ownershipCheck.owned) {
      return {
        success: false,
        reason: ownershipCheck.error,
      }
    }

    // Step 4: Resolve recipient
    const recipientResult = await resolveRecipient(recipientInput)
    if (!recipientResult.address) {
      return {
        success: false,
        reason: recipientResult.error,
      }
    }

    // Step 5: Calculate all necessary hashes and nodes
    const parentNode = calculateParentNode(domain)
    const labelHash = calculateLabelHash(subdomain)
    const subdomainNode = calculateSubdomainNode(parentNode, subdomain)

    // Step 6: Check if subdomain already exists
    try {
      const existingOwner = (await readContract(ethereumClient, {
        address: ENS_CONFIG.ENS_REGISTRY,
        abi: ENS_REGISTRY_ABI,
        functionName: "owner",
        args: [subdomainNode],
      })) as string

      // If owner is not zero address, subdomain already exists
      if (
        existingOwner !== "0x0000000000000000000000000000000000000000"
      ) {
        return {
          success: false,
          reason: `Subdomain "${fullName}" already exists and is owned by ${existingOwner.slice(0, 6)}...${existingOwner.slice(-4)}`,
        }
      }
    } catch (error) {
      // If reading fails, subdomain might not exist, which is fine
      console.log("Subdomain does not exist (expected for new assignment)")
    }

    // Success - return all prepared data
    return {
      success: true,
      subdomain,
      domain,
      fullName,
      parentNode,
      subdomainNode,
      labelHash,
      recipient: recipientResult.address,
      ownerWallet: ownershipCheck.ownerWallet,
    }
  } catch (error) {
    console.error("Error preparing subdomain assignment:", error)
    return {
      success: false,
      reason: "An unexpected error occurred while preparing the assignment",
    }
  }
}
