const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData, updateBalance } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { PREFIX } = require('../config');

function resolveAmount(amountRaw, balance) {
    if (!amountRaw) return null;
    const lower = amountRaw.toLowerCase();
    if (lower === 'all' || lower === 'max') return balance;
    if (lower === 'half') return Math.floor(balance / 2);
    const n = parseInt(amountRaw);
    return isNaN(n) ? null : n;
}

module.exports = {
    name: 'tip',
    async execute(message, args) {
        const sender = message.author;
        const target = message.mentions.users.first();

        if (!target) {
            return message.reply(`❌ Please mention a user to tip.\nUsage: \`${PREFIX}tip <@user> <amount>\``);
        }
        if (target.id === sender.id) {
            return message.reply(`❌ You can't tip yourself.`);
        }
        if (target.bot) {
            return message.reply(`❌ You can't tip a bot.`);
        }

        const amountRaw = args.find(a => !a.startsWith('<@'));
        const senderData = await getUserData(sender.id);
        const amount = resolveAmount(amountRaw, senderData.balance);

        if (amount === null || amount <= 0) {
            return message.reply(`❌ Please provide a valid amount.\nUsage: \`${PREFIX}tip <@user> <amount>\``);
        }
        if (senderData.balance < amount) {
            return message.reply(`❌ You don't have enough points! You have **${senderData.balance} pts** but tried to tip **${amount} pts**.`);
        }

        const confirmEmbed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('💸 Confirm Tip')
            .setDescription(`Are you sure you want to tip **${target.username}** **${amount} pts** (${currencyConvert(amount)})?`)
            .addFields(
                { name: 'From', value: sender.username, inline: true },
                { name: 'To',   value: target.username, inline: true },
                { name: 'Amount', value: `${amount} pts`, inline: true }
            )
            .setFooter({ text: 'This prompt expires in 30 seconds.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('tip_yes')
                .setLabel('Yes')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('tip_no')
                .setLabel('No')
                .setStyle(ButtonStyle.Danger)
        );

        const reply = await message.reply({ embeds: [confirmEmbed], components: [row] });

        let collector;
        try {
            collector = reply.createMessageComponentCollector({
                filter: i => i.user.id === sender.id,
                time: 30000,
                max: 1,
            });
        } catch {
            return;
        }

        collector.on('collect', async interaction => {
            await interaction.deferUpdate();

            if (interaction.customId === 'tip_yes') {
                // Re-check balance in case it changed
                const freshData = await getUserData(sender.id);
                if (freshData.balance < amount) {
                    const failEmbed = new EmbedBuilder()
                        .setColor(0xff0000)
                        .setTitle('❌ Tip Failed')
                        .setDescription(`You no longer have enough points to send this tip.`);
                    return reply.edit({ embeds: [failEmbed], components: [] });
                }

                await updateBalance(sender.id, -amount);
                await updateBalance(target.id,  amount);

                const senderNew = await getUserData(sender.id);
                const targetNew = await getUserData(target.id);

                const successEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ Tip Sent!')
                    .setDescription(`**${sender.username}** tipped **${target.username}** **${amount} pts** (${currencyConvert(amount)})!`)
                    .addFields(
                        { name: `${sender.username}'s new balance`, value: `${senderNew.balance} pts`, inline: true },
                        { name: `${target.username}'s new balance`, value: `${targetNew.balance} pts`, inline: true }
                    );

                await reply.edit({ embeds: [successEmbed], components: [] });

            } else {
                const cancelEmbed = new EmbedBuilder()
                    .setColor(0xff0000)
                    .setTitle('❌ Tip Cancelled')
                    .setDescription('The tip was cancelled.');
                await reply.edit({ embeds: [cancelEmbed], components: [] });
            }
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                const expiredEmbed = new EmbedBuilder()
                    .setColor(0x888888)
                    .setTitle('⏰ Tip Expired')
                    .setDescription('No response received. The tip was cancelled.');
                await reply.edit({ embeds: [expiredEmbed], components: [] }).catch(() => {});
            }
        });
    }
};
