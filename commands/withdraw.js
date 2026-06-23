const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require('discord.js');
const { getUserData, updateBalance } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { randomBytes } = require('crypto');

function fakeTxid() {
    const full = randomBytes(32).toString('hex');
    return `${full.slice(0, 12)}...${full.slice(-9)}`;
}

const WD_LOG_CHANNEL = '1519043574069592135';
const MIN_WITHDRAW   = 100;

// ── Shared: post the log embed in the withdrawal channel ─────────────────────
async function postWithdrawalLog(client, userId, points) {
    try {
        const channel = await client.channels.fetch(WD_LOG_CHANNEL);
        const embed = new EmbedBuilder()
            .setColor(0xff9900)
            .setTitle('💸 Payout Sent')
            .setDescription(`<@${userId}> withdrew **${currencyConvert(points)}** (${points} pts)`)
            .addFields({ name: 'TXID', value: `\`${fakeTxid()}\``, inline: false });
        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error('Could not post withdrawal log:', e);
    }
}

async function postDepositLog(client, userId, points) {
    try {
        const channel = await client.channels.fetch(WD_LOG_CHANNEL);
        const embed = new EmbedBuilder()
            .setColor(0x00ff7f)
            .setTitle('💰 Deposit Received')
            .setDescription(`<@${userId}> deposited **${currencyConvert(points)}** (${points} pts)`)
            .addFields({ name: 'TXID', value: `\`${fakeTxid()}\``, inline: false });
        await channel.send({ embeds: [embed] });
    } catch (e) {
        console.error('Could not post deposit log:', e);
    }
}

// ── Button handler (called from index.js interactionCreate) ───────────────────
async function handleButton(interaction) {
    if (!interaction.customId.startsWith('wd_start_')) return false;
    const ownerId = interaction.customId.replace('wd_start_', '');
    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '❌ This button is not for you.', ephemeral: true });
        return true;
    }

    const modal = new ModalBuilder()
        .setCustomId(`wd_modal_${ownerId}`)
        .setTitle('💸 Withdrawal Request');

    const addressInput = new TextInputBuilder()
        .setCustomId('wd_address')
        .setLabel('LTC or SOL wallet address')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter your LTC or SOL address')
        .setRequired(true)
        .setMinLength(26)
        .setMaxLength(100);

    const amountInput = new TextInputBuilder()
        .setCustomId('wd_amount')
        .setLabel(`Points to withdraw (min ${MIN_WITHDRAW})`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`e.g. 200`)
        .setRequired(true)
        .setMaxLength(10);

    modal.addComponents(
        new ActionRowBuilder().addComponents(addressInput),
        new ActionRowBuilder().addComponents(amountInput),
    );

    await interaction.showModal(modal);
    return true;
}

// ── Modal submit handler (called from index.js interactionCreate) ─────────────
async function handleModal(interaction, client) {
    if (!interaction.customId.startsWith('wd_modal_')) return false;
    const ownerId = interaction.customId.replace('wd_modal_', '');
    if (interaction.user.id !== ownerId) {
        await interaction.reply({ content: '❌ This form is not for you.', ephemeral: true });
        return true;
    }

    const address = interaction.fields.getTextInputValue('wd_address').trim();
    const amountRaw = interaction.fields.getTextInputValue('wd_amount').trim();
    const points = parseInt(amountRaw);

    // ── Validation ────────────────────────────────────────────────────────────
    if (isNaN(points) || points < MIN_WITHDRAW) {
        await interaction.reply({
            content: `❌ Minimum withdrawal is **${MIN_WITHDRAW} points** ($${(MIN_WITHDRAW * 0.01).toFixed(2)}).`,
            ephemeral: true,
        });
        return true;
    }

    const userData = await getUserData(ownerId);
    if (userData.balance < points) {
        await interaction.reply({
            content: `❌ Insufficient balance. You have **${userData.balance} pts** but requested **${points} pts**.`,
            ephemeral: true,
        });
        return true;
    }

    // ── Deduct balance ────────────────────────────────────────────────────────
    await updateBalance(ownerId, -points);
    const newData = await getUserData(ownerId);

    // ── DM confirmation ───────────────────────────────────────────────────────
    const confirmEmbed = new EmbedBuilder()
        .setColor(0x00ff7f)
        .setTitle('✅ Withdrawal Submitted')
        .setDescription('Your withdrawal is processing and will be delivered within **5–15 minutes**.')
        .addFields(
            { name: 'Address',       value: `\`${address}\``,                                                   inline: false },
            { name: 'Amount',        value: `${points} pts (${currencyConvert(points)})`,                        inline: true  },
            { name: 'New Balance',   value: `${newData.balance} pts (${currencyConvert(newData.balance)})`,      inline: true  },
        )
        .setFooter({ text: 'Contact support if your withdrawal does not arrive.' });

    await interaction.reply({ embeds: [confirmEmbed], ephemeral: false });

    // ── Log to withdrawal channel ─────────────────────────────────────────────
    await postWithdrawalLog(client, ownerId, points, address);
    return true;
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
    name: 'withdraw',
    aliases: ['wd', 'cashout'],
    handleButton,
    handleModal,
    postWithdrawalLog,
    postDepositLog,

    async execute(message, _args, client) {
        const userId   = message.author.id;
        const userData = await getUserData(userId);

        const dmEmbed = new EmbedBuilder()
            .setColor(0x00bfff)
            .setTitle('💸 Withdraw Points')
            .setDescription(
                'Click **Start Withdrawal** below to enter your wallet address and the amount you want to withdraw.\n\n' +
                `**Minimum:** ${MIN_WITHDRAW} pts (${currencyConvert(MIN_WITHDRAW)})\n` +
                '**Supported:** LTC · SOL\n' +
                '**Rate:** 1 pt = $0.01\n' +
                '**Processing time:** 5–15 minutes'
            )
            .addFields(
                { name: '💰 Your Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: false }
            )
            .setFooter({ text: 'This link expires in 15 minutes' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`wd_start_${userId}`)
                .setLabel('💸 Start Withdrawal')
                .setStyle(ButtonStyle.Success)
        );

        try {
            const dmChannel = await message.author.createDM();
            await dmChannel.send({ embeds: [dmEmbed], components: [row] });
        } catch {
            return message.reply('❌ I couldn\'t DM you. Please enable DMs from server members and try again.');
        }

        await message.reply('📬 Check your DMs to complete your withdrawal!');
    }
};
