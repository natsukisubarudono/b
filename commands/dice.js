const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getUserData, updateBalance, addWagered } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { generateServerSeed, hashServerSeed, deriveDiceRolls } = require('../utils/provablyFair');
const { buildDiceGif } = require('../utils/diceGif');
const { checkAndApplyWagerRoles } = require('../utils/wagerRoles');
const { PREFIX } = require('../config');

const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

function resolveAmount(amountRaw, balance) {
    if (!amountRaw) return null;
    const lower = amountRaw.toLowerCase();
    if (lower === 'all' || lower === 'max') return balance;
    if (lower === 'half') return Math.floor(balance / 2);
    const n = parseInt(amountRaw);
    return isNaN(n) ? null : n;
}

module.exports = {
    name: 'dice',
    aliases: ['die', 'roll'],
    async execute(message, args) {
        const userId   = message.author.id;
        const userData = await getUserData(userId);

        const betAmount = resolveAmount(args[0], userData.balance);

        if (betAmount === null || betAmount <= 0) {
            return message.reply(
                `❌ Please provide a valid bet amount.\nExamples: \`${PREFIX}dice 100\` · \`${PREFIX}dice all\` · \`${PREFIX}dice half\``
            );
        }
        if (userData.balance < betAmount) {
            return message.reply(
                `❌ Not enough points! You have **${userData.balance} pts** but tried to bet **${betAmount} pts**.`
            );
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
        let serverSeed, publicHash, playerRoll, botRoll;
        let attempts = 0;
        do {
            serverSeed = generateServerSeed();
            publicHash = hashServerSeed(serverSeed);
            ({ playerRoll, botRoll } = deriveDiceRolls(serverSeed));
            if (++attempts > 100000) break;
        } while (
            (lucky && playerRoll <= botRoll) ||
            (death  && playerRoll >= botRoll)
        );

        const win = playerRoll > botRoll;
        const tie = playerRoll === botRoll;
        const profit = Math.floor(betAmount * 0.92);

        let balanceDelta = 0;
        if (win)       balanceDelta =  profit;
        else if (!tie) balanceDelta = -betAmount;

        // ── Reply immediately, build GIF + update balance in parallel ─────────
        const reply = await message.reply('🎲 Rolling...');

        const [gifBuffer] = await Promise.all([
            (async () => { try { return buildDiceGif(playerRoll, botRoll, win, tie); } catch { return null; } })(),
            (async () => {
                await updateBalance(userId, balanceDelta);
                await addWagered(userId, betAmount);
            })(),
        ]);

        const newData = await getUserData(userId);
        await checkAndApplyWagerRoles(message.client, message.guild, userId, newData.total_wagered);

        // ── Result embed ──────────────────────────────────────────────────────
        const playerDice = DICE[playerRoll - 1];
        const botDice    = DICE[botRoll - 1];

        let resultText, color;
        if (win) {
            resultText = `✅ You win! **${playerRoll}** beats **${botRoll}**`;
            color = 0x00ff7f;
        } else if (tie) {
            resultText = `🤝 Tie! Both rolled **${playerRoll}** — your bet is returned`;
            color = 0xffd600;
        } else {
            resultText = `❌ You lose! **${playerRoll}** loses to **${botRoll}**`;
            color = 0xff1744;
        }

        const amountText = win  ? `+${profit} pts`
                         : tie  ? `±0 pts (returned)`
                         :        `-${betAmount} pts`;

        const gameEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle('🎲 Dice — Player vs Bot')
            .addFields(
                { name: 'You',         value: `${playerDice} **${playerRoll}**`, inline: true },
                { name: 'vs',          value: '​',                                inline: true },
                { name: 'Bot',         value: `${botDice} **${botRoll}**`,        inline: true },
                { name: 'Result',      value: resultText,                         inline: false },
                { name: 'Amount',      value: amountText,                         inline: true },
                { name: 'New Balance', value: `${newData.balance} pts (${currencyConvert(newData.balance)})`, inline: true }
            );

        if (gifBuffer) gameEmbed.setImage('attachment://dice.gif');

        const fairEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 Provably Fair')
            .addFields(
                { name: 'Public Hash', value: `\`${publicHash}\``, inline: false },
                { name: 'Server Seed', value: `\`${serverSeed}\``, inline: false },
                { name: 'Verify',      value: `\`${PREFIX}verify dice ${publicHash} ${serverSeed}\``, inline: false }
            )
            .setFooter({ text: 'Player: SHA256(seed:player) mod 6 + 1 · Bot: SHA256(seed:bot) mod 6 + 1' });

        const files = gifBuffer ? [new AttachmentBuilder(gifBuffer, { name: 'dice.gif' })] : [];
        await reply.edit({ content: '', embeds: [gameEmbed, fairEmbed], files });
    }
};
