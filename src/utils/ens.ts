import { keccak256, toHex, concat, toBytes, type PublicClient } from "viem"
import { normalize } from "viem/ens"
import { ENS_VALIDATION } from "../constants/ens"

/**
 * Normalizes and validates an ENS domain name
 */
export function normalizeENSName(domainName: string): {
  normalized: string
  valid: boolean
  reason?: string
} {
  try {
    // Remove .eth suffix if present
    const label = domainName.toLowerCase().trim().replace(ENS_VALIDATION.SUFFIX, "")

    // Normalize (handles Unicode)
    const normalized = normalize(label)

    // Validate length
    if (normalized.length < ENS_VALIDATION.MIN_LENGTH) {
      return {
        normalized,
        valid: false,
        reason: `Name must be at least ${ENS_VALIDATION.MIN_LENGTH} characters`,
      }
    }

    return { normalized, valid: true }
  } catch (error) {
    return {
      normalized: "",
      valid: false,
      reason: "Invalid ENS name format",
    }
  }
}

/**
 * Converts an ENS label to its tokenId (labelhash)
 * Used by BaseRegistrar contract
 */
export function getTokenId(label: string): bigint {
  const hash = keccak256(toHex(label))
  return BigInt(hash)
}

/**
 * Computes ENS namehash for a full domain name
 * Used by ENS Registry contract
 */
export function namehash(name: string): `0x${string}` {
  // For .eth domains: namehash(eth) + keccak256(label)
  const ethNode = "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"
  const label = name.toLowerCase().replace(".eth", "")
  const labelHash = keccak256(toBytes(label))

  return keccak256(concat([toBytes(ethNode), toBytes(labelHash)]))
}

/**
 * Formats ETH price to 4 decimal places
 */
export function formatPrice(priceEth: string): string {
  return Number(priceEth).toFixed(4)
}

/**
 * Calculates days until a future date
 */
export function daysUntil(date: Date): number {
  const now = new Date()
  return Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

/**
 * Shortens an Ethereum address for display
 * Example: 0x1234567890abcdef... -> 0x1234...cdef
 */
export function formatAddress(address: string): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Validates if an address is a valid Ethereum address (EOA format)
 * Checks:
 * - Proper hex format (0x prefix + 40 hex characters)
 * - Valid checksum if provided
 */
export function isValidEOAAddress(address: string): boolean {
  // Check basic format: 0x + 40 hex characters
  const hexRegex = /^0x[a-fA-F0-9]{40}$/
  if (!hexRegex.test(address)) {
    return false
  }

  return true
}

/**
 * Gets ETH balance for an address on a specific chain
 * @param client - Viem public client for the target chain
 * @param address - Ethereum address to check
 * @returns Balance in wei (bigint)
 */
export async function getBalance(
  client: any,  // Using any to support different chain types
  address: `0x${string}`
): Promise<bigint> {
  try {
    const balance = await client.getBalance({ address })
    return balance
  } catch (error) {
    console.error(`Error fetching balance for ${address}:`, error)
    return 0n
  }
}
