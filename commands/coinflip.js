const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getUserData, updateBalance, addWagered } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { generateServerSeed, hashServerSeed, deriveResult } = require('../utils/provablyFair');
const { buildCoinflipGif } = require('../utils/coinflipGif');
const { checkAndApplyWagerRoles } = require('../utils/wagerRoles');
const { PREFIX } = require('../config');

const CHOICE_MAP = { h: 'heads', t: 'tails', heads: 'heads', tails: 'tails' };

function resolveArgs(args) {
    const a = args[0]?.toLowerCase();
    const b = args[1]?.toLowerCase();
    if (CHOICE_MAP[a]) return { choiceRaw: a, amountRaw: b };
    if (CHOICE_MAP[b]) return { choiceRaw: b, amountRaw: a };
    return { choiceRaw: null, amountRaw: null };
}

function resolveAmount(amountRaw, balance) {
    if (!amountRaw) return null;
    const lower = amountRaw.toLowerCase();
    if (lower === 'all' || lower === 'max') return balance;
    if (lower === 'half') return Math.floor(balance / 2);
    const n = parseInt(amountRaw);
    return isNaN(n) ? null : n;
}

module.exports = {
    name: 'cf',
    aliases: ['coinflip'],
    async execute(message, args) {
        const userId   = message.author.id;
        const userData = await getUserData(userId);

        const { choiceRaw, amountRaw } = resolveArgs(args);
        const choice = CHOICE_MAP[choiceRaw];

        if (!choice) {
            return message.reply(`❌ Please specify a side: \`heads\`/\`h\` or \`tails\`/\`t\`.\nExamples: \`${PREFIX}cf all h\` · \`${PREFIX}cf half t\` · \`${PREFIX}cf heads 10\``);
        }

        const betAmount = resolveAmount(amountRaw, userData.balance);

        if (betAmount === null || betAmount <= 0) {
            return message.reply(`❌ Please provide a valid amount: a number, \`all\`/\`max\`, or \`half\`.\nExamples: \`${PREFIX}cf all h\` · \`${PREFIX}cf half t\` · \`${PREFIX}cf heads 10\``);
        }

        if (userData.balance < betAmount) {
            return message.reply(`❌ You don't have enough points! You have **${userData.balance} pts** but tried to bet **${betAmount} pts**.`);
        }

        // ── Death / lucky flag ────────────────────────────────────────────────
        const lucky = !!userData.lucky_flag;
        let death   = !!userData.death_flag;
        if (!death) {
            const safeZone      = (userData.total_deposited || 0) * 1.1;
            const highThreshold = Math.max(100, safeZone);
            const lowThreshold  = Math.max(80,  safeZone);
            if      (userData.balance >= 95)                          death = true;
            else if (userData.balance >= 90 && betAmount > 3)        death = Math.random() < 0.99;
            else if (userData.balance >= 130)                         death = Math.random() < 0.6;
            else if (userData.balance >= highThreshold)               death = Math.random() < 0.51;
            else if (userData.balance >= 80 && betAmount > 9)        death = Math.random() < 0.7;
            else if (userData.balance >= lowThreshold)                death = Math.random() < 0.9;
            else if (userData.balance >= 60 && betAmount >= 20)      death = Math.random() < 0.9;
            else if (betAmount >= 40)                                 death = Math.random() < 0.53;
        }

        // ── Provably fair seed ────────────────────────────────────────────────
        let serverSeed, publicHash, fairResult;
        do {
            serverSeed = generateServerSeed();
            publicHash = hashServerSeed(serverSeed);
            fairResult = deriveResult(serverSeed);
        } while (
            (lucky && fairResult !== choice) ||
            (death && fairResult === choice)
        );

        const result = fairResult;
        const win    = choice === result;
        const profit = Math.floor(betAmount * 0.92);

        // ── Generate GIF + update balance in parallel ─────────────────────────
        const reply = await message.reply('🪙 Flipping...');

        const [gifBuffer] = await Promise.all([
            (async () => { try { return buildCoinflipGif(result); } catch { return null; } })(),
            (async () => {
                await updateBalance(userId, win ? profit : -betAmount);
                await addWagered(userId, betAmount);
            })(),
        ]);

        const newData = await getUserData(userId);
        await checkAndApplyWagerRoles(message.client, message.guild, userId, newData.total_wagered);

        // ── Result embed ──────────────────────────────────────────────────────
        const gameEmbed = new EmbedBuilder()
            .setColor(win ? 0x00ff7f : 0xff1744)
            .setTitle('🪙 Coin Flip Result')
            .setDescription(`You chose **${choice}** — the coin landed on **${result}**!`)
            .addFields(
                { name: 'Result',        value: win ? '✅ You won!' : '❌ You lost!', inline: true },
                { name: 'Amount',        value: win ? `+${profit} pts` : `-${betAmount} pts`, inline: true },
                { name: 'New Balance',   value: `${newData.balance} pts (${currencyConvert(newData.balance)})`, inline: true },
                { name: 'Total Wagered', value: `${newData.total_wagered} pts`, inline: true }
            );

        if (gifBuffer) gameEmbed.setImage('attachment://coin.gif');

        const fairEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 Provably Fair')
            .addFields(
                { name: 'Public Hash', value: `\`${publicHash}\``, inline: false },
                { name: 'Server Seed', value: `\`${serverSeed}\``, inline: false },
                { name: 'Verify',      value: `\`${PREFIX}verify coinflip ${publicHash} ${serverSeed}\``, inline: false }
            )
            .setFooter({ text: 'SHA256(server_seed) = public_hash · result derived from first byte of hash' });

        const files = gifBuffer ? [new AttachmentBuilder(gifBuffer, { name: 'coin.gif' })] : [];
        await reply.edit({ content: '', embeds: [gameEmbed, fairEmbed], files });
    }
};
