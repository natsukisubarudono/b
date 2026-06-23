let createCanvas;
try { createCanvas = require('canvas').createCanvas; } catch { createCanvas = null; }

const GIFEncoder = require('gif-encoder-2');

const W = 640;
const H = 320;

const GRAPH_L  = 52;   // left margin
const GRAPH_R  = W - 22;
const GRAPH_T  = 54;
const GRAPH_B  = H - 52;
const BASELINE = (GRAPH_T + GRAPH_B) / 2;   // 141
const MAX_DEV  = (GRAPH_B - GRAPH_T) / 2 - 8; // max px deviation from baseline

const BG     = '#0d0d14';
const GREEN  = '#00ff7f';
const RED    = '#ff1744';
const WHITE  = '#ffffff';

const N_POINTS    = 50;
const ANIM_FRAMES = 25;   // 2 points revealed per frame
const HOLD_FRAMES = 12;
const ANIM_DELAY  = 80;
const HOLD_DELAY  = 110;

function xAt(i) {
    return GRAPH_L + (i / (N_POINTS - 1)) * (GRAPH_R - GRAPH_L);
}
function yAt(price) {
    return BASELINE - (price / MAX_DEV) * MAX_DEV;
}

/**
 * Generate a smoothed random-walk price series.
 * Final value is guaranteed to be on the correct side of the baseline.
 * @param {boolean} win  true = final price > 0, false = final price < 0
 * @returns {number[]}  N_POINTS values in [-MAX_DEV, MAX_DEV]
 */
function generatePriceSeries(win) {
    const prices = [0];
    let vel = 0;

    for (let i = 1; i < N_POINTS; i++) {
        const progress    = i / N_POINTS;
        const reversion   = -prices[i - 1] * 0.04;
        const dirBias     = progress > 0.55
            ? (win ? 1 : -1) * (progress - 0.55) * 14
            : 0;
        vel = vel * 0.72 + reversion + dirBias + (Math.random() - 0.5) * 11;
        prices.push(Math.max(-MAX_DEV, Math.min(MAX_DEV, prices[i - 1] + vel)));
    }

    // Guarantee final side
    const last = prices[N_POINTS - 1];
    if ((win && last <= 4) || (!win && last >= -4)) {
        const anchor = prices[N_POINTS - 10];
        const target = win ? Math.max(20, anchor + 15) : Math.min(-20, anchor - 15);
        for (let i = 1; i <= 9; i++) {
            const t = i / 9;
            prices[N_POINTS - 10 + i] = Math.max(-MAX_DEV, Math.min(MAX_DEV,
                anchor + t * (target - anchor) + (Math.random() - 0.5) * 4
            ));
        }
    }

    return prices;
}

function drawFrame(ctx, prices, n, choice, win, isHold) {
    const accent = prices[n] >= 0 ? GREEN : RED;

    // ── Background ─────────────────────────────────────────────────────────────
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 1;
    for (let x = GRAPH_L; x <= GRAPH_R; x += 46)  { ctx.beginPath(); ctx.moveTo(x, GRAPH_T - 10); ctx.lineTo(x, GRAPH_B + 10); ctx.stroke(); }
    for (let y = GRAPH_T; y <= GRAPH_B; y += 35)  { ctx.beginPath(); ctx.moveTo(GRAPH_L - 10, y);  ctx.lineTo(GRAPH_R + 10, y);  ctx.stroke(); }

    // border
    ctx.strokeStyle = isHold ? accent : '#2a2a40';
    ctx.lineWidth = isHold ? 2 : 1.5;
    ctx.strokeRect(GRAPH_L - 10, GRAPH_T - 10, GRAPH_R - GRAPH_L + 20, GRAPH_B - GRAPH_T + 20);

    // ── Baseline (dashed) ──────────────────────────────────────────────────────
    ctx.strokeStyle = '#555566';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(GRAPH_L, BASELINE);
    ctx.lineTo(GRAPH_R, BASELINE);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle  = '#555566';
    ctx.font       = '11px Arial';
    ctx.textAlign  = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('0', GRAPH_L - 14, BASELINE);

    // ── Filled area under the curve ────────────────────────────────────────────
    if (n >= 1) {
        ctx.beginPath();
        ctx.moveTo(xAt(0), BASELINE);
        for (let i = 0; i <= n; i++) ctx.lineTo(xAt(i), yAt(prices[i]));
        ctx.lineTo(xAt(n), BASELINE);
        ctx.closePath();
        ctx.fillStyle = prices[n] >= 0
            ? 'rgba(0,255,127,0.10)'
            : 'rgba(255,23,68,0.10)';
        ctx.fill();
    }

    // ── Price line (per-segment coloring) ──────────────────────────────────────
    ctx.lineWidth = 2.5;
    ctx.lineJoin  = 'round';
    for (let i = 1; i <= n; i++) {
        const mid = (prices[i - 1] + prices[i]) / 2;
        ctx.strokeStyle = mid >= 0 ? GREEN : RED;
        ctx.beginPath();
        ctx.moveTo(xAt(i - 1), yAt(prices[i - 1]));
        ctx.lineTo(xAt(i),     yAt(prices[i]));
        ctx.stroke();
    }

    // ── Tip dot ────────────────────────────────────────────────────────────────
    if (n >= 0) {
        ctx.fillStyle   = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur  = isHold ? 14 : 8;
        ctx.beginPath();
        ctx.arc(xAt(n), yAt(prices[n]), isHold ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
    }

    // ── Choice label (top-left) ────────────────────────────────────────────────
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#888899';
    ctx.font         = 'bold 13px Arial';
    ctx.fillText('📈 STOCK', GRAPH_L - 8, 12);

    ctx.textAlign = 'right';
    ctx.fillStyle = choice === 'high' ? GREEN : RED;
    ctx.font      = 'bold 13px Arial';
    ctx.fillText(`YOUR PICK: ${choice.toUpperCase()}`, GRAPH_R + 8, 12);

    // ── Result banner (hold frames only) ───────────────────────────────────────
    if (isHold) {
        const resultText  = win ? '✅  YOU WON' : '❌  YOU LOST';
        const resultColor = win ? GREEN : RED;

        const pillW = 160, pillH = 32;
        const pillX = W / 2 - pillW / 2;
        const pillY = GRAPH_B + 12;

        ctx.fillStyle = win ? '#003d20' : '#3d0010';
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 16);
        ctx.fill();

        ctx.strokeStyle = resultColor;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.roundRect(pillX, pillY, pillW, pillH, 16);
        ctx.stroke();

        ctx.fillStyle    = resultColor;
        ctx.font         = 'bold 15px Arial';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor  = resultColor;
        ctx.shadowBlur   = 8;
        ctx.fillText(resultText, W / 2, pillY + pillH / 2);
        ctx.shadowBlur = 0;
    }
}

/**
 * Build an animated stock graph GIF.
 * @param {boolean} win      true if player wins
 * @param {'high'|'low'} choice
 * @returns {Buffer}
 */
function buildStockGif(win, choice) {
    if (!createCanvas) throw new Error('Canvas not available');

    const prices  = generatePriceSeries(win);
    const canvas  = createCanvas(W, H);
    const ctx     = canvas.getContext('2d');
    const encoder = new GIFEncoder(W, H, 'neuquant', true);
    encoder.start();
    encoder.setRepeat(0);

    // Animation: reveal 2 data points per frame
    for (let f = 0; f < ANIM_FRAMES; f++) {
        const n = Math.min(Math.round((f / (ANIM_FRAMES - 1)) * (N_POINTS - 1)), N_POINTS - 1);
        encoder.setDelay(ANIM_DELAY);
        drawFrame(ctx, prices, n, choice, win, false);
        encoder.addFrame(ctx);
    }

    // Hold frames with result
    for (let f = 0; f < HOLD_FRAMES; f++) {
        encoder.setDelay(HOLD_DELAY);
        drawFrame(ctx, prices, N_POINTS - 1, choice, win, true);
        encoder.addFrame(ctx);
    }

    encoder.finish();
    return Buffer.from(encoder.out.getData());
}

module.exports = { buildStockGif };
