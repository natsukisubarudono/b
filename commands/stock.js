const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getUserData, updateBalance, addWagered } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { buildStockGif } = require('../utils/stockGif');
const { checkAndApplyWagerRoles } = require('../utils/wagerRoles');
const { PREFIX } = require('../config');

const DIRECTION = { high: 'high', h: 'high', low: 'low', l: 'low' };

function resolveArgs(args) {
    const a = args[0]?.toLowerCase();
    const b = args[1]?.toLowerCase();
    if (DIRECTION[a]) return { dirRaw: a, amountRaw: b };
    if (DIRECTION[b]) return { dirRaw: b, amountRaw: a };
    return { dirRaw: null, amountRaw: null };
}

function resolveAmount(raw, balance) {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    if (lower === 'all' || lower === 'max') return balance;
    if (lower === 'half') return Math.floor(balance / 2);
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
}

module.exports = {
    name: 'stock',
    aliases: ['stocks', 'st', 'market'],
    async execute(message, args) {
        const userId   = message.author.id;
        const userData = await getUserData(userId);

        const { dirRaw, amountRaw } = resolveArgs(args);
        const choice = DIRECTION[dirRaw];

        if (!choice) {
            return message.reply(
                `❌ Please specify a direction: \`high\`/\`h\` or \`low\`/\`l\`.\n` +
                `Examples: \`${PREFIX}stock 50 high\` · \`${PREFIX}stock low 20\``
            );
        }

        const betAmount = resolveAmount(amountRaw, userData.balance);
        if (betAmount === null || betAmount <= 0) {
            return message.reply(
                `❌ Please provide a valid bet amount.\n` +
                `Examples: \`${PREFIX}stock 50 high\` · \`${PREFIX}stock low all\``
            );
        }

        if (userData.balance < betAmount) {
            return message.reply(
                `❌ You don't have enough points! You have **${userData.balance} pts** but tried to bet **${betAmount} pts**.`
            );
        }

        const profit = Math.floor(betAmount * 0.92);

        // ── Death / lucky flag ────────────────────────────────────────────────
        const lucky = !!userData.lucky_flag;
        let death   = !!userData.death_flag;

        if (!death) {
            const safeZone      = (userData.total_deposited || 0) * 1.1;
            const highThreshold = Math.max(100, safeZone);
            const lowThreshold  = Math.max(80,  safeZone);

            if      (userData.balance + profit >= 100)                death = true;
            else if (userData.balance >= 95)                          death = true;
            else if (userData.balance >= 90 && betAmount > 3)        death = Math.random() < 0.99;
            else if (userData.balance >= 130)                         death = Math.random() < 0.6;
            else if (userData.balance >= highThreshold)               death = Math.random() < 0.51;
            else if (userData.balance >= 80 && betAmount > 9)        death = Math.random() < 0.7;
            else if (userData.balance >= lowThreshold)                death = Math.random() < 0.9;
            else if (userData.balance >= 60 && betAmount >= 20)      death = Math.random() < 0.9;
            else if (betAmount >= 40)                                 death = Math.random() < 0.53;
        }

        // ── Win / loss determination ───────────────────────────────────────────
        const winChance = betAmount > 15 ? 0.48 : 0.50;
        let win;
        if (lucky)      win = true;
        else if (death) win = false;
        else            win = Math.random() < winChance;

        // For "low" the graph going DOWN is a win — invert graph direction
        const graphGoesUp = (choice === 'high') ? win : !win;

        // ── Reply immediately, build GIF + update balance in parallel ─────────
        const reply = await message.reply('📈 Market is moving...');

        const [gifBuffer] = await Promise.all([
            (async () => {
                try { return buildStockGif(graphGoesUp, choice); } catch (e) { console.error('stock gif error:', e); return null; }
            })(),
            (async () => {
                await updateBalance(userId, win ? profit : -betAmount);
                await addWagered(userId, betAmount);
            })(),
        ]);

        const newData = await getUserData(userId);
        await checkAndApplyWagerRoles(message.client, message.guild, userId, newData.total_wagered);

        // ── Result embed ──────────────────────────────────────────────────────
        const dirLabel = choice === 'high' ? '📈 High' : '📉 Low';
        const embed = new EmbedBuilder()
            .setColor(win ? 0x00ff7f : 0xff1744)
            .setTitle('📊 Stock Market')
            .setDescription(
                win
                    ? `The market moved **${choice}** — you called it right!`
                    : `The market moved the wrong way for you!`
            )
            .addFields(
                { name: 'Your Pick',   value: dirLabel,                                                       inline: true },
                { name: 'Result',      value: win ? '✅ You won!' : '❌ You lost!',                           inline: true },
                { name: 'Amount',      value: win ? `+${profit} pts` : `-${betAmount} pts`,                   inline: true },
                { name: 'New Balance', value: `${newData.balance} pts (${currencyConvert(newData.balance)})`, inline: true }
            );

        if (gifBuffer) embed.setImage('attachment://stock.gif');

        const files = gifBuffer ? [new AttachmentBuilder(gifBuffer, { name: 'stock.gif' })] : [];
        await reply.edit({ content: '', embeds: [embed], files });
    }
};
