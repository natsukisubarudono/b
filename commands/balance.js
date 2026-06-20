const { AttachmentBuilder } = require('discord.js');
const { getUserData } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { generateBalanceImage } = require('../utils/canvas');

module.exports = {
    name: 'balance',
    aliases: ['bal', 'b'],
    async execute(message, args) {
        let targetUser = message.author;
        if (args.length > 0 && message.mentions.users.size > 0) {
            targetUser = message.mentions.users.first();
        }

        const userData = await getUserData(targetUser.id);
        const balance = userData.balance;

        try {
            const imageBuffer = generateBalanceImage(balance, targetUser.username);
            const attachment = new AttachmentBuilder(imageBuffer, { name: 'balance.png' });

            await message.reply({
                content: `${targetUser.username}'s Balance: **${balance} points** (${currencyConvert(balance)})`,
                files: [attachment]
            });
        } catch (error) {
            console.error('Error generating balance image:', error);
            await message.reply(`${targetUser.username}'s balance: **${balance} points** (${currencyConvert(balance)})`);
        }
    }
};
