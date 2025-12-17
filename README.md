# ENS Domain Bot

A Towns bot for checking ENS domain availability and expiration information.

# Features

- **Slash commands**: Registering and handling `/commands`
- **ENS integration**: Check domain availability and expiration
- **Web3 integration**: Query Ethereum mainnet ENS contracts
- **Message handling**: Detecting keywords in messages
- **Sending messages**: Posting messages to channels
- **Adding reactions**: Attaching emoji reactions to messages
- **Reaction events**: Responding to user reactions

## Slash Commands

- `/help` - Shows available commands and message triggers
- `/time` - Displays the current server time
- `/check <domain>` - Check if an ENS domain is available for registration
- `/expiry <domain>` - Check ENS domain expiration date and ownership

## ENS Commands in Detail

### `/check <domain>`
Check if an ENS domain (.eth) is available for registration.

**Example:** `/check vitalik`

**Response:**
- Shows availability status
- Displays registration price (1 year) in ETH if available
- Indicates if domain is already registered

### `/expiry <domain>`
Check ENS domain expiration information.

**Example:** `/expiry vitalik`

**Response:**
- Expiration date and countdown
- Domain status (Active, Expired, Grace Period)
- Grace period information (90 days after expiration)
- Warning if expiring within 30 days
- Registrant (NFT holder) wallet address
- Controller (ENS owner) wallet address if different

## Message Triggers

- Say "hello" - Bot greets you back
- Say "ping" - Bot responds with "Pong!" and latency
- Say "react" - Bot adds a thumbs up reaction to your message

You will need to mention the bot if you're using the `Mentions, Commands, Replies & Reactions` message behavior for your bot.

## Reaction Handling

- React with 👋 to any message - Bot responds with "I saw your wave!"

# Setup

1. Copy `.env.sample` to `.env` and fill in your credentials:

   ```bash
   cp .env.sample .env
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

3. Run the bot:
   ```bash
   bun run dev
   ```

# Environment Variables

Required variables in `.env`:

- `APP_PRIVATE_DATA` - Your Towns app private data (base64 encoded)
- `JWT_SECRET` - JWT secret for webhook authentication
- `MAINNET_RPC_URL` - Ethereum mainnet RPC URL (e.g., Alchemy, Infura)
- `PORT` - Port to run the bot on (optional, defaults to 5123)

# Usage

Once the bot is running, installed to a space and added to a channel:

**Try the slash commands:**

- `/help` - See all available features
- `/time` - Get the current time
- `/check vitalik` - Check if "vitalik.eth" is available
- `/expiry vitalik` - Check when "vitalik.eth" expires

**Try the message triggers:**

- Type "hello" anywhere in your message
- Type "ping" to check bot latency
- Type "react" to get a reaction

**Try reactions:**

- Add a 👋 reaction to any message

# Code Structure

The bot is organized with clean separation of concerns:

```
src/
├── index.ts              # Main bot logic and event handlers
├── commands.ts           # Slash command definitions
├── constants/
│   └── ens.ts           # ENS contract addresses, ABIs, constants
├── services/
│   └── ens.ts           # ENS business logic (availability & expiry)
├── types/
│   └── ens.ts           # TypeScript interfaces
└── utils/
    └── ens.ts           # Helper functions (normalize, format, etc.)
```

## Main Files

### `src/commands.ts`
Defines the slash commands available to users. Commands registered here appear in the slash command menu.

### `src/index.ts`
Main bot logic with:
1. **Bot initialization** (`makeTownsBot`) - Creates bot instance with credentials and commands
2. **Slash command handlers** (`onSlashCommand`) - Handle `/help`, `/time`, `/check`, `/expiry`
3. **Message handler** (`onMessage`) - Respond to message keywords (hello, ping, react)
4. **Reaction handler** (`onReaction`) - Respond to emoji reactions (👋)
5. **Bot server setup** (`bot.start()`) - Starts the bot server with a Hono HTTP server

### `src/services/ens.ts`
ENS integration service:
- `checkAvailability(domain)` - Check if domain is available and get price
- `checkExpiry(domain)` - Get expiration info, owner, registrant

### `src/constants/ens.ts`
ENS configuration:
- Contract addresses (ETHRegistrarController, BaseRegistrar, ENS Registry)
- Contract ABIs for blockchain interactions
- Time constants (grace period, seconds per year)
- Validation rules

### `src/utils/ens.ts`
Helper functions:
- `normalizeENSName()` - Validate and normalize domain names
- `getTokenId()` - Convert label to tokenId (labelhash)
- `namehash()` - Compute ENS namehash
- `formatAddress()` - Shorten Ethereum addresses for display

### `src/types/ens.ts`
TypeScript interfaces for type safety across the codebase.

## ENS Smart Contracts Used

The bot interacts with three Ethereum mainnet contracts:

1. **ETHRegistrarController** (`0x253553366Da8546fC250F225fe3d25d0C782303b`)
   - Check domain availability
   - Get registration prices

2. **BaseRegistrar** (`0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85`)
   - Check expiration timestamps
   - Get registrant (NFT holder) address

3. **ENS Registry** (`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`)
   - Get controller/owner address

## Extending this Bot

To add your own features:

1. **Add a slash command:**
   - Add to `src/commands.ts`
   - Create a handler in `src/index.ts` with `bot.onSlashCommand('yourcommand', async (handler, event) => { ... })`

2. **Add ENS features:**
   - Add new functions to `src/services/ens.ts`
   - Add contract ABIs to `src/constants/ens.ts` if needed
   - Create helper functions in `src/utils/ens.ts`

3. **Add message triggers:**
   - Add conditions in the `bot.onMessage()` handler

4. **Handle more events:**
   - Use `bot.onReaction()`, `bot.onMessageEdit()`, `bot.onChannelJoin()`, etc.
