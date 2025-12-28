/**
 * Subdomain Assignment Types
 */

export interface SubdomainParts {
  subdomain: string;
  domain: string;
  fullName: string;
}

export interface SubdomainAssignmentState {
  userId: string;
  channelId: string;
  subdomain: string;
  domain: string;
  fullName: string;
  recipient: `0x${string}`;
  ownerWallet: `0x${string}`;
  timestamp: number;
}

export interface SubdomainPrepareResult {
  success: boolean;
  reason?: string;
  subdomain?: string;
  domain?: string;
  fullName?: string;
  parentNode?: `0x${string}`;
  subdomainNode?: `0x${string}`;
  labelHash?: `0x${string}`;
  recipient?: `0x${string}`;
  ownerWallet?: `0x${string}`;
}

export interface SubdomainTransactionData {
  setSubnodeOwner: `0x${string}`;
  setResolver: `0x${string}`;
  setAddr: `0x${string}`;
}
