const { AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const { getDb } = require('../utils/db');
const { currencyConvert } = require('../utils/currency');

const W         = 720;
const ROW_H     = 72;
const HEADER_H  = 90;
const PADDING   = 20;
const AVATAR_R  = 26; // radius
const MAX_ROWS  = 10;

const BG        = '#0f1117';
const ROW_EVEN  = '#16191f';
const ROW_ODD   = '#1a1d25';
const GOLD      = '#ffd700';
const SILVER    = '#c0c0c0';
const BRONZE    = '#cd7f32';
const TEXT_DIM  = '#7a8096';
const TEXT_MAIN = '#e8eaf6';
const ACCENT    = '#5865f2';

function rankColor(i) {
    if (i === 0) return GOLD;
    if (i === 1) return SILVER;
    if (i === 2) return BRONZE;
    return TEXT_DIM;
}

function rankLabel(i) {
    return ['🥇', '🥈', '🥉'][i] ?? `#${i + 1}`;
}

async function fetchAvatar(user) {
    const hash = user.avatar;
    const url  = hash
        ? `https://cdn.discordapp.com/avatars/${user.id}/${hash}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(user.id) % 5n)}.png`;
    try {
        return await loadImage(url);
    } catch {
        return null;
    }
}

function drawRoundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function clipCircle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
}

async function buildLeaderboardImage(entries) {
    const totalH = HEADER_H + entries.length * ROW_H + PADDING;
    const canvas = createCanvas(W, totalH);
    const ctx    = canvas.getContext('2d');

    // ── Background ──────────────────────────────────────────────────────────
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, totalH);

    // ── Header ───────────────────────────────────────────────────────────────
    ctx.fillStyle = ACCENT;
    ctx.fillRect(0, 0, W, HEADER_H);

    ctx.font        = 'bold 30px sans-serif';
    ctx.fillStyle   = '#ffffff';
    ctx.textAlign   = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆  TOP 10 LEADERBOARD', W / 2, HEADER_H / 2);

    // ── Rows ─────────────────────────────────────────────────────────────────
    for (let i = 0; i < entries.length; i++) {
        const { member, balance } = entries[i];
        const y = HEADER_H + i * ROW_H;

        // Row background
        ctx.fillStyle = i % 2 === 0 ? ROW_EVEN : ROW_ODD;
        ctx.fillRect(0, y, W, ROW_H);

        // Top-3 left accent bar
        if (i < 3) {
            ctx.fillStyle = rankColor(i);
            ctx.fillRect(0, y, 4, ROW_H);
        }

        const midY = y + ROW_H / 2;

        // ── Rank label ───────────────────────────────────────────────────────
        ctx.font      = i < 3 ? 'bold 22px sans-serif' : 'bold 18px sans-serif';
        ctx.fillStyle = rankColor(i);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rankLabel(i), PADDING + 20, midY);

        // ── Avatar ───────────────────────────────────────────────────────────
        const avatarX = PADDING + 56;
        const avatarY = midY;

        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarX, avatarY, AVATAR_R, 0, Math.PI * 2);
        ctx.fillStyle = '#2e3148';
        ctx.fill();
        ctx.clip();
        if (member._avatarImg) {
            ctx.drawImage(member._avatarImg, avatarX - AVATAR_R, avatarY - AVATAR_R, AVATAR_R * 2, AVATAR_R * 2);
        }
        ctx.restore();

        // Avatar ring for top 3
        if (i < 3) {
            ctx.strokeStyle = rankColor(i);
            ctx.lineWidth   = 2.5;
            ctx.beginPath();
            ctx.arc(avatarX, avatarY, AVATAR_R + 1.5, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Username ─────────────────────────────────────────────────────────
        const username = member.displayName ?? member.user?.username ?? 'Unknown';
        ctx.font         = 'bold 18px sans-serif';
        ctx.fillStyle    = TEXT_MAIN;
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';

        // Clamp username width
        let displayName = username;
        while (ctx.measureText(displayName).width > 320 && displayName.length > 4) {
            displayName = displayName.slice(0, -1);
        }
        if (displayName !== username) displayName += '…';
        ctx.fillText(displayName, avatarX + AVATAR_R + 14, midY - 8);

        // Discord tag subtle
        ctx.font      = '13px sans-serif';
        ctx.fillStyle = TEXT_DIM;
        ctx.fillText(`@${member.user?.username ?? ''}`, avatarX + AVATAR_R + 14, midY + 10);

        // ── Balance ───────────────────────────────────────────────────────────
        ctx.textAlign = 'right';
        ctx.font      = 'bold 20px sans-serif';
        ctx.fillStyle = i < 3 ? rankColor(i) : TEXT_MAIN;
        ctx.textBaseline = 'middle';
        ctx.fillText(`${balance.toLocaleString()} pts`, W - PADDING, midY - 8);

        ctx.font      = '13px sans-serif';
        ctx.fillStyle = TEXT_DIM;
        ctx.fillText(currencyConvert(balance), W - PADDING, midY + 10);
    }

    // ── Footer line ───────────────────────────────────────────────────────────
    ctx.fillStyle = ACCENT + '44';
    ctx.fillRect(0, totalH - PADDING, W, PADDING);
    ctx.font         = '12px sans-serif';
    ctx.fillStyle    = TEXT_DIM;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('1 pt = $0.01  •  Server members only', W / 2, totalH - PADDING / 2);

    return canvas.toBuffer('image/png');
}

module.exports = {
    name: 'leaderboard',
    aliases: ['lb', 'top'],
    async execute(message) {
        const guild = message.guild;
        if (!guild) return message.reply('❌ This command can only be used in a server.');

        const status = await message.reply('📊 Building leaderboard...');

        const db   = getDb();
        // Fetch more than 10 to account for users not in guild
        const rows = await db.all(
            'SELECT user_id, balance FROM users WHERE balance > 0 ORDER BY balance DESC LIMIT 100'
        );

        const entries = [];
        for (const row of rows) {
            if (entries.length >= MAX_ROWS) break;
            try {
                const member = await guild.members.fetch(row.user_id);
                // Pre-load avatar
                member._avatarImg = await fetchAvatar(member.user).catch(() => null);
                entries.push({ member, balance: row.balance });
            } catch {
                // Not in server — skip
            }
        }

        if (entries.length === 0) {
            return status.edit('❌ No members with a balance found in this server.');
        }

        const imgBuffer = await buildLeaderboardImage(entries);
        const file      = new AttachmentBuilder(imgBuffer, { name: 'leaderboard.png' });

        await status.edit({
            content: '',
            files: [file],
        });
    }
};
