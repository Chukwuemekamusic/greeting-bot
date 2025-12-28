import type { BotCommand } from "@towns-protocol/bot";

// Those commands will be registered to the bot as soon as the bot is initialized
// and will be available in the slash command autocomplete.
const commands = [
  {
    name: "help",
    description: "Get help with bot commands",
  },
  {
    name: "time",
    description: "Get the current time",
  },
  {
    name: "check",
    description: "Check ENS domain availability (.eth)",
  },
  {
    name: "expiry",
    description: "Check ENS domain expiration date",
  },
  {
    name: "history",
    description: "View complete history of an ENS domain",
  },
  {
    name: "portfolio",
    description: "View ENS domain portfolio",
  },
  {
    name: "register",
    description: "Register an ENS domain (you pay gas)",
  },
  {
    name: "test_register",
    description: "Test ENS registration on Sepolia testnet",
  },
  {
    name: "test_transfer",
    description: "Transfer ENS domain on Sepolia testnet",
  },
  {
    name: "bridge_register",
    description: "Register an ENS domain using Towns Bridge (no gas)",
  },
  {
    name: "test_wallet_pick",
    description: "Test wallet selection (includes all wallet types)",
  },
  {
    name: "assign_subdomain",
    description: "Assign a subdomain to an address",
  },
] as const satisfies BotCommand[];

export default commands;
