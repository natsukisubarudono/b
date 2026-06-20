const { EmbedBuilder } = require('discord.js');
const { getUserData, updateBalance, updateStreak } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');

const MILESTONE_DAYS = [10, 20, 30];

function getDailyReward(streak) {
    if (MILESTONE_DAYS.includes(streak)) return 5;
    if (streak >= 3) return 3;
    return streak; // day 1 = 1p, day 2 = 2p
}

module.exports = {
    name: 'daily',
    async execute(message) {
        const userId = message.author.id;
        const userData = await getUserData(userId);
        const now = new Date();
        const lastDaily = userData.last_daily ? new Date(userData.last_daily) : null;

        if (lastDaily) {
            const hoursSince = (now - lastDaily) / (1000 * 60 * 60);

            if (hoursSince < 24) {
                const remaining = 24 - hoursSince;
                const hours = Math.floor(remaining);
                const minutes = Math.floor((remaining - hours) * 60);
                const currentStreak = userData.streak || 0;
                return message.reply(
                    `⏰ You've already claimed your daily reward! Come back in **${hours}h ${minutes}m**.\n` +
                    `Current streak: 🔥 **${currentStreak}** day${currentStreak !== 1 ? 's' : ''}`
                );
            }

            // Missed more than 48h — streak resets
            if (hoursSince > 48) {
                userData.streak = 0;
            }
        }

        const newStreak = (userData.streak || 0) + 1;
        const reward = getDailyReward(newStreak);
        const isMilestone = MILESTONE_DAYS.includes(newStreak);

        await updateBalance(userId, reward);
        await updateStreak(userId, newStreak);
        const newBalance = (await getUserData(userId)).balance;

        const nextMilestone = MILESTONE_DAYS.find(m => m > newStreak);
        const streakFooter = nextMilestone
            ? `Next milestone bonus at day ${nextMilestone} 🎯`
            : 'Keep collecting your daily rewards!';

        const embed = new EmbedBuilder()
            .setColor(isMilestone ? 0xffd700 : 0x00ff00)
            .setTitle(isMilestone ? '🏆 Milestone Bonus!' : '🎉 Daily Reward Claimed!')
            .setDescription(
                isMilestone
                    ? `🌟 Day **${newStreak}** milestone! You received a bonus **${reward} points** (${currencyConvert(reward)})!`
                    : `You received **${reward} point${reward !== 1 ? 's' : ''}** (${currencyConvert(reward)})!`
            )
            .addFields(
                { name: '🔥 Streak', value: `${newStreak} day${newStreak !== 1 ? 's' : ''}`, inline: true },
                { name: '💰 New Balance', value: `${newBalance} points (${currencyConvert(newBalance)})`, inline: true },
                { name: '⏰ Next Daily', value: 'Available in 24 hours', inline: true }
            )
            .setFooter({ text: streakFooter });

        await message.reply({ embeds: [embed] });
    }
};
