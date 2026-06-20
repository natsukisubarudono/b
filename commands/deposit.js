const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserData, updateBalance, addDeposited, getDb } = require('../utils/db');
const { deriveLtcAddress, deriveSolAddress } = require('../utils/crypto');
const { currencyConvert } = require('../utils/currency');
const { Connection, PublicKey } = require('@solana/web3.js');

const MNEMONIC         = process.env.LTC_MASTER_MNEMONIC;
const LITOSHIS_PER_LTC = 1e8;
const LAMPORTS_PER_SOL = 1e9;
const MIN_LTC_CONFS    = 5;
const AUTO_CHECK_DELAY = 8 * 60 * 1000;

const SOL_CONNECTION = new Connection('https://api.mainnet-beta.solana.com', 'finalized');

// Track users with a pending auto-check timer
const pendingAutoChecks = new Map();

// ── Address assignment ────────────────────────────────────────────────────────

async function getOrAssignAddresses(userId) {
    const db = getDb();
    let userData = await getUserData(userId);

    // LTC
    if (!userData.deposit_address) {
        const { count } = await db.get("SELECT COUNT(*) as count FROM users WHERE deposit_index IS NOT NULL");
        const address = deriveLtcAddress(MNEMONIC, count);
        await db.run('UPDATE users SET deposit_address = ?, deposit_index = ? WHERE user_id = ?', address, count, userId);
    }

    // SOL
    if (!userData.sol_deposit_address) {
        const { count } = await db.get("SELECT COUNT(*) as count FROM users WHERE sol_deposit_index IS NOT NULL");
        const address = deriveSolAddress(MNEMONIC, count);
        await db.run('UPDATE users SET sol_deposit_address = ?, sol_deposit_index = ? WHERE user_id = ?', address, count, userId);
    }

    return getUserData(userId);
}

// ── Blockchain helpers ────────────────────────────────────────────────────────

const ESPLORA_LTC = 'https://litecoinspace.org/api';

async function getLtcData(address) {
    const [statsRes, txsRes, heightRes] = await Promise.all([
        fetch(`${ESPLORA_LTC}/address/${address}`),
        fetch(`${ESPLORA_LTC}/address/${address}/txs`),
        fetch(`${ESPLORA_LTC}/blocks/tip/height`)
    ]);
    if (!statsRes.ok || !txsRes.ok || !heightRes.ok)
        throw new Error(`Esplora fetch failed (${statsRes.status}/${txsRes.status}/${heightRes.status})`);
    const [stats, txs, tipText] = await Promise.all([statsRes.json(), txsRes.json(), heightRes.text()]);
    return { stats, txs, tipHeight: parseInt(tipText, 10) };
}

async function getSolBalanceLamports(address) {
    return SOL_CONNECTION.getBalance(new PublicKey(address)); // finalized
}

async function getPrices() {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=litecoin,solana&vs_currencies=usd');
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return { ltcUsd: data.litecoin.usd, solUsd: data.solana.usd };
}

function sumLtcReceived(address, txs, tipHeight, minConfs) {
    let confirmed = 0, pending = 0;
    for (const tx of txs) {
        const confs = tx.status?.confirmed ? (tipHeight - tx.status.block_height + 1) : 0;
        for (const out of tx.vout || []) {
            if (out.scriptpubkey_address !== address) continue;
            if (confs >= minConfs) confirmed += out.value;
            else pending += out.value;
        }
    }
    return { confirmed, pending };
}

// ── DM helper ─────────────────────────────────────────────────────────────────

async function sendDepositDm(client, userId, credits) {
    try {
        const user = await client.users.fetch(userId);
        const fields = [];

        if (credits.ltc) {
            fields.push(
                { name: '🪙 LTC Received', value: `${credits.ltc.ltcAmount.toFixed(8)} LTC`, inline: true },
                { name: 'LTC → USD', value: `$${credits.ltc.usd.toFixed(2)}`, inline: true },
                { name: 'LTC Points', value: `+${credits.ltc.points} pts`, inline: true }
            );
        }
        if (credits.sol) {
            fields.push(
                { name: '◎ SOL Received', value: `${credits.sol.solAmount.toFixed(6)} SOL`, inline: true },
                { name: 'SOL → USD', value: `$${credits.sol.usd.toFixed(2)}`, inline: true },
                { name: 'SOL Points', value: `+${credits.sol.points} pts`, inline: true }
            );
        }

        const totalPts = (credits.ltc?.points ?? 0) + (credits.sol?.points ?? 0);
        const userData = await getUserData(userId);

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('💰 Deposit Received!')
            .setDescription('Your deposit has been confirmed and credited to your account.')
            .addFields(
                ...fields,
                { name: 'Total Points Credited', value: `+${totalPts} pts`, inline: true },
                { name: 'New Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: true }
            )
            .setFooter({ text: '1 point = $0.01 • Thank you for your deposit!' });

        await user.send({ embeds: [embed] });
    } catch {
        // DMs disabled — silently ignore
    }
}

// ── Core check logic ──────────────────────────────────────────────────────────

async function runDepositCheck(userId, channel, isAuto = false, client = null) {
    let userData;
    try { userData = await getOrAssignAddresses(userId); }
    catch (err) { console.error('Address error:', err); return; }

    let ltcData, prices;
    try {
        [ltcData, prices] = await Promise.all([
            getLtcData(userData.deposit_address),
            getPrices()
        ]);
    } catch (err) {
        console.error('Price/chain fetch error:', err);
        if (channel) await channel.send(`<@${userId}> ❌ Could not reach the network. Try \`qdepo check\` shortly.`).catch(() => {});
        return;
    }

    let solBalance;
    try { solBalance = await getSolBalanceLamports(userData.sol_deposit_address); }
    catch (err) { console.error('SOL balance error:', err); solBalance = userData.sol_credited_lamports ?? 0; }

    const db = getDb();
    const credits = {};

    // LTC
    const { txs, tipHeight } = ltcData;
    const { confirmed: ltcConfirmed, pending: ltcPending } = sumLtcReceived(userData.deposit_address, txs, tipHeight, MIN_LTC_CONFS);
    const newLtcLitoshis = ltcConfirmed - (userData.credited_litoshis ?? 0);
    if (newLtcLitoshis > 0) {
        const ltcAmount = newLtcLitoshis / LITOSHIS_PER_LTC;
        const usd = ltcAmount * prices.ltcUsd;
        const points = Math.floor(usd * 100);
        if (points >= 1) {
            await updateBalance(userId, points);
            await addDeposited(userId, points);
            await db.run('UPDATE users SET credited_litoshis = ? WHERE user_id = ?', ltcConfirmed, userId);
            credits.ltc = { ltcAmount, usd, points };
        }
    }

    // SOL
    const newLamports = solBalance - (userData.sol_credited_lamports ?? 0);
    if (newLamports > 0) {
        const solAmount = newLamports / LAMPORTS_PER_SOL;
        const usd = solAmount * prices.solUsd;
        const points = Math.floor(usd * 100);
        if (points >= 1) {
            await updateBalance(userId, points);
            await addDeposited(userId, points);
            await db.run('UPDATE users SET sol_credited_lamports = ? WHERE user_id = ?', solBalance, userId);
            credits.sol = { solAmount, usd, points };
        }
    }

    userData = await getUserData(userId);
    const totalPts = (credits.ltc?.points ?? 0) + (credits.sol?.points ?? 0);

    if (totalPts > 0) {
        const fields = [];
        if (credits.ltc) fields.push(
            { name: '🪙 LTC', value: `${credits.ltc.ltcAmount.toFixed(8)} LTC → +${credits.ltc.points} pts`, inline: true }
        );
        if (credits.sol) fields.push(
            { name: '◎ SOL', value: `${credits.sol.solAmount.toFixed(6)} SOL → +${credits.sol.points} pts`, inline: true }
        );
        fields.push({ name: 'New Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: true });

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle(isAuto ? '✅ Auto-Check: Deposit Credited!' : '✅ Deposit Credited!')
            .addFields(...fields)
            .setFooter({ text: '1 point = $0.01' });

        if (channel) await channel.send({ content: `<@${userId}>`, embeds: [embed] }).catch(() => {});
        if (client) await sendDepositDm(client, userId, credits);
        return { credited: true };
    }

    // Pending LTC?
    if (ltcPending > 0) {
        const ltcAmt = ltcPending / LITOSHIS_PER_LTC;
        if (channel && isAuto) {
            await channel.send(`<@${userId}> ⏳ LTC deposit still pending confirmations (~${ltcAmt.toFixed(8)} LTC). Use \`qdepo check\` to retry.`).catch(() => {});
        }
    }

    return { credited: false };
}

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
    name: 'deposit',
    aliases: ['dep', 'depo'],
    async execute(message, args, client) {
        if (!MNEMONIC) return message.reply('❌ Deposit addresses are not configured. Please contact an admin.');

        const userId = message.author.id;
        const sub = args[0]?.toLowerCase();

        // ── qdepo history ─────────────────────────────────────────────────────
        if (sub === 'history') {
            let userData;
            try { userData = await getOrAssignAddresses(userId); }
            catch (err) { return message.reply('❌ Failed to resolve your deposit addresses.'); }

            const loading = await message.reply('📜 Fetching deposit history...');

            const creditedLitoshis = userData.credited_litoshis ?? 0;

            // LTC — live from Esplora
            let ltcLines = [];
            let ltcTotalLitoshis = 0;
            let ltcHasUncredited = false;
            try {
                const [txsRes, heightRes] = await Promise.all([
                    fetch(`${ESPLORA_LTC}/address/${userData.deposit_address}/txs`),
                    fetch(`${ESPLORA_LTC}/blocks/tip/height`)
                ]);
                const [txs, tipText] = await Promise.all([txsRes.json(), heightRes.text()]);
                const tip = parseInt(tipText, 10);

                // Collect TXs with their values
                const txRows = [];
                for (const tx of txs) {
                    const received = (tx.vout || [])
                        .filter(o => o.scriptpubkey_address === userData.deposit_address)
                        .reduce((s, o) => s + o.value, 0);
                    if (received === 0) continue;
                    txRows.push({ tx, received });
                    ltcTotalLitoshis += received;
                }

                // Sort confirmed TXs oldest→newest so running sum matches the credit watermark
                const confirmed = txRows
                    .filter(r => r.tx.status?.confirmed && (tip - r.tx.status.block_height + 1) >= MIN_LTC_CONFS)
                    .sort((a, b) => a.tx.status.block_time - b.tx.status.block_time);
                const pending = txRows.filter(
                    r => !r.tx.status?.confirmed || (tip - r.tx.status.block_height + 1) < MIN_LTC_CONFS
                );

                // Assign CREDITED / NOT CREDITED by running sum against watermark
                let runningSum = 0;
                for (const { tx, received } of confirmed) {
                    runningSum += received;
                    const ltcAmt = (received / LITOSHIS_PER_LTC).toFixed(8);
                    const date = new Date(tx.status.block_time * 1000).toISOString().slice(0, 10);
                    const confs = tip - tx.status.block_height + 1;
                    if (runningSum <= creditedLitoshis) {
                        ltcLines.push(`\`${ltcAmt}\` LTC — ✅ CREDITED — ${date} — \`${tx.txid.slice(0, 12)}...\``);
                    } else {
                        ltcLines.push(`\`${ltcAmt}\` LTC — ⚠️ NOT CREDITED — ${date} — \`${tx.txid.slice(0, 12)}...\``);
                        ltcHasUncredited = true;
                    }
                }

                // Pending (not enough confirmations yet)
                for (const { tx, received } of pending) {
                    const ltcAmt = (received / LITOSHIS_PER_LTC).toFixed(8);
                    const confs = tx.status?.confirmed ? tip - tx.status.block_height + 1 : 0;
                    const date = tx.status?.block_time
                        ? new Date(tx.status.block_time * 1000).toISOString().slice(0, 10)
                        : 'unconfirmed';
                    const confStr = confs > 0 ? `⏳ ${confs}/${MIN_LTC_CONFS} confs` : '⏳ unconfirmed';
                    ltcLines.push(`\`${ltcAmt}\` LTC — ${confStr} — ${date} — \`${tx.txid.slice(0, 12)}...\``);
                }
            } catch (err) {
                ltcLines = ['❌ Could not fetch LTC history.'];
            }

            // SOL — compare live on-chain balance to credited watermark
            let solLines = [];
            const solCredited = userData.sol_credited_lamports ?? 0;
            let solHasUncredited = false;
            try {
                const solOnChain = await getSolBalanceLamports(userData.sol_deposit_address);
                if (solCredited > 0) {
                    solLines.push(`\`${(solCredited / LAMPORTS_PER_SOL).toFixed(6)}\` SOL — ✅ CREDITED`);
                }
                const uncreditedLamports = solOnChain - solCredited;
                if (uncreditedLamports > 0) {
                    solLines.push(`\`${(uncreditedLamports / LAMPORTS_PER_SOL).toFixed(6)}\` SOL — ⚠️ NOT CREDITED`);
                    solHasUncredited = true;
                }
            } catch {
                if (solCredited > 0) {
                    solLines.push(`\`${(solCredited / LAMPORTS_PER_SOL).toFixed(6)}\` SOL — ✅ CREDITED`);
                }
            }

            const ltcSection = ltcLines.length ? ltcLines.join('\n') : '*No LTC deposits found.*';
            const solSection = solLines.length ? solLines.join('\n') : '*No SOL deposits found.*';
            const ltcTotalLtc = (ltcTotalLitoshis / LITOSHIS_PER_LTC).toFixed(8);

            const hasUncredited = ltcHasUncredited || solHasUncredited;
            const footerNote = hasUncredited
                ? 'Run qdepo check to credit any ⚠️ NOT CREDITED deposits'
                : 'All confirmed deposits have been credited';

            const embed = new EmbedBuilder()
                .setColor(hasUncredited ? 0xff9900 : 0x00bfff)
                .setTitle('📜 Deposit History')
                .addFields(
                    { name: '🪙 Litecoin (LTC)', value: ltcSection.slice(0, 1024), inline: false },
                    { name: '◎ Solana (SOL)', value: solSection.slice(0, 1024), inline: false },
                    { name: 'Total LTC On-Chain', value: `${ltcTotalLtc} LTC`, inline: true },
                    { name: 'Account Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: true }
                )
                .setFooter({ text: footerNote });

            return loading.edit({ content: '', embeds: [embed] });
        }

        // ── qdepo check ───────────────────────────────────────────────────────
        if (sub === 'check') {
            const checking = await message.reply('🔍 Checking for deposits on LTC & SOL...');

            let userData;
            try { userData = await getOrAssignAddresses(userId); }
            catch (err) { return checking.edit('❌ Failed to resolve your deposit addresses.'); }

            let ltcData, prices;
            try {
                [ltcData, prices] = await Promise.all([getLtcData(userData.deposit_address), getPrices()]);
            } catch (err) {
                return checking.edit('❌ Could not reach the network. Try again shortly.');
            }

            let solBalance;
            try { solBalance = await getSolBalanceLamports(userData.sol_deposit_address); }
            catch { solBalance = userData.sol_credited_lamports ?? 0; }

            const db = getDb();
            const credits = {};

            // LTC
            const { txs, tipHeight } = ltcData;
            const { confirmed: ltcConfirmed, pending: ltcPending } = sumLtcReceived(userData.deposit_address, txs, tipHeight, MIN_LTC_CONFS);
            const newLtcLitoshis = ltcConfirmed - (userData.credited_litoshis ?? 0);
            if (newLtcLitoshis > 0) {
                const ltcAmount = newLtcLitoshis / LITOSHIS_PER_LTC;
                const usd = ltcAmount * prices.ltcUsd;
                const points = Math.floor(usd * 100);
                if (points >= 1) {
                    await updateBalance(userId, points);
                    await addDeposited(userId, points);
                    await db.run('UPDATE users SET credited_litoshis = ? WHERE user_id = ?', ltcConfirmed, userId);
                    credits.ltc = { ltcAmount, usd, points };
                }
            }

            // SOL
            const newLamports = solBalance - (userData.sol_credited_lamports ?? 0);
            if (newLamports > 0) {
                const solAmount = newLamports / LAMPORTS_PER_SOL;
                const usd = solAmount * prices.solUsd;
                const points = Math.floor(usd * 100);
                if (points >= 1) {
                    await updateBalance(userId, points);
                    await addDeposited(userId, points);
                    await db.run('UPDATE users SET sol_credited_lamports = ? WHERE user_id = ?', solBalance, userId);
                    credits.sol = { solAmount, usd, points };
                }
            }

            userData = await getUserData(userId);
            const totalPts = (credits.ltc?.points ?? 0) + (credits.sol?.points ?? 0);

            if (totalPts > 0) {
                const fields = [];
                if (credits.ltc) fields.push({ name: '🪙 LTC', value: `${credits.ltc.ltcAmount.toFixed(8)} LTC → +${credits.ltc.points} pts`, inline: true });
                if (credits.sol) fields.push({ name: '◎ SOL', value: `${credits.sol.solAmount.toFixed(6)} SOL → +${credits.sol.points} pts`, inline: true });
                fields.push({ name: 'New Balance', value: `${userData.balance} pts (${currencyConvert(userData.balance)})`, inline: true });

                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ Deposit Credited!')
                    .addFields(...fields)
                    .setFooter({ text: '1 point = $0.01' });

                await sendDepositDm(client, userId, credits);
                return checking.edit({ content: '', embeds: [embed] });
            }

            // Pending summary
            const pendingLines = [];
            if (ltcPending > 0) pendingLines.push(`🪙 **${(ltcPending / LITOSHIS_PER_LTC).toFixed(8)} LTC** — waiting for ${MIN_LTC_CONFS}+ confirmations`);
            if (newLamports > 0 && (credits.sol === undefined)) {
                const solAmt = newLamports / LAMPORTS_PER_SOL;
                if (Math.floor(solAmt * prices.solUsd * 100) < 1) {
                    pendingLines.push(`◎ **${solAmt.toFixed(6)} SOL** — too small to credit (< 1 pt)`);
                }
            }

            if (pendingLines.length > 0) {
                const embed = new EmbedBuilder()
                    .setColor(0xff9900)
                    .setTitle('⏳ Deposit Pending')
                    .setDescription(pendingLines.join('\n'))
                    .setFooter({ text: 'Use qdepo check to retry manually' });
                return checking.edit({ content: '', embeds: [embed] });
            }

            const embed = new EmbedBuilder()
                .setColor(0x888888)
                .setTitle('🔍 No New Deposits')
                .setDescription('No uncredited deposits found.')
                .setFooter({ text: 'Use qdepo check to retry' });
            return checking.edit({ content: '', embeds: [embed] });
        }

        // ── qdepo — send addresses to DMs ────────────────────────────────────
        let userData;
        try { userData = await getOrAssignAddresses(userId); }
        catch (err) {
            console.error('Address error:', err);
            return message.reply('❌ Failed to generate deposit addresses. Please contact an admin.');
        }

        const addressEmbed = new EmbedBuilder()
            .setColor(0x00bfff)
            .setTitle('💳 Your Deposit Addresses')
            .addFields(
                { name: '🪙 Litecoin (LTC)', value: `\`${userData.deposit_address}\``, inline: false },
                { name: '◎ Solana (SOL)', value: `\`${userData.sol_deposit_address}\``, inline: false },
                { name: 'Rate', value: '$0.01 = 1 point', inline: true },
                { name: 'LTC Min. Confirmations', value: `${MIN_LTC_CONFS}`, inline: true },
                { name: 'SOL Finality', value: 'Finalized (~13s)', inline: true }
            )
            .setFooter({ text: 'Bot auto-checks in 8 min • Send only the correct coin to each address' });

        const checkRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`depo_check_${userId}`)
                .setLabel('🔍 Check for Deposits')
                .setStyle(ButtonStyle.Primary)
        );

        let dmMessage;
        try {
            const dmChannel = await message.author.createDM();
            dmMessage = await dmChannel.send({ embeds: [addressEmbed], components: [checkRow] });
        } catch {
            return message.reply('❌ I couldn\'t send you a DM. Please enable DMs from server members and try again.');
        }

        await message.reply('📬 Your deposit addresses have been sent to your DMs!');

        // Collector on the DM message to handle the Check button
        const collector = dmMessage.createMessageComponentCollector({
            filter: i => i.customId === `depo_check_${userId}` && i.user.id === userId,
            time: 30 * 60 * 1000, // 30 minutes
        });

        collector.on('collect', async interaction => {
            await interaction.deferUpdate();

            const checking = await dmMessage.channel.send('🔍 Checking for deposits on LTC & SOL...');

            let checkData;
            try { checkData = await getOrAssignAddresses(userId); }
            catch { return checking.edit('❌ Failed to resolve your deposit addresses.'); }

            let ltcData, prices;
            try {
                [ltcData, prices] = await Promise.all([getLtcData(checkData.deposit_address), getPrices()]);
            } catch {
                return checking.edit('❌ Could not reach the network. Try again shortly.');
            }

            let solBalance;
            try { solBalance = await getSolBalanceLamports(checkData.sol_deposit_address); }
            catch { solBalance = checkData.sol_credited_lamports ?? 0; }

            const db = getDb();
            const credits = {};

            const { txs, tipHeight } = ltcData;
            const { confirmed: ltcConfirmed, pending: ltcPending } = sumLtcReceived(checkData.deposit_address, txs, tipHeight, MIN_LTC_CONFS);
            const newLtcLitoshis = ltcConfirmed - (checkData.credited_litoshis ?? 0);
            if (newLtcLitoshis > 0) {
                const ltcAmount = newLtcLitoshis / LITOSHIS_PER_LTC;
                const usd = ltcAmount * prices.ltcUsd;
                const points = Math.floor(usd * 100);
                if (points >= 1) {
                    await updateBalance(userId, points);
                    await addDeposited(userId, points);
                    await db.run('UPDATE users SET credited_litoshis = ? WHERE user_id = ?', ltcConfirmed, userId);
                    credits.ltc = { ltcAmount, usd, points };
                }
            }

            const newLamports = solBalance - (checkData.sol_credited_lamports ?? 0);
            if (newLamports > 0) {
                const solAmount = newLamports / LAMPORTS_PER_SOL;
                const usd = solAmount * prices.solUsd;
                const points = Math.floor(usd * 100);
                if (points >= 1) {
                    await updateBalance(userId, points);
                    await addDeposited(userId, points);
                    await db.run('UPDATE users SET sol_credited_lamports = ? WHERE user_id = ?', solBalance, userId);
                    credits.sol = { solAmount, usd, points };
                }
            }

            const freshData = await getUserData(userId);
            const totalPts = (credits.ltc?.points ?? 0) + (credits.sol?.points ?? 0);

            if (totalPts > 0) {
                const fields = [];
                if (credits.ltc) fields.push({ name: '🪙 LTC', value: `${credits.ltc.ltcAmount.toFixed(8)} LTC → +${credits.ltc.points} pts`, inline: true });
                if (credits.sol) fields.push({ name: '◎ SOL', value: `${credits.sol.solAmount.toFixed(6)} SOL → +${credits.sol.points} pts`, inline: true });
                fields.push({ name: 'New Balance', value: `${freshData.balance} pts (${currencyConvert(freshData.balance)})`, inline: true });

                const creditEmbed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ Deposit Credited!')
                    .addFields(...fields)
                    .setFooter({ text: '1 point = $0.01' });

                return checking.edit({ content: '', embeds: [creditEmbed] });
            }

            if (ltcPending > 0) {
                const pendingEmbed = new EmbedBuilder()
                    .setColor(0xff9900)
                    .setTitle('⏳ Deposit Pending')
                    .setDescription(`🪙 **${(ltcPending / LITOSHIS_PER_LTC).toFixed(8)} LTC** — waiting for ${MIN_LTC_CONFS}+ confirmations`)
                    .setFooter({ text: 'Click Check again to retry' });
                return checking.edit({ content: '', embeds: [pendingEmbed] });
            }

            const noneEmbed = new EmbedBuilder()
                .setColor(0x888888)
                .setTitle('🔍 No New Deposits')
                .setDescription('No uncredited deposits found.')
                .setFooter({ text: 'Click Check again to retry' });
            return checking.edit({ content: '', embeds: [noneEmbed] });
        });

        // Start 8-minute auto-check
        if (!pendingAutoChecks.has(userId)) {
            const timeout = setTimeout(async () => {
                pendingAutoChecks.delete(userId);
                await runDepositCheck(userId, message.channel, true, client);
            }, AUTO_CHECK_DELAY);
            pendingAutoChecks.set(userId, timeout);
        }
    }
};
