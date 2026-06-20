const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const DICE_URLS = {
    1: 'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/1_1.png',
    2: 'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/2_2.png',
    3: 'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/3_3.png',
    4: 'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/4_4.png',
    5: 'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/5_5.png',
    6: 'https://raw.githubusercontent.com/natsukisubarudono/assets/refs/heads/main/6_6.png',
};

const OUT_DIR = path.join(__dirname, '..', 'dicevalues');

async function fetchPng(value) {
    const res = await fetch(DICE_URLS[value]);
    if (!res.ok) throw new Error(`HTTP ${res.status} for dice ${value}`);
    const raw = Buffer.from(await res.arrayBuffer());
    return sharp(raw).png().toBuffer();
}

async function buildComposite(playerPng, botPng) {
    const { width: w, height: h } = await sharp(playerPng).metadata();
    const half = Math.floor(w / 2);
    const botResized = await sharp(botPng).resize(w, h, { fit: 'fill' }).png().toBuffer();
    const [left, right] = await Promise.all([
        sharp(playerPng).extract({ left: 0, top: 0, width: half, height: h }).toBuffer(),
        sharp(botResized).extract({ left: half, top: 0, width: w - half, height: h }).toBuffer(),
    ]);
    return sharp({
        create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
        .composite([
            { input: left,  left: 0,    top: 0 },
            { input: right, left: half, top: 0 },
        ])
        .png()
        .toBuffer();
}

(async () => {
    console.log('Fetching 6 source images...');
    const sources = {};
    for (let i = 1; i <= 6; i++) {
        sources[i] = await fetchPng(i);
        console.log(`  fetched ${i}_${i}.png`);
    }

    console.log('\nGenerating all 36 combinations...');
    for (let p = 1; p <= 6; p++) {
        for (let b = 1; b <= 6; b++) {
            const outPath = path.join(OUT_DIR, `${p}_${b}.png`);
            let buf;
            if (p === b) {
                buf = sources[p];
            } else {
                buf = await buildComposite(sources[p], sources[b]);
            }
            fs.writeFileSync(outPath, buf);
            console.log(`  saved ${p}_${b}.png  (${buf.length} bytes)`);
        }
    }

    console.log('\nDone — 36 images saved to dicevalues/');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
