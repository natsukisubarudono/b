const { EmbedBuilder } = require('discord.js');
const { getUserData, updateBalance, getDb } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');

module.exports = {
    name: 'redeem',
    aliases: ['code'],
    async execute(message, args) {
        const codeName = args[0]?.toUpperCase();
        if (!codeName) {
            return message.reply('❌ Usage: `qredeem <CODE>`');
        }

        const db = getDb();
        const userId = message.author.id;

        const code = await db.get('SELECT * FROM codes WHERE code_name = ?', codeName);
        if (!code) {
            return message.reply('❌ Invalid code. Please check and try again.');
        }

        if (code.uses_remaining <= 0) {
            return message.reply('❌ This code has already been fully redeemed.');
        }

        const alreadyRedeemed = await db.get(
            'SELECT 1 FROM code_redeems WHERE code_name = ? AND user_id = ?',
            codeName, userId
        );
        if (alreadyRedeemed) {
            return message.reply('❌ You have already redeemed this code.');
        }

        await db.run('UPDATE codes SET uses_remaining = uses_remaining - 1 WHERE code_name = ?', codeName);
        await db.run('INSERT INTO code_redeems (code_name, user_id) VALUES (?, ?)', codeName, userId);
        await updateBalance(userId, code.amount);
        const userData = await getUserData(userId);

        const usesLeft = code.uses_remaining - 1;

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('🎟️ Code Redeemed!')
            .addFields(
                { name: 'Code',        value: `\`${codeName}\``,                                         inline: true },
                { name: 'Reward',      value: `+${code.amount} pts (${currencyConvert(code.amount)})`,   inline: true },
                { name: 'New Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: true },
                { name: 'Uses Left',   value: `${usesLeft}`,                                              inline: true }
            )
            .setFooter({ text: '1 point = $0.01' });

        await message.reply({ embeds: [embed] });
    }
};
