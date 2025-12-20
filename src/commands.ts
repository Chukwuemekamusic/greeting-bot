import type { BotCommand } from '@towns-protocol/bot'

// Those commands will be registered to the bot as soon as the bot is initialized
// and will be available in the slash command autocomplete.
const commands = [
    {
        name: 'help',
        description: 'Get help with bot commands',
    },
    {
        name: 'time',
        description: 'Get the current time',
    },
    {
        name: 'check',
        description: 'Check ENS domain availability (.eth)',
    },
    {
        name: 'expiry',
        description: 'Check ENS domain expiration date',
    },
    {
        name: 'history',
        description: 'View complete history of an ENS domain',
    },
    {
        name: 'portfolio',
        description: 'View ENS domain portfolio',
    },
    {
        name: 'register',
        description: 'Register an ENS domain (you pay gas)',
    },
    {
        name: 'testregister',
        description: 'Test ENS registration on Sepolia testnet',
    },
] as const satisfies BotCommand[]

export default commands
