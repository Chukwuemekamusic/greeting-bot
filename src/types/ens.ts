export interface ENSAvailabilityResult {
  label: string;
  fullName: string;
  available: boolean;
  valid: boolean;
  reason?: string;
  priceEth?: string;
}

export interface ENSExpiryResult {
  label: string;
  fullName: string;
  valid: boolean;
  registered: boolean;
  expirationDate?: Date;
  daysUntilExpiry?: number;
  expired?: boolean;
  inGracePeriod?: boolean;
  gracePeriodEnds?: Date;
  owner?: string;
  registrant?: string;
  reason?: string;
}

export interface ENSUserPortfolio {
  address: string;
  totalDomains: number;
  activeDomains: number;
  expiredDomains: number;
  expiringSoon: number;
  inGracePeriod: number;
  domains: ENSExpiryResult[];
}
