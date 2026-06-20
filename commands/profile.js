const { EmbedBuilder } = require('discord.js');
const { getUserData } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { MILESTONES } = require('../config');

function getMilestoneRank(wagered, claimed) {
    const reached = MILESTONES.filter(m => wagered >= m.threshold);
    if (reached.length === 0) return null;
    return reached[reached.length - 1];
}

function getNextMilestone(wagered) {
    return MILESTONES.find(m => wagered < m.threshold) || null;
}

module.exports = {
    name: 'profile',
    aliases: ['prof', 'p', 'stats'],
    async execute(message, args) {
        let targetUser = message.author;
        if (args.length > 0 && message.mentions.users.size > 0) {
            targetUser = message.mentions.users.first();
        }

        const userData = await getUserData(targetUser.id);
        const balance       = userData.balance        || 0;
        const wagered       = userData.total_wagered  || 0;
        const streak        = userData.streak         || 0;
        const claimed       = JSON.parse(userData.milestones_claimed || '[]');
        const luckyFlag     = !!userData.lucky_flag;
        const deathFlag     = !!userData.death_flag;

        const currentRank = getMilestoneRank(wagered, claimed);
        const nextRank    = getNextMilestone(wagered);

        const rankValue = currentRank
            ? `${currentRank.emoji} ${currentRank.tier}`
            : '🔒 Unranked';

        const progressValue = nextRank
            ? `${wagered} / ${nextRank.threshold} pts → ${nextRank.emoji} ${nextRank.tier}`
            : '🏆 Max rank reached!';

        const claimedCount = claimed.length;
        const totalMilestones = MILESTONES.length;
        const unclaimedReady = MILESTONES.filter(
            m => wagered >= m.threshold && !claimed.includes(m.threshold)
        ).length;

        const flags = [];
        if (luckyFlag) flags.push('🍀 Lucky');
        if (deathFlag) flags.push('💀 Death');

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`👤 ${targetUser.username}'s Profile`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '💰 Balance',       value: `${balance} pts\n${currencyConvert(balance)}`,       inline: true },
                { name: '🎲 Total Wagered', value: `${wagered} pts\n${currencyConvert(wagered)}`,       inline: true },
                { name: '📅 Daily Streak',  value: `${streak} day${streak !== 1 ? 's' : ''}`,           inline: true },
                { name: '🏅 Current Rank',  value: rankValue,                                            inline: true },
                { name: '📈 Next Rank',     value: progressValue,                                        inline: true },
                { name: '🎖️ Milestones',   value: `${claimedCount} / ${totalMilestones} claimed${unclaimedReady > 0 ? `\n⚠️ ${unclaimedReady} ready to claim!` : ''}`, inline: true },
            );

        if (flags.length > 0) {
            embed.addFields({ name: '⚙️ Active Flags', value: flags.join('  '), inline: false });
        }

        embed.setFooter({ text: '1 point = $0.01' });

        await message.reply({ embeds: [embed] });
    }
};
