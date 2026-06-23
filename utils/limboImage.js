let createCanvas = null;
try {
    const canvasPkg = require('canvas');
    createCanvas = canvasPkg.createCanvas;
    try {
        canvasPkg.registerFont(require('path').join(__dirname, '..', 'fonts', 'Roboto.ttf'), { family: 'Roboto' });
    } catch (fontErr) {
        console.warn('[limboImage] Font registration failed (will use system font):', fontErr.message);
    }
} catch (err) {
    console.error('[limboImage] Canvas failed to load:', err.message);
    createCanvas = null;
}

const GIFEncoder = require('gif-encoder-2');

const W          = 700;
const H          = 320;
const BAR_X      = 60;
const BAR_Y      = 195;
const BAR_W      = W - 120;
const BAR_H      = 22;
const MULT_MIN   = 1.0;
const MULT_MAX   = 5.0;

const ANIM_FRAMES  = 28;   // frames counting up to crash point
const HOLD_FRAMES  = 12;   // frames holding the final result
const ANIM_DELAY   = 55;   // ms per animation frame
const HOLD_DELAY   = 80;   // ms per hold frame

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function multToX(mult) {
    const pct = (Math.min(Math.max(mult, MULT_MIN), MULT_MAX) - MULT_MIN) / (MULT_MAX - MULT_MIN);
    return BAR_X + pct * BAR_W;
}

function drawFrame(ctx, displayMult, target, crashPoint, win, showResult) {
    const accent     = win ? '#00e676' : '#ff1744';
    const dimAccent  = win ? '#004d26' : '#4d0010';

    // ── Background ─────────────────────────────────────────────────────────────
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // border
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, W - 12, H - 12);
    ctx.strokeStyle = dimAccent;
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, W - 24, H - 24);

    // ── Title ──────────────────────────────────────────────────────────────────
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = '#888899';
    ctx.font         = 'bold 18px Roboto';
    ctx.fillText('🚀  L I M B O', W / 2, 36);

    // ── Animated crash point number ─────────────────────────────────────────────
    ctx.font         = 'bold 90px Roboto';
    ctx.fillStyle    = accent;
    ctx.shadowColor  = accent;
    ctx.shadowBlur   = showResult ? 28 : 10;
    ctx.fillText(`${displayMult.toFixed(2)}x`, W / 2, 115);
    ctx.shadowBlur   = 0;

    ctx.font      = '16px Roboto';
    ctx.fillStyle = '#666677';
    ctx.fillText(showResult ? 'CRASH POINT' : 'MULTIPLIER', W / 2, 163);

    // ── Bar track ──────────────────────────────────────────────────────────────
    ctx.fillStyle = '#1e1e30';
    ctx.beginPath();
    ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 11);
    ctx.fill();

    // filled portion up to displayMult
    const fillW = multToX(displayMult) - BAR_X;
    if (fillW > 0) {
        const grad = ctx.createLinearGradient(BAR_X, 0, BAR_X + fillW, 0);
        if (win) { grad.addColorStop(0, '#004d26'); grad.addColorStop(1, '#00e676'); }
        else     { grad.addColorStop(0, '#4d0010'); grad.addColorStop(1, '#ff1744'); }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(BAR_X, BAR_Y, Math.min(fillW, BAR_W), BAR_H, 11);
        ctx.fill();
    }

    // ── Target marker ──────────────────────────────────────────────────────────
    const targetX = multToX(target);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(targetX, BAR_Y - 8);
    ctx.lineTo(targetX, BAR_Y + BAR_H + 8);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle    = '#ffffff';
    ctx.font         = 'bold 13px Roboto';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`TARGET  ${target.toFixed(2)}x`, targetX, BAR_Y + BAR_H + 13);

    // ── Moving dot ─────────────────────────────────────────────────────────────
    const dotX = multToX(displayMult);
    ctx.fillStyle   = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur  = 14;
    ctx.beginPath();
    ctx.arc(dotX, BAR_Y + BAR_H / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;

    // ── Scale labels ───────────────────────────────────────────────────────────
    ctx.fillStyle    = '#555566';
    ctx.font         = '13px Roboto';
    ctx.textBaseline = 'top';
    for (const t of [1, 2, 3, 4, 5]) {
        const tx = multToX(t);
        ctx.textAlign = t === 1 ? 'left' : t === 5 ? 'right' : 'center';
        ctx.fillText(`${t}x`, tx, BAR_Y + BAR_H + 6);
    }

    // ── Result pill (only on hold frames) ──────────────────────────────────────
    if (showResult) {
        const pillW = 150, pillH = 34;
        const pillX = W / 2 - pillW / 2, pillY = H - 52;
        ctx.fillStyle = win ? '#003d20' : '#3d0010';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 17);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 17);
        ctx.stroke();
        ctx.fillStyle    = accent;
        ctx.font         = 'bold 16px Roboto';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(win ? '✅  YOU WON' : '❌  YOU LOST', W / 2, pillY + pillH / 2);
    }
}

/**
 * Build an animated GIF for the limbo result.
 * @param {number} crashPoint  - derived crash multiplier [1.00, 5.00]
 * @param {number} target      - player's chosen target multiplier
 * @param {boolean} win        - true if player won
 * @returns {Buffer}           - animated GIF buffer
 */
function buildLimboGif(crashPoint, target, win) {
    if (!createCanvas) throw new Error('Canvas not available');

    const canvas  = createCanvas(W, H);
    const ctx     = canvas.getContext('2d');

    const encoder = new GIFEncoder(W, H, 'neuquant', true);
    encoder.start();
    encoder.setRepeat(0);

    // ── Animation frames: 1.00x → crashPoint ──────────────────────────────────
    for (let i = 0; i < ANIM_FRAMES; i++) {
        const rawProgress  = i / (ANIM_FRAMES - 1);
        const easedProgress = easeOutCubic(rawProgress);
        const displayMult  = MULT_MIN + easedProgress * (crashPoint - MULT_MIN);

        encoder.setDelay(ANIM_DELAY);
        drawFrame(ctx, displayMult, target, crashPoint, win, false);
        encoder.addFrame(ctx);
    }

    // ── Hold frames: final crash point + result ────────────────────────────────
    for (let i = 0; i < HOLD_FRAMES; i++) {
        encoder.setDelay(HOLD_DELAY);
        drawFrame(ctx, crashPoint, target, crashPoint, win, true);
        encoder.addFrame(ctx);
    }

    encoder.finish();
    return Buffer.from(encoder.out.getData());
}

module.exports = { buildLimboGif };
