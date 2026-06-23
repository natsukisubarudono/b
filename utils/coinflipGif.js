let createCanvas = null;
try {
    const canvasPkg = require('canvas');
    createCanvas = canvasPkg.createCanvas;
    try {
        canvasPkg.registerFont(require('path').join(__dirname, '..', 'fonts', 'Roboto.ttf'), { family: 'Roboto' });
    } catch (fontErr) {
        console.warn('[coinflipGif] Font registration failed (will use system font):', fontErr.message);
    }
} catch (err) {
    console.error('[coinflipGif] Canvas failed to load:', err.message);
    createCanvas = null;
}

const GIFEncoder = require('gif-encoder-2');

const W = 400;
const H = 400;
const CX = W / 2;
const CY = H / 2;
const R  = 150;

const LIME         = '#00ff7f';
const LIME_DIM     = '#004d26';
const PURPLE       = '#b44fff';
const PURPLE_DIM   = '#3b0066';
const COIN_BODY    = '#000000';
const BG           = '#0d0d14';

const ANIM_FRAMES  = 38;   // spinning frames
const HOLD_FRAMES  = 14;   // settled frames
const ANIM_DELAY   = 55;   // ms each
const HOLD_DELAY   = 90;   // ms each

// heads = front face (scaleX > 0), tails = back face (scaleX < 0)
// to land on heads → theta_final = 6π  (cos = 1)
// to land on tails → theta_final = 7π  (cos = −1)
const THETA_FINAL = { heads: 6 * Math.PI, tails: 7 * Math.PI };

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function drawCoin(ctx, scaleX, showLabel, isHold) {
    const absX    = Math.abs(scaleX);
    const isTails = scaleX < 0;
    const label   = isTails ? 'T' : 'H';
    const color   = isTails ? PURPLE     : LIME;
    const colorDim = isTails ? PURPLE_DIM : LIME_DIM;
    const shadowRgb = isTails ? 'rgba(180,79,255,0.07)' : 'rgba(0,255,127,0.07)';

    // ── Background ─────────────────────────────────────────────────────────────
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // subtle grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // ── Coin shadow (stretched ellipse below) ──────────────────────────────────
    ctx.save();
    ctx.translate(CX, CY + R + 12);
    ctx.scale(absX * 1.05, 0.22);
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = shadowRgb;
    ctx.fill();
    ctx.restore();

    // ── Coin body ──────────────────────────────────────────────────────────────
    ctx.save();
    ctx.translate(CX, CY);
    ctx.scale(absX, 1);

    if (isHold) { ctx.shadowColor = color; ctx.shadowBlur = 24; }

    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fillStyle = COIN_BODY;
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth   = 9;
    ctx.stroke();

    ctx.strokeStyle = colorDim;
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R - 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;

    // ── Letter ─────────────────────────────────────────────────────────────────
    if (showLabel && absX > 0.12) {
        const alpha = Math.min(1, (absX - 0.12) / 0.25);
        ctx.globalAlpha  = alpha;
        ctx.fillStyle    = color;
        ctx.font         = `bold ${Math.round(R * 0.88)}px Roboto`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        if (isHold) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
        ctx.fillText(label, 0, 4);
        ctx.shadowBlur  = 0;
        ctx.globalAlpha = 1;
    }

    ctx.restore();

    // ── Bottom label on hold frames ────────────────────────────────────────────
    if (isHold) {
        const word = isTails ? 'TAILS' : 'HEADS';
        ctx.fillStyle    = color;
        ctx.font         = 'bold 22px Roboto';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor  = color;
        ctx.shadowBlur   = 10;
        ctx.fillText(word, CX, H - 22);
        ctx.shadowBlur = 0;
    }
}

/**
 * Build an animated coin-flip GIF that spins then lands on the given result.
 * @param {'heads'|'tails'} result
 * @returns {Buffer} animated GIF
 */
function buildCoinflipGif(result) {
    if (!createCanvas) throw new Error('Canvas not available');

    const canvas   = createCanvas(W, H);
    const ctx      = canvas.getContext('2d');
    const encoder  = new GIFEncoder(W, H, 'neuquant', true);
    encoder.start();
    encoder.setRepeat(0);

    const thetaFinal = THETA_FINAL[result] ?? THETA_FINAL.heads;

    // ── Animation frames ───────────────────────────────────────────────────────
    for (let i = 0; i < ANIM_FRAMES; i++) {
        const progress = easeOutCubic(i / (ANIM_FRAMES - 1));
        const theta    = progress * thetaFinal;
        const scaleX   = Math.cos(theta);          // [-1, 1]

        encoder.setDelay(ANIM_DELAY);
        drawCoin(ctx, scaleX, true, false);
        encoder.addFrame(ctx);
    }

    // ── Hold frames (coin settled on result) ───────────────────────────────────
    const finalScaleX = result === 'heads' ? 1 : -1;
    for (let i = 0; i < HOLD_FRAMES; i++) {
        encoder.setDelay(HOLD_DELAY);
        drawCoin(ctx, finalScaleX, true, true);
        encoder.addFrame(ctx);
    }

    encoder.finish();
    return Buffer.from(encoder.out.getData());
}

module.exports = { buildCoinflipGif };
