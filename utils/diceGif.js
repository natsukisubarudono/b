let createCanvas;
try {
    const canvasPkg = require('canvas');
    createCanvas = canvasPkg.createCanvas;
    canvasPkg.registerFont(require('path').join(__dirname, '..', 'fonts', 'Roboto.ttf'), { family: 'Roboto' });
} catch { createCanvas = null; }

const GIFEncoder = require('gif-encoder-2');

const W  = 560;
const H  = 300;
const BG = '#0d0d14';

const DIE_SIZE = 140;   // px per die face
const P1_CX    = 130;   // player die center x
const P2_CX    = 430;   // bot die center x
const DIE_CY   = 148;   // both dice center y
const CORNER_R = 18;

// Pip positions as [fracX, fracY] within the die face (0..1)
const PIPS = {
    1: [[0.50, 0.50]],
    2: [[0.72, 0.28], [0.28, 0.72]],
    3: [[0.72, 0.28], [0.50, 0.50], [0.28, 0.72]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.50, 0.50], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.50], [0.72, 0.50], [0.28, 0.78], [0.72, 0.78]],
};

const LIME   = '#00ff7f';
const RED    = '#ff1744';
const YELLOW = '#ffd600';
const NEUTRAL= '#4a4a6a';

// Frame schedule: {delay, random} — random=true means show random die faces
const SCHEDULE = [
    ...Array(18).fill({ delay: 250, random: true  }),   // rolling
    { delay: 250, random: false },                       // first glimpse of real result
    ...Array(11).fill({ delay: 250, random: false }),   // hold on result
];

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

function drawDie(ctx, cx, cy, value, borderColor, glowing) {
    const half = DIE_SIZE / 2;
    const x    = cx - half;
    const y    = cy - half;

    // shadow
    ctx.save();
    ctx.shadowColor = borderColor;
    ctx.shadowBlur  = glowing ? 22 : 0;

    // body
    roundRect(ctx, x, y, DIE_SIZE, DIE_SIZE, CORNER_R);
    ctx.fillStyle = '#111120';
    ctx.fill();

    // border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth   = glowing ? 4 : 3;
    roundRect(ctx, x, y, DIE_SIZE, DIE_SIZE, CORNER_R);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.restore();

    // pips
    const pips = PIPS[value] ?? PIPS[1];
    ctx.fillStyle = borderColor;
    for (const [fx, fy] of pips) {
        ctx.beginPath();
        ctx.arc(x + fx * DIE_SIZE, y + fy * DIE_SIZE, DIE_SIZE * 0.072, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFrame(ctx, p, b, win, tie, isResult) {
    // ── Background ─────────────────────────────────────────────────────────────
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // ── Colours ────────────────────────────────────────────────────────────────
    let pColor, bColor;
    if (!isResult) {
        pColor = bColor = NEUTRAL;
    } else if (tie) {
        pColor = bColor = YELLOW;
    } else if (win) {
        pColor = LIME; bColor = RED;
    } else {
        pColor = RED;  bColor = LIME;
    }

    // ── Dice ───────────────────────────────────────────────────────────────────
    drawDie(ctx, P1_CX, DIE_CY, p, pColor, isResult);
    drawDie(ctx, P2_CX, DIE_CY, b, bColor, isResult);

    // ── Labels ─────────────────────────────────────────────────────────────────
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = 'bold 14px Roboto';
    ctx.fillStyle    = '#555566';
    ctx.fillText('YOU', P1_CX, DIE_CY + DIE_SIZE / 2 + 22);
    ctx.fillText('BOT', P2_CX, DIE_CY + DIE_SIZE / 2 + 22);

    // ── VS ─────────────────────────────────────────────────────────────────────
    ctx.font      = 'bold 26px Roboto';
    ctx.fillStyle = isResult ? (tie ? YELLOW : '#555566') : '#333344';
    ctx.fillText('VS', W / 2, DIE_CY);

    // ── Result text on hold frames ─────────────────────────────────────────────
    if (isResult) {
        const resultText = tie ? '🤝 TIE' : win ? '✅ YOU WIN' : '❌ YOU LOSE';
        const resultColor = tie ? YELLOW : win ? LIME : RED;
        ctx.font         = 'bold 20px Roboto';
        ctx.fillStyle    = resultColor;
        ctx.shadowColor  = resultColor;
        ctx.shadowBlur   = 10;
        ctx.fillText(resultText, W / 2, 38);
        ctx.shadowBlur   = 0;

        // die value labels
        ctx.font      = 'bold 16px Roboto';
        ctx.fillStyle = pColor;
        ctx.fillText(`${p}`, P1_CX, DIE_CY - DIE_SIZE / 2 - 18);
        ctx.fillStyle = bColor;
        ctx.fillText(`${b}`, P2_CX, DIE_CY - DIE_SIZE / 2 - 18);
    }
}

/**
 * Build an animated dice-roll GIF.
 * @param {number} playerRoll  1-6
 * @param {number} botRoll     1-6
 * @param {boolean} win
 * @param {boolean} tie
 * @returns {Buffer}
 */
function buildDiceGif(playerRoll, botRoll, win, tie) {
    if (!createCanvas) throw new Error('Canvas not available');

    const canvas  = createCanvas(W, H);
    const ctx     = canvas.getContext('2d');
    const encoder = new GIFEncoder(W, H, 'neuquant', true);
    encoder.start();
    encoder.setRepeat(0);

    for (const { delay, random } of SCHEDULE) {
        const p = random ? Math.ceil(Math.random() * 6) : playerRoll;
        const b = random ? Math.ceil(Math.random() * 6) : botRoll;
        encoder.setDelay(delay);
        drawFrame(ctx, p, b, win, tie, !random);
        encoder.addFrame(ctx);
    }

    encoder.finish();
    return Buffer.from(encoder.out.getData());
}

module.exports = { buildDiceGif };
