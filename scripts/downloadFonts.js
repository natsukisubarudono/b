#!/usr/bin/env node
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const FONT_DIR  = path.join(__dirname, '..', 'fonts');
const FONT_PATH = path.join(FONT_DIR, 'Roboto.ttf');
const MIN_SIZE  = 50_000;

const URLS = [
    'https://fonts.gstatic.com/s/roboto/v32/KFOmCnqEu92Fr1Me5WZLCzYlKw.ttf',
    'https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Regular.ttf',
];

function download(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'node' } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return download(res.headers.location).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function main() {
    if (fs.existsSync(FONT_PATH) && fs.statSync(FONT_PATH).size >= MIN_SIZE) {
        console.log(`[fonts] Roboto.ttf already present (${fs.statSync(FONT_PATH).size} bytes) — skipping download`);
        return;
    }

    fs.mkdirSync(FONT_DIR, { recursive: true });

    for (const url of URLS) {
        try {
            console.log(`[fonts] Downloading from ${url} ...`);
            const buf = await download(url);
            if (buf.length < MIN_SIZE) throw new Error(`File too small (${buf.length} bytes) — likely not a font`);
            fs.writeFileSync(FONT_PATH, buf);
            console.log(`[fonts] Roboto.ttf saved (${buf.length} bytes)`);
            return;
        } catch (err) {
            console.warn(`[fonts] Failed: ${err.message}`);
        }
    }

    console.warn('[fonts] WARNING: Could not download Roboto.ttf — images will render with system fonts');
}

main();
