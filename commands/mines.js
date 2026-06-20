const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData, updateBalance, addWagered } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const {
    generateServerSeed, hashServerSeed,
    deriveMineLayout, findLFSeedForMines, findDFSeedForMines,
} = require('../utils/provablyFair');
const { PREFIX } = require('../config');

const activeGames = new Map();
const TOTAL_TILES = 24;
const TIMEOUT_MS = 5 * 60 * 1000;

function calcMultiplier(mines, revealed) {
    let mult = 1.0;
    for (let i = 0; i < revealed; i++) {
        const remaining = TOTAL_TILES - i;
        const safe = (TOTAL_TILES - mines) - i;
        if (safe <= 0) break;
        mult *= (remaining / safe) * 0.97;
    }
    return parseFloat(mult.toFixed(2));
}

function buildRows(game) {
    const rows = [];
    for (let r = 0; r < 5; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < 5; c++) {
            const idx = r * 5 + c;

            if (idx === 24) {
                const mult = calcMultiplier(game.mines, game.revealedCount);
                const payout = Math.floor(game.bet * mult);
                const btn = new ButtonBuilder()
                    .setCustomId(`mines_cashout_${game.id}`)
                    .setLabel(game.revealedCount > 0 ? `💰 ${mult}x · ${payout} pts` : '💰 Cashout')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(game.revealedCount === 0 || game.over);
                row.addComponents(btn);
                continue;
            }

            const tile = game.tiles[idx];
            const btn = new ButtonBuilder().setCustomId(`mines_tile_${game.id}_${idx}`);

            if (tile.revealed) {
                btn.setEmoji('💎').setStyle(ButtonStyle.Primary).setDisabled(true);
            } else if (game.over) {
                if (tile.mine) {
                    btn.setEmoji(tile.hit ? '💥' : '💣').setStyle(ButtonStyle.Danger).setDisabled(true);
                } else {
                    btn.setLabel('​').setStyle(ButtonStyle.Secondary).setDisabled(true);
                }
            } else {
                btn.setLabel('​').setStyle(ButtonStyle.Secondary);
            }

            row.addComponents(btn);
        }
        rows.push(row);
    }
    return rows;
}

function buildGameEmbed(game, status = 'playing') {
    const mult = calcMultiplier(game.mines, game.revealedCount);
    const payout = Math.floor(game.bet * mult);
    const safeTiles = TOTAL_TILES - game.mines;

    const colors   = { playing: 0x5865f2, won: 0x00ff00, lost: 0xff0000, cashout: 0x00ff00, timeout: 0x888888 };
    const titles   = {
        playing: '💣 Minesweeper',
        won:     '🎉 All safe tiles found!',
        lost:    '💥 Mine Hit!',
        cashout: '💰 Cashed Out!',
        timeout: '⏰ Game Timed Out',
    };

    const embed = new EmbedBuilder()
        .setColor(colors[status])
        .setTitle(titles[status])
        .addFields(
            { name: 'Bet',      value: `${game.bet} pts`,           inline: true },
            { name: 'Mines',    value: `${game.mines} / ${TOTAL_TILES}`, inline: true },
            { name: 'Revealed', value: `${game.revealedCount} / ${safeTiles}`, inline: true },
        );

    if (status === 'playing') {
        embed.addFields(
            { name: 'Next Multiplier', value: `${calcMultiplier(game.mines, game.revealedCount + 1)}x`, inline: true },
            { name: 'Current Payout',  value: game.revealedCount > 0 ? `${payout} pts` : '—', inline: true }
        );
        embed.setFooter({ text: 'Click a tile to reveal it • 💰 to cash out' });
    } else if (status === 'cashout' || status === 'won') {
        embed.addFields({ name: 'Payout', value: `+${payout} pts (${mult}x)`, inline: true });
    } else if (status === 'lost') {
        embed.addFields({ name: 'Lost', value: `-${game.bet} pts`, inline: true });
    }

    return embed;
}

function buildFairEmbed(game) {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🔐 Provably Fair')
        .addFields(
            { name: 'Public Hash',  value: `\`${game.publicHash}\``,  inline: false },
            { name: 'Server Seed',  value: `\`${game.serverSeed}\``,  inline: false },
            { name: 'Verify',       value: `\`${PREFIX}verify minesweeper ${game.publicHash} ${game.serverSeed} ${game.mines}\``, inline: false }
        )
        .setFooter({ text: 'Mine positions derived from SHA256(seed:tileIndex) ranking · Use qverify to see the full grid' });
}

async function endGame(game, interaction, status) {
    game.over = true;
    const mult = calcMultiplier(game.mines, game.revealedCount);
    const payout = Math.floor(game.bet * mult);

    if (status === 'cashout' || status === 'won') {
        await updateBalance(game.userId, payout);
    }
    await addWagered(game.userId, game.bet);

    // For LF games: retroactively find a real seed consistent with all revealed tiles being safe
    if (game.lucky && game.revealedCount > 0) {
        const revealedIndices = game.tiles
            .map((t, i) => t.revealed ? i : -1)
            .filter(i => i !== -1);
        try {
            const { serverSeed, publicHash } = findLFSeedForMines(game.mines, revealedIndices);
            game.serverSeed = serverSeed;
            game.publicHash = publicHash;
        } catch {
            // Edge case: leave original seed (very unlikely)
        }
    }

    // For DF games: retroactively find a real seed where the hit tile is a mine
    if (game.death && status === 'lost') {
        const hitIdx = game.tiles.findIndex(t => t.hit);
        if (hitIdx !== -1) {
            try {
                const { serverSeed, publicHash } = findDFSeedForMines(game.mines, hitIdx);
                game.serverSeed = serverSeed;
                game.publicHash = publicHash;
                // Sync the tile layout to match the new seed so the board shown
                // matches what qverify will reproduce
                const newMineSet = deriveMineLayout(serverSeed, game.mines);
                for (let i = 0; i < game.tiles.length; i++) {
                    const wasHit      = game.tiles[i].hit;
                    const wasRevealed = game.tiles[i].revealed;
                    game.tiles[i].mine = newMineSet.has(i);
                    // Preserve revealed (safe) state and hit marker
                    game.tiles[i].revealed = wasRevealed;
                    game.tiles[i].hit = wasHit;
                }
            } catch {
                // Edge case: leave original seed
            }
        }
    }

    if (game.timeout) clearTimeout(game.timeout);
    activeGames.delete(game.id);

    const gameEmbed = buildGameEmbed(game, status);
    const fairEmbed = buildFairEmbed(game);
    const rows = buildRows(game);

    if (interaction) {
        await interaction.update({ embeds: [gameEmbed, fairEmbed], components: rows });
    }
}

async function handleInteraction(interaction) {
    const { customId } = interaction;
    if (!customId.startsWith('mines_')) return false;

    const parts = customId.split('_');

    if (customId.startsWith('mines_tile_')) {
        const gameId = parts[2];
        const tileIdx = parseInt(parts[3]);
        const game = activeGames.get(gameId);

        if (!game || game.over) return interaction.deferUpdate().catch(() => {});
        if (interaction.user.id !== game.userId) {
            return interaction.reply({ content: "❌ This isn't your game!", ephemeral: true });
        }

        const tile = game.tiles[tileIdx];
        if (tile.revealed) return interaction.deferUpdate().catch(() => {});

        // Progressive per-click death flag for bets over 30
        if (!game.death && game.bet > 30 && game.revealedCount >= 1) {
            const clickNum = game.revealedCount + 1;
            const chance = clickNum === 2 ? 0.51
                         : clickNum <= 4  ? 0.52
                         :                  0.55;
            if (Math.random() < chance) game.death = true;
        }

        if (tile.mine && !game.lucky) {
            tile.hit = true;
            await endGame(game, interaction, 'lost');
        } else if (game.death && !tile.revealed) {
            // DF: force this tile to be a mine hit regardless of actual layout
            tile.mine = true;
            tile.hit = true;
            await endGame(game, interaction, 'lost');
        } else {
            // Safe reveal (or LF overrides mine)
            tile.revealed = true;
            game.revealedCount++;
            const safeTileCount = TOTAL_TILES - game.mines;
            if (game.revealedCount === safeTileCount) {
                await endGame(game, interaction, 'won');
            } else {
                const embed = buildGameEmbed(game, 'playing');
                const rows = buildRows(game);
                await interaction.update({ embeds: [embed], components: rows });
            }
        }
        return true;
    }

    if (customId.startsWith('mines_cashout_')) {
        const gameId = parts[2];
        const game = activeGames.get(gameId);

        if (!game || game.over) return interaction.deferUpdate().catch(() => {});
        if (interaction.user.id !== game.userId) {
            return interaction.reply({ content: "❌ This isn't your game!", ephemeral: true });
        }
        if (game.revealedCount === 0) return interaction.deferUpdate().catch(() => {});

        await endGame(game, interaction, 'cashout');
        return true;
    }

    return false;
}

module.exports = {
    name: 'mines',
    aliases: ['minesweeper', 'mf'],
    handleInteraction,
    async execute(message, args) {
        const userId = message.author.id;
        const userData = await getUserData(userId);

        const betArg   = args[0];
        const minesArg = args[1];

        if (!betArg || !minesArg) {
            return message.reply(`❌ Usage: \`${PREFIX}mines <points> <mines>\`\nExample: \`${PREFIX}mines 100 5\``);
        }

        const lower = betArg.toLowerCase();
        let bet;
        if (lower === 'all' || lower === 'max') bet = userData.balance;
        else if (lower === 'half') bet = Math.floor(userData.balance / 2);
        else bet = parseInt(betArg);

        const mines = parseInt(minesArg);

        if (isNaN(bet) || bet <= 0)
            return message.reply('❌ Bet must be a positive number of points, `all`/`max`, or `half`.');
        if (isNaN(mines) || mines < 1 || mines > 23)
            return message.reply('❌ Mines must be between 1 and 23.');
        if (userData.balance < bet)
            return message.reply(`❌ You don't have enough points! Balance: **${userData.balance} pts**`);
        for (const [, g] of activeGames) {
            if (g.userId === userId && !g.over) {
                return message.reply('❌ You already have an active Minesweeper game! Finish it first.');
            }
        }

        await updateBalance(userId, -bet);

        // Generate server seed and derive mine layout from it
        let serverSeed, publicHash, mineSet;
        const lucky = !!userData.lucky_flag;
        let death = !!userData.death_flag;
        if (!death) {
            const safeZone       = (userData.total_deposited || 0) * 1.1;
            const highThreshold  = Math.max(100, safeZone);
            const lowThreshold   = Math.max(80,  safeZone);
            if (userData.balance >= 95)                                   death = true;
            else if (userData.balance >= 90 && bet > 3)                  death = Math.random() < 0.99;
            else if (userData.balance >= 130)                             death = Math.random() < 0.6;
            else if (userData.balance >= highThreshold)                   death = Math.random() < 0.51;
            else if (userData.balance >= 80 && bet > 9)                  death = Math.random() < 0.7;
            else if (userData.balance >= lowThreshold)                    death = Math.random() < 0.9;
            else if (userData.balance >= 60 && bet >= 20)                death = Math.random() < 0.9;
            else if (bet >= 40)                                           death = Math.random() < 0.53;
        }

        serverSeed = generateServerSeed();
        publicHash = hashServerSeed(serverSeed);
        mineSet    = deriveMineLayout(serverSeed, mines);

        const tiles = Array.from({ length: TOTAL_TILES }, (_, i) => ({
            mine:     mineSet.has(i),
            revealed: false,
            hit:      false,
        }));

        const gameId = Math.random().toString(36).slice(2, 10);
        const game = {
            id: gameId, userId, bet, mines, tiles,
            revealedCount: 0, over: false, lucky, death,
            serverSeed, publicHash,
        };

        game.timeout = setTimeout(async () => {
            if (activeGames.has(gameId) && !game.over) {
                game.over = true;
                if (game.revealedCount === 0) await updateBalance(userId, bet);
                activeGames.delete(gameId);
            }
        }, TIMEOUT_MS);

        activeGames.set(gameId, game);

        const embed = buildGameEmbed(game, 'playing');
        const rows  = buildRows(game);

        // Show public hash upfront so players can verify the seed was committed before play
        const fairStartEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🔐 Provably Fair — Committed')
            .setDescription('The mine layout is locked in. The server seed will be revealed when the game ends.')
            .addFields({ name: 'Public Hash', value: `\`${publicHash}\``, inline: false })
            .setFooter({ text: 'Use qverify <hash> <seed> <mines> after the game to verify' });

        await message.reply({ embeds: [embed, fairStartEmbed], components: rows });
    }
};
