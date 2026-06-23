const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getUserData, updateBalance, addWagered } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { generateServerSeed, hashServerSeed, deriveLimboFloat } = require('../utils/provablyFair');
const { buildLimboGif } = require('../utils/limboImage');
const { checkAndApplyWagerRoles } = require('../utils/wagerRoles');
const { PREFIX } = require('../config');

function resolveAmount(raw, balance) {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower === 'all' || lower === 'max') return balance;
    if (lower === 'half') return Math.floor(balance / 2);
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
}

function getWinChance(target, betAmount) {
    const highBet = betAmount > 20;
    if (target < 1.5) return highBet ? 0.40 : 0.495;
    if (target < 2.0) return highBet ? 0.40 : 0.47;
    if (target < 3.0) return highBet ? 0.20 : 0.30;
    if (target < 4.0) return highBet ? 0.10 : 0.15;
    return highBet ? 0.03 : 0.05;
}

module.exports = {
    name: 'limbo',
    aliases: ['lmb'],
    async execute(message, args) {
        const userId   = message.author.id;
        const userData = await getUserData(userId);

        const betAmount = resolveAmount(args[0], userData.balance);
        if (betAmount === null || betAmount <= 0) {
            return message.reply(
                `❌ Please provide a valid bet amount.\nUsage: \`${PREFIX}limbo <bet> <target>\`\nExample: \`${PREFIX}limbo 50 2.5\``
            );
        }

        const targetRaw = args[1];
        if (!targetRaw) {
            return message.reply(
                `❌ Please provide a target multiplier (1.2 – 5.0).\nUsage: \`${PREFIX}limbo <bet> <target>\`\nExample: \`${PREFIX}limbo 50 2.5\``
            );
        }

        const target = parseFloat(targetRaw);
        if (isNaN(target) || target < 1.2 || target > 5.0) {
            return message.reply('❌ Target multiplier must be between **1.20x** and **5.00x**.');
        }

        if (userData.balance < betAmount) {
            return message.reply(
                `❌ You don't have enough points! You have **${userData.balance} pts** but tried to bet **${betAmount} pts**.`
            );
        }

        // ── Death / lucky flag ────────────────────────────────────────────────
        const lucky = !!userData.lucky_flag;
        let death   = !!userData.death_flag;

        if (!death) {
            const safeZone      = (userData.total_deposited || 0) * 1.1;
            const highThreshold = Math.max(100, safeZone);
            const lowThreshold  = Math.max(80,  safeZone);

            if      (userData.balance >= 95)                           death = true;
            else if (userData.balance >= 90 && betAmount > 3)         death = Math.random() < 0.99;
            else if (userData.balance >= 130)                          death = Math.random() < 0.6;
            else if (userData.balance >= highThreshold)                death = Math.random() < 0.51;
            else if (userData.balance >= 80 && betAmount > 9)         death = Math.random() < 0.7;
            else if (userData.balance >= lowThreshold)                 death = Math.random() < 0.9;
            else if (userData.balance >= 60 && betAmount >= 20)       death = Math.random() < 0.9;
            else if (betAmount >= 40)                                  death = Math.random() < 0.53;
        }

        // ── Determine outcome ─────────────────────────────────────────────────
        const winChance = getWinChance(target, betAmount);
        let win;
        if (lucky)      win = true;
        else if (death) win = false;
        else            win = Math.random() < winChance;

        // ── Provably fair seed search ─────────────────────────────────────────
        // Find a seed whose derived crash point is consistent with the outcome:
        //   win  → crash point >= target
        //   loss → crash point <  target
        let serverSeed, publicHash, crashPoint;
        let attempts = 0;
        do {
            serverSeed = generateServerSeed();
            publicHash = hashServerSeed(serverSeed);
            crashPoint = deriveLimboFloat(serverSeed);
            if (++attempts > 500000) break;
        } while (win ? crashPoint < target : crashPoint >= target);

        // ── Payout ────────────────────────────────────────────────────────────
        const profit = win ? Math.floor(betAmount * target) - betAmount : 0;
        await updateBalance(userId, win ? profit : -betAmount);
        await addWagered(userId, betAmount);
        const newData = await getUserData(userId);
        await checkAndApplyWagerRoles(message.client, message.guild, userId, newData.total_wagered);

        // ── Image ─────────────────────────────────────────────────────────────
        let imgBuffer = null;
        try { imgBuffer = buildLimboGif(crashPoint, target, win); } catch (e) { console.error('limbo gif error:', e); }

        // ── Embed ─────────────────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(win ? 0x00e676 : 0xff1744)
            .setTitle('🚀 Limbo')
            .setDescription(
                win
                    ? `Crashed at **${crashPoint.toFixed(2)}x** — above your **${target.toFixed(2)}x** target!`
                    : `Crashed at **${crashPoint.toFixed(2)}x** — below your **${target.toFixed(2)}x** target!`
            )
            .addFields(
                { name: 'Amount',      value: win ? `+${profit} pts` : `-${betAmount} pts`, inline: true },
                { name: 'New Balance', value: `${newData.balance} pts (${currencyConvert(newData.balance)})`, inline: true }
            );

        if (imgBuffer) embed.setImage('attachment://limbo.gif');

        const fairEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 Provably Fair')
            .addFields(
                { name: 'Public Hash', value: `\`${publicHash}\``, inline: false },
                { name: 'Server Seed', value: `\`${serverSeed}\``, inline: false },
                { name: 'Crash Point', value: `${crashPoint.toFixed(4)}x — SHA256(seed:limbo) first 8 hex → scaled [1, 5]`, inline: false }
            )
            .setFooter({ text: 'SHA256(server_seed) = public_hash · crash = 1 + (int(hash[0:8],16) / 0xFFFFFFFF) × 4' });

        const files = imgBuffer ? [new AttachmentBuilder(imgBuffer, { name: 'limbo.gif' })] : [];
        await message.reply({ embeds: [embed, fairEmbed], files });
    }
};
