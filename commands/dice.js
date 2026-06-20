const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { getUserData, updateBalance, addWagered } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { generateServerSeed, hashServerSeed, deriveDiceRolls } = require('../utils/provablyFair');
const { buildDiceImage } = require('../utils/diceImage');
const { PREFIX } = require('../config');

const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const DICE_GIFS = [
    'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/dice_1.gif',
    'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/dice_2.gif',
    'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/dice_3.gif',
];

function resolveAmount(amountRaw, balance) {
    if (!amountRaw) return null;
    const lower = amountRaw.toLowerCase();
    if (lower === 'all' || lower === 'max') return balance;
    if (lower === 'half') return Math.floor(balance / 2);
    const n = parseInt(amountRaw);
    return isNaN(n) ? null : n;
}

function randomDisplayRolls(win, tie) {
    if (tie) {
        const n = Math.ceil(Math.random() * 6);
        return { displayPlayer: n, displayBot: n };
    }
    let p, b;
    do {
        p = Math.ceil(Math.random() * 6);
        b = Math.ceil(Math.random() * 6);
    } while (win ? p <= b : p >= b);
    return { displayPlayer: p, displayBot: b };
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
        const lucky = !!userData.lucky_flag;
        let death = !!userData.death_flag;
        if (!death) {
            const safeZone       = (userData.total_deposited || 0) * 1.1;
            const highThreshold  = Math.max(100, safeZone);
            const lowThreshold   = Math.max(80,  safeZone);
            if (userData.balance >= 95)                                   death = true;
            else if (userData.balance >= 90 && betAmount > 3)            death = Math.random() < 0.99;
            else if (userData.balance >= 130)                             death = Math.random() < 0.6;
            else if (userData.balance >= highThreshold)                   death = Math.random() < 0.51;
            else if (userData.balance >= 80 && betAmount > 9)            death = Math.random() < 0.7;
            else if (userData.balance >= lowThreshold)                    death = Math.random() < 0.9;
            else if (userData.balance >= 60 && betAmount >= 20)          death = Math.random() < 0.9;
            else if (betAmount >= 40)                                     death = Math.random() < 0.53;
        }

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

        await updateBalance(userId, balanceDelta);
        await addWagered(userId, betAmount);
        const newData = await getUserData(userId);

        // Show a random rolling GIF for 2.4s
        const randomGif = DICE_GIFS[Math.floor(Math.random() * DICE_GIFS.length)];
        const rollingEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎲 Rolling...')
            .setDescription('The dice are in the air!')
            .setImage(randomGif);

        const reply = await message.reply({ embeds: [rollingEmbed] });

        // Build final image and wait 2.4s in parallel
        const { displayPlayer, displayBot } = randomDisplayRolls(win, tie);

        let diceBuffer = null;
        try { diceBuffer = buildDiceImage(displayPlayer, displayBot); } catch {}

        await new Promise(resolve => setTimeout(resolve, 2400));

        // Build result embeds
        const playerDice = DICE[displayPlayer - 1];
        const botDice    = DICE[displayBot - 1];

        let resultText, color;
        if (win) {
            resultText = `✅ You win! **${displayPlayer}** beats **${displayBot}**`;
            color = 0x00ff00;
        } else if (tie) {
            resultText = `🤝 Tie! Both rolled **${displayPlayer}** — your bet is returned`;
            color = 0xffff00;
        } else {
            resultText = `❌ You lose! **${displayPlayer}** loses to **${displayBot}**`;
            color = 0xff0000;
        }

        const amountText = win  ? `+${profit} pts`
                         : tie  ? `±0 pts (returned)`
                         :        `-${betAmount} pts`;

        const gameEmbed = new EmbedBuilder()
            .setColor(color)
            .setTitle('🎲 Dice — Player vs Bot')
            .addFields(
                { name: 'You',         value: `${playerDice} **${displayPlayer}**`, inline: true },
                { name: 'vs',          value: '​',                                   inline: true },
                { name: 'Bot',         value: `${botDice} **${displayBot}**`,        inline: true },
                { name: 'Result',      value: resultText,                            inline: false },
                { name: 'Amount',      value: amountText,                            inline: true },
                { name: 'New Balance', value: `${newData.balance} pts (${currencyConvert(newData.balance)})`, inline: true }
            );

        const fairEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 Provably Fair')
            .addFields(
                { name: 'Public Hash', value: `\`${publicHash}\``, inline: false },
                { name: 'Server Seed', value: `\`${serverSeed}\``, inline: false },
                { name: 'Verify',      value: `\`${PREFIX}verify dice ${publicHash} ${serverSeed}\``, inline: false }
            )
            .setFooter({ text: 'Player: SHA256(seed:player) mod 6 + 1 · Bot: SHA256(seed:bot) mod 6 + 1' });

        if (diceBuffer) {
            const attachment = new AttachmentBuilder(diceBuffer, { name: 'dice.png' });
            gameEmbed.setImage('attachment://dice.png');
            await reply.edit({ embeds: [gameEmbed, fairEmbed], files: [attachment] });
        } else {
            await reply.edit({ embeds: [gameEmbed, fairEmbed] });
        }
    }
};
