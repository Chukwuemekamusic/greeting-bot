# TODO

- optimized checkAvailability( domainName: string): Promise<ENSAvailabilityResult> to checkAvailability( domainName: string, normalized: boolean = false): Promise<ENSAvailabilityResult>

# bridgin steps

Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
Plan: Fix ENS Bridge Architecture with Smart EOA Flow

Overview

Implement an intelligent bridge flow that:

1.  Checks if user has sufficient ETH on Mainnet EOA - if yes, skip bridging entirely
2.  If insufficient Mainnet funds - guides user through optimal path based on where they have funds

Implementation Steps

1.  Add EOA Address Collection

- Modify /bridge_register command to accept optional EOA address parameter: /bridge_register <domain> [eoa_address]
- If not provided, prompt user with interaction form to input their EOA address
- Validate EOA format (must be valid Ethereum address)

2.  Implement Smart Balance Check Logic

Flow decision tree:
A. Check Mainnet EOA balance
↓ Sufficient? → Proceed directly to ENS registration
↓ Insufficient? → Continue to B

B. Check Base EOA balance
↓ Sufficient? → Bridge Base EOA → Mainnet EOA
↓ Insufficient? → Continue to C

C. Check Base Smart Account balance
↓ Sufficient? → Multi-step: Smart → Base EOA, then Base EOA → Mainnet EOA
↓ Insufficient? → Error: no funds available

3.  Implement Three Transaction Paths

Path A - Direct Registration (user has Mainnet ETH)

- Use existing ENS registration flow with EOA as signerWallet

Path B - Simple Bridge (user has Base EOA ETH)

- Single bridge transaction: Base EOA → Mainnet EOA
- Use Across Protocol with EOA as both depositor and recipient

Path C - Multi-step Transfer + Bridge (user only has Base smart account ETH)

- Step 1: Transfer ETH from Base smart account → user's Base EOA
- Step 2: Bridge Base EOA → Mainnet EOA
- Both transactions sent sequentially with status tracking

4.  Update Transaction Requests with signerWallet

- Modify all interaction requests to include signerWallet: eoaAddress
- This ensures transactions are signed by the EOA (not smart account)
- Update bridge, transfer, and ENS registration transaction builders

5.  Add User Guidance Messages

- Clear messaging at each step explaining what's happening
- Show balance checks: "Checking Mainnet balance... Found X ETH"
- Display chosen path: "You have funds on Base. I'll bridge them to Mainnet first."
- Progress updates for multi-step flows

6.  Error Handling & Edge Cases

- Validate EOA address is not a smart account
- Handle bridge quote failures gracefully
- Add timeout handling for multi-step flows
- Provide clear error messages with suggested actions

Files to Modify

1.  src/index.ts (lines 747-1080)

- Update /bridge_register command signature
- Add EOA collection logic
- Implement smart balance checking
- Add path selection logic

2.  src/services/bridge.ts

- Add new function: prepareBridgeTransactionEOA()
- Add: prepareSmartAccountToEOATransfer()
- Keep existing bridge logic for compatibility

3.  src/services/ens.ts

- Update registration functions to accept signerWallet parameter
- Pass through to transaction builders

4.  src/utils/ens.ts

- Add EOA validation utility
- Add balance checking utilities for both chains/wallets
