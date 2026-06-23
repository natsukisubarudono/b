const { EmbedBuilder } = require('discord.js');
const { getDb } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');

module.exports = {
    name: 'housebalance',
    aliases: ['hb'],
    async execute(message) {
        const db = getDb();

        const { total, users } = await db.get(
            'SELECT SUM(balance) AS total, COUNT(*) AS users FROM users WHERE balance > 0'
        );

        const totalPts = total ?? 0;

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🏦 House Balance')
            .addFields(
                { name: 'Total Economy',  value: `**${totalPts.toLocaleString()} pts**\n${currencyConvert(totalPts)}`, inline: true },
                { name: 'Active Accounts', value: `${users}`,                                                           inline: true },
            )
            .setFooter({ text: '1 pt = $0.01' });

        return message.reply({ embeds: [embed] });
    }
};
