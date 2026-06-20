const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { PREFIX } = require('../config');

const SECTIONS = {
    games: {
        label: '🎮 Games',
        description: 'Gambling & game commands',
        embed: () => new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎮 Games')
            .setDescription('All available game commands')
            .addFields(
                { name: `${PREFIX}cf <heads/tails> <amount>`, value: 'Flip a coin and bet points. Use `h`/`t` for short.', inline: false },
                { name: `${PREFIX}dice <amount>`, value: 'Roll a die against the bot — higher number wins.', inline: false },
                { name: `${PREFIX}mines <amount> <mines>`, value: 'Play Minesweeper. Reveal tiles and cash out before hitting a mine.', inline: false },
            )
            .setFooter({ text: `All games are provably fair • Use ${PREFIX}verify to check results` }),
    },
    balance: {
        label: '💰 Balance',
        description: 'Balance, rewards & profile',
        embed: () => new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('💰 Balance')
            .setDescription('Commands for managing and viewing your balance')
            .addFields(
                { name: `${PREFIX}balance [@user]`,        value: 'Check your balance or another user\'s balance.', inline: false },
                { name: `${PREFIX}daily`,                  value: 'Claim your daily points. Streak bonuses apply!\n1→2→3 pts/day, bonus 5 pts on days 10/20/30.', inline: false },
                { name: `${PREFIX}milestone`,              value: 'View your wager milestones and claim tier rewards.', inline: false },
                { name: `${PREFIX}profile [@user]`,        value: 'View a full profile card with stats and flags.', inline: false },
                { name: `${PREFIX}tip <@user> <amount>`,   value: 'Send points to another user with a confirmation prompt.', inline: false },
            )
            .setFooter({ text: `Aliases: ${PREFIX}bal · ${PREFIX}b · ${PREFIX}ms` }),
    },
    deposit: {
        label: '🏦 Withdraw / Depo',
        description: 'Deposit and withdraw crypto',
        embed: () => new EmbedBuilder()
            .setColor(0xf0a500)
            .setTitle('🏦 Withdraw / Deposit')
            .setDescription('Commands for depositing and withdrawing crypto')
            .addFields(
                { name: `${PREFIX}deposit`,         value: 'Get your personal LTC & SOL deposit addresses and check for pending credits.', inline: false },
                { name: `${PREFIX}deposit check`,   value: 'Manually scan your deposit addresses for new confirmed transactions.', inline: false },
                { name: `${PREFIX}deposit history`, value: 'View your full deposit transaction history.', inline: false },
            )
            .setFooter({ text: 'Points are credited at $0.01 per point • Minimum 1 confirmation' }),
    },
    affiliates: {
        label: '🎟️ Affiliates / Codes',
        description: 'Gift codes and verification',
        embed: () => new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle('🎟️ Affiliates / Codes')
            .setDescription('Redeem codes and verify provably fair results')
            .addFields(
                { name: `${PREFIX}redeem <code>`,                          value: 'Redeem a gift code for points.', inline: false },
                { name: `${PREFIX}verify coinflip <hash> <seed>`,          value: 'Verify a coinflip result.', inline: false },
                { name: `${PREFIX}verify dice <hash> <seed>`,              value: 'Verify a dice result.', inline: false },
                { name: `${PREFIX}verify minesweeper <hash> <seed> <mines>`, value: 'Verify a minesweeper result.', inline: false },
            )
            .setFooter({ text: 'All game outcomes can be independently verified' }),
    },
};

const mainEmbed = () => new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📖 Help')
    .setDescription('Select a category from the dropdown below to view its commands.')
    .addFields(
        { name: '🎮 Games',              value: 'Coinflip, Dice, Mines',               inline: true },
        { name: '💰 Balance',            value: 'Balance, Daily, Milestones, Tip',     inline: true },
        { name: '🏦 Withdraw / Depo',    value: 'Deposit & withdraw crypto',           inline: true },
        { name: '🎟️ Affiliates / Codes', value: 'Gift codes & provably fair verify',  inline: true },
    )
    .setFooter({ text: `Prefix: ${PREFIX}` });

module.exports = {
    name: 'help',
    aliases: ['h'],
    async execute(message) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('help_menu')
            .setPlaceholder('Choose a category...')
            .addOptions(
                { label: '🎮 Games',              value: 'games',      description: 'Coinflip, Dice, Mines' },
                { label: '💰 Balance',            value: 'balance',    description: 'Balance, Daily, Milestones, Tip' },
                { label: '🏦 Withdraw / Depo',    value: 'deposit',    description: 'Deposit & withdraw crypto' },
                { label: '🎟️ Affiliates / Codes', value: 'affiliates', description: 'Gift codes & provably fair verify' },
            );

        const row = new ActionRowBuilder().addComponents(menu);
        const reply = await message.reply({ embeds: [mainEmbed()], components: [row] });

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === message.author.id && i.customId === 'help_menu',
            time: 120_000,
        });

        collector.on('collect', async interaction => {
            const section = SECTIONS[interaction.values[0]];
            if (!section) return interaction.deferUpdate();
            await interaction.update({ embeds: [section.embed()], components: [row] });
        });

        collector.on('end', async () => {
            const disabledMenu = new StringSelectMenuBuilder()
                .setCustomId('help_menu')
                .setPlaceholder('Choose a category...')
                .setDisabled(true)
                .addOptions({ label: 'Expired', value: 'expired', description: 'Run help again' });
            const disabledRow = new ActionRowBuilder().addComponents(disabledMenu);
            await reply.edit({ components: [disabledRow] }).catch(() => {});
        });
    }
};
