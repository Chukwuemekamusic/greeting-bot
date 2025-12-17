export interface ENSAvailabilityResult {
  available: boolean
  valid: boolean
  reason?: string
  priceEth?: string
}

export interface ENSExpiryResult {
  valid: boolean
  registered: boolean
  expirationDate?: Date
  daysUntilExpiry?: number
  expired?: boolean
  inGracePeriod?: boolean
  gracePeriodEnds?: Date
  owner?: string
  registrant?: string
  reason?: string
}
