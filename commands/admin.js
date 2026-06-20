const { EmbedBuilder } = require('discord.js');
const { getUserData, updateBalance, resetStreak, resetDailyTimer, setLuckyFlag, setDeathFlag, resetWager, resetUser, getDb } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');
const { deriveLtcKeyPair, deriveSolKeypair } = require('../utils/crypto');
const { sendLtc, LITOSHIS_PER_LTC } = require('../utils/ltcSend');
const { sendSol, LAMPORTS_PER_SOL } = require('../utils/solSend');
const { ADMIN_ROLE_ID, PREFIX } = require('../config');

const MNEMONIC = process.env.LTC_MASTER_MNEMONIC;

function detectCoin(address) {
    if (/^[LMltc]/.test(address)) return 'ltc';
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 'sol';
    return null;
}

const SUBCOMMANDS = ['add', 'remove', 'streakreset', 'dailyreset', 'wagerreset', 'reset', 'lf', 'df', 'send', 'code'];

module.exports = {
    name: 'admin',
    async execute(message, args) {
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID)) {
            return message.reply('❌ You do not have permission to use admin commands.');
        }

        const sub = args[0]?.toLowerCase();

        if (!sub || !SUBCOMMANDS.includes(sub)) {
            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('⚙️ Admin Commands')
                .addFields(
                    { name: `${PREFIX}admin add <@user> <points>`, value: 'Add points to a user', inline: false },
                    { name: `${PREFIX}admin remove <@user> <points>`, value: 'Remove points from a user', inline: false },
                    { name: `${PREFIX}admin streakreset <@user>`, value: "Reset a user's streak to 0", inline: false },
                    { name: `${PREFIX}admin dailyreset <@user>`, value: "Reset a user's daily cooldown so they can claim immediately", inline: false },
                    { name: `${PREFIX}admin wagerreset <@user>`, value: "Reset a user's total wagered to 0", inline: false },
                    { name: `${PREFIX}admin reset <@user>`, value: 'Reset ALL user data (balance, streak, wagered, milestones, flags)', inline: false },
                    { name: `${PREFIX}admin lf <enable/disable> <@user>`, value: 'Toggle lucky flag — user always wins every game', inline: false },
                    { name: `${PREFIX}admin df <enable/disable> <@user>`, value: 'Toggle death flag — user always loses every game', inline: false },
                    { name: `${PREFIX}admin send <points/all> <from_ltc_address> <to_ltc_address>`, value: 'Send LTC from a bot-managed address to any LTC address', inline: false },
                    { name: `${PREFIX}admin code create <NAME> <points> <uses>`, value: 'Create a redeemable gift code', inline: false },
                    { name: `${PREFIX}admin code delete <NAME>`, value: 'Delete a gift code', inline: false }
                );
            return message.reply({ embeds: [embed] });
        }

        // ── send ──────────────────────────────────────────────────────────────
        if (sub === 'send') {
            if (!MNEMONIC) return message.reply('❌ LTC_MASTER_MNEMONIC is not configured.');

            const amountArg = args[1];
            const fromAddress = args[2];
            const toAddress = args[3];

            if (!amountArg || !fromAddress || !toAddress) {
                return message.reply(`❌ Usage: \`${PREFIX}admin send <points/all> <from_address> <to_address>\``);
            }

            const coin = detectCoin(fromAddress);
            if (!coin) return message.reply('❌ Could not detect coin type from the from-address. Expected an LTC or SOL address.');

            const isSweep = amountArg.toLowerCase() === 'all';
            let pointsAmount = null;
            if (!isSweep) {
                pointsAmount = parseInt(amountArg);
                if (isNaN(pointsAmount) || pointsAmount <= 0) {
                    return message.reply('❌ Amount must be a positive number of points or `all`.');
                }
            }

            const db = getDb();
            const status = await message.reply(`⏳ Building ${coin.toUpperCase()} transaction...`);

            try {
                if (coin === 'ltc') {
                    const row = await db.get('SELECT deposit_index FROM users WHERE deposit_address = ?', fromAddress);
                    if (!row || row.deposit_index == null)
                        throw new Error(`Address \`${fromAddress}\` is not assigned to any user in the database.`);

                    const keyPair = deriveLtcKeyPair(MNEMONIC, row.deposit_index);

                    let sendLitoshis;
                    if (isSweep) {
                        sendLitoshis = 'all';
                    } else {
                        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=usd');
                        if (!priceRes.ok) throw new Error(`CoinGecko ${priceRes.status}`);
                        const ltcUsd = (await priceRes.json()).litecoin.usd;
                        sendLitoshis = Math.round((pointsAmount / 100 / ltcUsd) * LITOSHIS_PER_LTC);
                        if (sendLitoshis <= 0) throw new Error('Converted LTC amount is too small to send.');
                    }

                    const { txid, sentLitoshis, feeLitoshis } = await sendLtc(keyPair, toAddress, sendLitoshis);

                    const embed = new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle('✅ LTC Sent')
                        .addFields(
                            { name: 'From', value: `\`${fromAddress}\``, inline: false },
                            { name: 'To', value: `\`${toAddress}\``, inline: false },
                            { name: 'Amount Sent', value: `${(sentLitoshis / LITOSHIS_PER_LTC).toFixed(8)} LTC`, inline: true },
                            { name: 'Network Fee', value: `${(feeLitoshis / LITOSHIS_PER_LTC).toFixed(8)} LTC`, inline: true },
                            { name: 'TXID', value: `[\`${txid}\`](https://litecoinspace.org/tx/${txid})`, inline: false }
                        )
                        .setFooter({ text: `Action by ${message.author.username}` });

                    return status.edit({ content: '', embeds: [embed] });
                }

                if (coin === 'sol') {
                    const row = await db.get('SELECT sol_deposit_index FROM users WHERE sol_deposit_address = ?', fromAddress);
                    if (!row || row.sol_deposit_index == null)
                        throw new Error(`Address \`${fromAddress}\` is not assigned to any user in the database.`);

                    const keypair = deriveSolKeypair(MNEMONIC, row.sol_deposit_index);

                    let sendLamports;
                    if (isSweep) {
                        sendLamports = 'all';
                    } else {
                        const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
                        if (!priceRes.ok) throw new Error(`CoinGecko ${priceRes.status}`);
                        const solUsd = (await priceRes.json()).solana.usd;
                        sendLamports = Math.round((pointsAmount / 100 / solUsd) * LAMPORTS_PER_SOL);
                        if (sendLamports <= 0) throw new Error('Converted SOL amount is too small to send.');
                    }

                    const { txid, sentLamports, feeLamports } = await sendSol(keypair, toAddress, sendLamports);

                    const embed = new EmbedBuilder()
                        .setColor(0x9945ff)
                        .setTitle('✅ SOL Sent')
                        .addFields(
                            { name: 'From', value: `\`${fromAddress}\``, inline: false },
                            { name: 'To', value: `\`${toAddress}\``, inline: false },
                            { name: 'Amount Sent', value: `${(sentLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`, inline: true },
                            { name: 'Network Fee', value: `${(feeLamports / LAMPORTS_PER_SOL).toFixed(6)} SOL`, inline: true },
                            { name: 'TXID', value: `[\`${txid}\`](https://solscan.io/tx/${txid})`, inline: false }
                        )
                        .setFooter({ text: `Action by ${message.author.username}` });

                    return status.edit({ content: '', embeds: [embed] });
                }
            } catch (err) {
                console.error('Admin send error:', err);
                return status.edit(`❌ Transaction failed: ${err.message}`);
            }
        }

        // ── code ──────────────────────────────────────────────────────────────
        if (sub === 'code') {
            const action = args[1]?.toLowerCase();
            const db = getDb();

            if (action === 'create') {
                const codeName = args[2]?.toUpperCase();
                const amount   = parseInt(args[3]);
                const uses     = parseInt(args[4]);

                if (!codeName || isNaN(amount) || isNaN(uses) || amount <= 0 || uses <= 0) {
                    return message.reply(`❌ Usage: \`${PREFIX}admin code create <NAME> <points> <uses>\``);
                }

                const existing = await db.get('SELECT 1 FROM codes WHERE code_name = ?', codeName);
                if (existing) {
                    return message.reply(`❌ A code named \`${codeName}\` already exists. Delete it first.`);
                }

                await db.run(
                    'INSERT INTO codes (code_name, amount, uses_remaining, created_by) VALUES (?, ?, ?, ?)',
                    codeName, amount, uses, message.author.id
                );

                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('🎟️ Code Created')
                    .addFields(
                        { name: 'Code',    value: `\`${codeName}\``,                              inline: true },
                        { name: 'Reward',  value: `${amount} pts (${currencyConvert(amount)})`,   inline: true },
                        { name: 'Uses',    value: `${uses}`,                                       inline: true }
                    )
                    .setFooter({ text: `Created by ${message.author.username}` });

                return message.reply({ embeds: [embed] });
            }

            if (action === 'delete') {
                const codeName = args[2]?.toUpperCase();
                if (!codeName) {
                    return message.reply(`❌ Usage: \`${PREFIX}admin code delete <NAME>\``);
                }

                const code = await db.get('SELECT * FROM codes WHERE code_name = ?', codeName);
                if (!code) {
                    return message.reply(`❌ No code named \`${codeName}\` found.`);
                }

                await db.run('DELETE FROM codes WHERE code_name = ?', codeName);
                await db.run('DELETE FROM code_redeems WHERE code_name = ?', codeName);

                const embed = new EmbedBuilder()
                    .setColor(0xff4444)
                    .setTitle('🗑️ Code Deleted')
                    .addFields(
                        { name: 'Code',         value: `\`${codeName}\``,                              inline: true },
                        { name: 'Reward',        value: `${code.amount} pts`,                           inline: true },
                        { name: 'Uses Remaining', value: `${code.uses_remaining}`,                      inline: true }
                    )
                    .setFooter({ text: `Deleted by ${message.author.username}` });

                return message.reply({ embeds: [embed] });
            }

            return message.reply(`❌ Usage:\n\`${PREFIX}admin code create <NAME> <points> <uses>\`\n\`${PREFIX}admin code delete <NAME>\``);
        }

        // All other subcommands require a mentioned user
        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply(`❌ Please mention a user. Example: \`${PREFIX}admin ${sub} @user${sub === 'add' || sub === 'remove' ? ' <points>' : ''}\``);
        }

        const userData = await getUserData(targetUser.id);

        if (sub === 'add' || sub === 'remove') {
            const points = parseInt(args[2]);
            if (isNaN(points) || points <= 0) {
                return message.reply('❌ Please provide a valid positive number of points.');
            }

            const delta = sub === 'add' ? points : -points;
            const newBalance = userData.balance + delta;

            if (newBalance < 0) {
                return message.reply(`❌ This would put **${targetUser.username}**'s balance below 0 (current: ${userData.balance} pts).`);
            }

            await updateBalance(targetUser.id, delta);
            const updated = await getUserData(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(sub === 'add' ? 0x00ff00 : 0xff4444)
                .setTitle(`⚙️ Balance ${sub === 'add' ? 'Added' : 'Removed'}`)
                .addFields(
                    { name: 'User', value: targetUser.username, inline: true },
                    { name: 'Amount', value: `${sub === 'add' ? '+' : '-'}${points} pts`, inline: true },
                    { name: 'New Balance', value: `${updated.balance} points (${currencyConvert(updated.balance)})`, inline: true }
                )
                .setFooter({ text: `Action by ${message.author.username}` });

            return message.reply({ embeds: [embed] });
        }

        if (sub === 'streakreset') {
            await resetStreak(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('⚙️ Streak Reset')
                .setDescription(`**${targetUser.username}**'s streak has been reset to 0.`)
                .setFooter({ text: `Action by ${message.author.username}` });

            return message.reply({ embeds: [embed] });
        }

        if (sub === 'dailyreset') {
            await resetDailyTimer(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('⚙️ Daily Reset')
                .setDescription(`**${targetUser.username}**'s daily cooldown has been cleared. They can claim their daily reward immediately.`)
                .setFooter({ text: `Action by ${message.author.username}` });

            return message.reply({ embeds: [embed] });
        }

        if (sub === 'reset') {
            const before = { ...userData };
            await resetUser(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(0xff0000)
                .setTitle('⚙️ User Data Reset')
                .setDescription(`**${targetUser.username}**'s account has been fully reset.`)
                .addFields(
                    { name: 'Balance',    value: `${before.balance || 0} pts → 0 pts`,       inline: true },
                    { name: 'Wagered',    value: `${before.total_wagered || 0} pts → 0 pts`, inline: true },
                    { name: 'Streak',     value: `${before.streak || 0} → 0`,                inline: true },
                    { name: 'Milestones', value: 'Cleared',                                   inline: true },
                    { name: 'Flags',      value: 'LF & DF disabled',                          inline: true }
                )
                .setFooter({ text: `Action by ${message.author.username} • Deposit addresses preserved` });

            return message.reply({ embeds: [embed] });
        }

        if (sub === 'wagerreset') {
            const before = userData.total_wagered || 0;
            await resetWager(targetUser.id);

            const embed = new EmbedBuilder()
                .setColor(0xff9900)
                .setTitle('⚙️ Wager Reset')
                .setDescription(`**${targetUser.username}**'s total wagered has been reset to 0.`)
                .addFields(
                    { name: 'Previous Wagered', value: `${before} pts (${currencyConvert(before)})`, inline: true },
                    { name: 'New Wagered', value: '0 pts', inline: true }
                )
                .setFooter({ text: `Action by ${message.author.username}` });

            return message.reply({ embeds: [embed] });
        }

        if (sub === 'lf') {
            const state = args[1]?.toLowerCase();
            if (!state || !['enable', 'disable'].includes(state)) {
                return message.reply(`❌ Please specify \`enable\` or \`disable\`. Example: \`${PREFIX}admin lf enable @user\``);
            }

            const enabled = state === 'enable';
            await setLuckyFlag(targetUser.id, enabled);

            const embed = new EmbedBuilder()
                .setColor(enabled ? 0x00ff00 : 0xff4444)
                .setTitle('⚙️ Lucky Flag')
                .setDescription(`Lucky flag has been **${enabled ? 'enabled' : 'disabled'}** for **${targetUser.username}**.\n${enabled ? '🍀 They will now always win every game.' : '🎲 They are back to normal odds.'}`)
                .setFooter({ text: `Action by ${message.author.username}` });

            return message.reply({ embeds: [embed] });
        }

        if (sub === 'df') {
            const state = args[1]?.toLowerCase();
            if (!state || !['enable', 'disable'].includes(state)) {
                return message.reply(`❌ Please specify \`enable\` or \`disable\`. Example: \`${PREFIX}admin df enable @user\``);
            }

            const enabled = state === 'enable';
            await setDeathFlag(targetUser.id, enabled);

            const embed = new EmbedBuilder()
                .setColor(enabled ? 0xff0000 : 0x00ff00)
                .setTitle('⚙️ Death Flag')
                .setDescription(`Death flag has been **${enabled ? 'enabled' : 'disabled'}** for **${targetUser.username}**.\n${enabled ? '💀 They will now lose every game.' : '🎲 They are back to normal odds.'}`)
                .setFooter({ text: `Action by ${message.author.username}` });

            return message.reply({ embeds: [embed] });
        }
    }
};
