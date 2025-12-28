import { keccak256, toBytes, concat, toHex } from "viem"
import type { SubdomainParts } from "../types/subdomain"

/**
 * Parses a full subdomain string into its components
 * Example: "alice.mydomain.eth" -> { subdomain: "alice", domain: "mydomain", fullName: "alice.mydomain.eth" }
 */
export function parseSubdomainInput(input: string): SubdomainParts | null {
  try {
    // Remove .eth suffix and normalize
    const normalized = input.toLowerCase().trim().replace(/\.eth$/i, "")

    // Split by dots
    const parts = normalized.split(".")

    // Must have at least subdomain.domain format
    if (parts.length < 2) {
      return null
    }

    // For now, we only support one level of subdomain (subdomain.domain)
    // Not subdomain.subdomain.domain
    if (parts.length > 2) {
      return null
    }

    const [subdomain, domain] = parts

    // Validate both parts have content
    if (!subdomain || !domain) {
      return null
    }

    return {
      subdomain,
      domain,
      fullName: `${subdomain}.${domain}.eth`,
    }
  } catch (error) {
    return null
  }
}

/**
 * Calculates the label hash for a subdomain label
 * This is keccak256(label) used in setSubnodeOwner
 */
export function calculateLabelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label))
}

/**
 * Calculates the namehash for a parent domain
 * For .eth domains: keccak256(namehash(eth) + keccak256(label))
 */
export function calculateParentNode(domainLabel: string): `0x${string}` {
  // ENS root for .eth TLD
  const ethNode = "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"

  const labelHash = keccak256(toBytes(domainLabel))

  return keccak256(concat([toBytes(ethNode), toBytes(labelHash)]))
}

/**
 * Calculates the full namehash for a subdomain
 * This is keccak256(parentNode + labelHash)
 */
export function calculateSubdomainNode(
  parentNode: `0x${string}`,
  subdomainLabel: string
): `0x${string}` {
  const labelHash = calculateLabelHash(subdomainLabel)

  return keccak256(concat([toBytes(parentNode), toBytes(labelHash)]))
}

/**
 * Validates subdomain label format
 * - Must be alphanumeric with hyphens
 * - Can't start or end with hyphen
 * - 1-63 characters
 */
export function isValidSubdomainLabel(label: string): boolean {
  // Check length
  if (label.length < 1 || label.length > 63) {
    return false
  }

  // Check format: alphanumeric and hyphens only
  const validFormat = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/
  if (!validFormat.test(label)) {
    return false
  }

  return true
}

/**
 * Validates both subdomain and domain labels
 */
export function validateSubdomainParts(subdomain: string, domain: string): {
  valid: boolean
  reason?: string
} {
  if (!isValidSubdomainLabel(subdomain)) {
    return {
      valid: false,
      reason: `Invalid subdomain "${subdomain}". Must be 1-63 characters, alphanumeric with optional hyphens (not at start/end).`,
    }
  }

  if (!isValidSubdomainLabel(domain)) {
    return {
      valid: false,
      reason: `Invalid domain "${domain}". Must be 1-63 characters, alphanumeric with optional hyphens (not at start/end).`,
    }
  }

  return { valid: true }
}
