const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initializeDatabase, getDb } = require('./utils/db');
const { PREFIX } = require('./config');
const bip39 = require("bip39"); 
const bip32Factory = require("bip32").default; 
const bitcoin = require("bitcoinjs-lib"); const ecc = require("tiny-secp256k1"); 
const bip32 = bip32Factory(ecc);
const MNEMONIC = process.env.LTC_MASTER_MNEMONIC; 
const litecoin = { messagePrefix: "\x19Litecoin Signed Message:\n", bech32: "ltc", bip32: { public: 0x019da462, private: 0x019d9cfe }, pubKeyHash: 0x30, scriptHash: 0x32, wif: 0xb0 }; 
const seed = bip39.mnemonicToSeedSync(MNEMONIC); 
const root = bip32.fromSeed(seed, litecoin); 
const DB_FILE = "./users.json"; 
function loadUsers() { if (!fs.existsSync(DB_FILE)) return {}; return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } function saveUsers(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } function deriveAddress(index) { const child = root.derivePath(`m/44'/2'/0'/0/${index}`); const { address } = bitcoin.payments.p2pkh({ pubkey: Buffer.from(child.publicKey), network: litecoin }); return address; } function getOrCreateAddress(discordId) { const users = loadUsers(); if (users[discordId]) { return users[discordId].address; } const index = Object.keys(users).length + 1; const address = deriveAddress(index); users[discordId] = { index, address, credits: 0 }; saveUsers(users); return address; }

const TOKEN = process.env.DISCORD_BOT_TOKEN;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

client.commands = new Collection();
const cooldowns = new Collection();

// Load all commands from /commands folder
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.name, command);
    if (command.aliases) {
        for (const alias of command.aliases) {
            client.commands.set(alias, command);
        }
    }
}

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);
    if (!command) {
        return message.reply('Unknown command. Use `qhelp` to see available commands.');
    }

    // Cooldown handling
    if (!cooldowns.has(command.name)) {
        cooldowns.set(command.name, new Collection());
    }
    const now = Date.now();
    const timestamps = cooldowns.get(command.name);
    const cooldownAmount = 3000;

    if (timestamps.has(message.author.id)) {
        const expiration = timestamps.get(message.author.id) + cooldownAmount;
        if (now < expiration) {
            const timeLeft = ((expiration - now) / 1000).toFixed(1);
            return message.reply(`Please wait ${timeLeft} more second(s) before using this command again.`);
        }
    }
    timestamps.set(message.author.id, now);
    setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);

    try {
        await command.execute(message, args, client);
    } catch (error) {
        console.error(`Error executing command "${commandName}":`, error);
        await message.reply('An error occurred while executing the command.');
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const minesCommand = client.commands.get('mines');
    if (minesCommand?.handleInteraction) {
        await minesCommand.handleInteraction(interaction);
    }
});

client.on('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    console.log(`Bot is ready with prefix: ${PREFIX}`);
    console.log(`Loaded commands: ${[...new Set(commandFiles.map(f => f.replace('.js', '')))].join(', ')}`);
});

client.on('error', (error) => {
    console.error('Discord client error:', error);
});

async function startBot() {
    try {
        await initializeDatabase();
        await client.login(TOKEN);
    } catch (error) {
        console.error('Failed to start bot:', error);
        const db = getDb();
        if (db) await db.close();
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    const db = getDb();
    if (db) await db.close();
    client.destroy();
    process.exit(0);
});

startBot();
