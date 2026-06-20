const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { getUserData, updateBalance, claimMilestone } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { MILESTONES } = require('../config');

function buildMilestoneEmbed(userData, username) {
    const wagered = userData.total_wagered || 0;
    const claimed = JSON.parse(userData.milestones_claimed || '[]');

    const lines = MILESTONES.map(m => {
        const isClaimed = claimed.includes(m.threshold);
        const isReached = wagered >= m.threshold;
        let status;
        if (isClaimed)       status = '✅ Claimed';
        else if (isReached)  status = '🎁 Ready to claim!';
        else                 status = `🔒 ${wagered}/${m.threshold} wagered`;

        return `${m.emoji} **${m.tier}** — Wager ${m.threshold} pts → +${m.reward} pts (${currencyConvert(m.reward)})\n↳ ${status}`;
    });

    return new EmbedBuilder()
        .setColor(0x00bfff)
        .setTitle('🏅 Wager Milestones')
        .setDescription(lines.join('\n\n'))
        .addFields({ name: 'Total Wagered', value: `${wagered} pts`, inline: true })
        .setFooter({ text: 'Claim buttons expire after 60 seconds' });
}

function buildClaimRows(userData) {
    const wagered = userData.total_wagered || 0;
    const claimed = JSON.parse(userData.milestones_claimed || '[]');

    const claimable = MILESTONES.filter(m => wagered >= m.threshold && !claimed.includes(m.threshold));
    if (claimable.length === 0) return [];

    const rows = [];
    for (let i = 0; i < claimable.length; i += 5) {
        const chunk = claimable.slice(i, i + 5);
        const row = new ActionRowBuilder().addComponents(
            chunk.map(m =>
                new ButtonBuilder()
                    .setCustomId(`ms_claim_${m.threshold}`)
                    .setLabel(`Claim ${m.tier}`)
                    .setEmoji(m.emoji)
                    .setStyle(ButtonStyle.Primary)
            )
        );
        rows.push(row);
    }
    return rows;
}

module.exports = {
    name: 'milestone',
    aliases: ['ms', 'rank', 'ranks'],
    async execute(message) {
        const userId = message.author.id;
        let userData = await getUserData(userId);

        const embed = buildMilestoneEmbed(userData, message.author.username);
        const rows = buildClaimRows(userData);

        const reply = await message.reply({
            embeds: [embed],
            components: rows
        });

        if (rows.length === 0) return;

        const collector = reply.createMessageComponentCollector({
            filter: i => i.user.id === userId,
            time: 60_000
        });

        collector.on('collect', async interaction => {
            const threshold = parseInt(interaction.customId.replace('ms_claim_', ''));
            const milestone = MILESTONES.find(m => m.threshold === threshold);
            if (!milestone) return interaction.reply({ content: '❌ Unknown milestone.', ephemeral: true });

            // Re-check: still claimable?
            userData = await getUserData(userId);
            const claimed = JSON.parse(userData.milestones_claimed || '[]');
            if (claimed.includes(threshold)) {
                return interaction.reply({ content: '❌ You already claimed this milestone.', ephemeral: true });
            }
            if ((userData.total_wagered || 0) < threshold) {
                return interaction.reply({ content: '❌ You haven\'t reached this milestone yet.', ephemeral: true });
            }

            await updateBalance(userId, milestone.reward);
            await claimMilestone(userId, threshold);
            userData = await getUserData(userId);

            const successEmbed = new EmbedBuilder()
                .setColor(0xffd700)
                .setTitle(`${milestone.emoji} ${milestone.tier} Milestone Claimed!`)
                .setDescription(`You claimed the **${milestone.tier}** milestone reward!`)
                .addFields(
                    { name: 'Reward', value: `+${milestone.reward} pts (${currencyConvert(milestone.reward)})`, inline: true },
                    { name: 'New Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: true }
                );

            // Refresh the main embed + buttons
            const updatedEmbed = buildMilestoneEmbed(userData, message.author.username);
            const updatedRows = buildClaimRows(userData);

            await interaction.update({
                embeds: [updatedEmbed],
                components: updatedRows
            });

            await interaction.followUp({ embeds: [successEmbed] });
        });

        collector.on('end', async () => {
            // Disable all buttons when collector expires
            const disabledRows = rows.map(row =>
                new ActionRowBuilder().addComponents(
                    row.components.map(btn =>
                        ButtonBuilder.from(btn).setDisabled(true)
                    )
                )
            );
            await reply.edit({ components: disabledRows }).catch(() => {});
        });
    }
};
