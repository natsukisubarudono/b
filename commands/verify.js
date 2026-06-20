const { EmbedBuilder } = require('discord.js');
const { verify, verifyMines, deriveDiceRolls, MINES_TOTAL } = require('../utils/provablyFair');
const { PREFIX } = require('../config');

const GRID_COLS = 5;

function renderMineGrid(mineSet) {
    const rows = [];
    for (let r = 0; r < 5; r++) {
        let row = '';
        for (let c = 0; c < GRID_COLS; c++) {
            const idx = r * GRID_COLS + c;
            if (idx >= MINES_TOTAL) { row += '💰'; continue; }
            row += mineSet.has(idx) ? '💣' : '🟩';
        }
        rows.push(row);
    }
    return rows.join('\n');
}

module.exports = {
    name: 'verify',
    async execute(message, args) {
        const gameType   = args[0]?.toLowerCase();
        const publicHash = args[1];
        const serverSeed = args[2];
        const extra      = args[3];

        const usage =
            `❌ Usage:\n` +
            `• Coin flip:   \`${PREFIX}verify coinflip <public_hash> <server_seed>\`\n` +
            `• Minesweeper: \`${PREFIX}verify minesweeper <public_hash> <server_seed> <mine_count>\`\n` +
            `• Dice:        \`${PREFIX}verify dice <public_hash> <server_seed>\``;

        if (!gameType || !publicHash || !serverSeed) return message.reply(usage);

        if (!['coinflip', 'minesweeper', 'dice'].includes(gameType))
            return message.reply(usage);

        if (!/^[0-9a-f]{64}$/i.test(publicHash) || !/^[0-9a-f]{64}$/i.test(serverSeed))
            return message.reply('❌ Both hash and seed must be 64-character hex strings.');

        // ── Minesweeper ────────────────────────────────────────────────────────
        if (gameType === 'minesweeper') {
            if (!extra) return message.reply(`❌ Minesweeper verify requires a mine count.\nUsage: \`${PREFIX}verify minesweeper <public_hash> <server_seed> <mine_count>\``);

            const mineCount = parseInt(extra);
            if (isNaN(mineCount) || mineCount < 1 || mineCount > 23)
                return message.reply('❌ Mine count must be between 1 and 23.');

            const { valid, computed, mineSet } = verifyMines(publicHash, serverSeed, mineCount);

            if (!valid) {
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('🔐 Minesweeper — Verification Failed')
                    .setDescription('The public hash does **not** match this server seed.')
                    .addFields(
                        { name: 'Provided Hash', value: `\`${publicHash}\``, inline: false },
                        { name: 'Computed Hash', value: `\`${computed}\``, inline: false }
                    );
                return message.reply({ embeds: [embed] });
            }

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🔐 Minesweeper — Verified ✅')
                .setDescription(renderMineGrid(mineSet))
                .addFields(
                    { name: 'Public Hash',  value: `\`${publicHash}\``, inline: false },
                    { name: 'Server Seed',  value: `\`${serverSeed}\``,  inline: false },
                    { name: 'Mine Count',   value: `${mineCount}`,       inline: true  }
                )
                .setFooter({ text: '🟩 safe  💣 mine  💰 cashout slot' });

            return message.reply({ embeds: [embed] });
        }

        // ── Dice ──────────────────────────────────────────────────────────────
        if (gameType === 'dice') {
            const computed = require('crypto').createHash('sha256').update(serverSeed).digest('hex');
            const valid = computed === publicHash;

            if (!valid) {
                const embed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('🔐 Dice — Verification Failed')
                    .setDescription('The public hash does **not** match this server seed.')
                    .addFields(
                        { name: 'Provided Hash', value: `\`${publicHash}\``, inline: false },
                        { name: 'Computed Hash', value: `\`${computed}\``,   inline: false }
                    );
                return message.reply({ embeds: [embed] });
            }

            const { playerRoll, botRoll } = deriveDiceRolls(serverSeed);
            const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
            const outcome = playerRoll > botRoll ? '✅ Player wins' : playerRoll < botRoll ? '❌ Bot wins' : '🤝 Tie';

            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('🔐 Dice — Verified ✅')
                .addFields(
                    { name: 'Public Hash',  value: `\`${publicHash}\``,                       inline: false },
                    { name: 'Server Seed',  value: `\`${serverSeed}\``,                        inline: false },
                    { name: 'SHA256(seed)', value: `\`${computed}\``,                          inline: false },
                    { name: 'Your Roll',    value: `${DICE[playerRoll - 1]} **${playerRoll}**`, inline: true  },
                    { name: 'Bot Roll',     value: `${DICE[botRoll - 1]} **${botRoll}**`,       inline: true  },
                    { name: 'Outcome',      value: outcome,                                     inline: true  }
                )
                .setFooter({ text: 'Player: SHA256(seed:player) mod 6 + 1 · Bot: SHA256(seed:bot) mod 6 + 1' });

            return message.reply({ embeds: [embed] });
        }

        // ── Coin flip ──────────────────────────────────────────────────────────
        const { valid, computed, result } = verify(publicHash, serverSeed);

        if (!valid) {
            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('🔐 Coin Flip — Verification Failed')
                .setDescription('The public hash does **not** match this server seed.')
                .addFields(
                    { name: 'Provided Hash', value: `\`${publicHash}\``, inline: false },
                    { name: 'Computed Hash', value: `\`${computed}\``,   inline: false }
                );
            return message.reply({ embeds: [embed] });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🔐 Coin Flip — Verified ✅')
            .setDescription(`The server seed is authentic. The game result was **${result}**.`)
            .addFields(
                { name: 'Public Hash',       value: `\`${publicHash}\``, inline: false },
                { name: 'Server Seed',       value: `\`${serverSeed}\``, inline: false },
                { name: 'SHA256(seed)',       value: `\`${computed}\``,   inline: false },
                { name: 'Result', value: result === 'heads' ? '🟡 Heads' : '⚫ Tails', inline: true }
            )
            .setFooter({ text: 'Result derived from first byte of SHA256(server_seed) — even = heads, odd = tails' });

        return message.reply({ embeds: [embed] });
    }
};
