const crypto = require('crypto');

function generateServerSeed() {
    return crypto.randomBytes(32).toString('hex');
}

function hashServerSeed(serverSeed) {
    return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

// ── Coin flip ──────────────────────────────────────────────────────────────────

function deriveResult(serverSeed) {
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');
    const firstByte = parseInt(hash.slice(0, 2), 16);
    return firstByte % 2 === 0 ? 'heads' : 'tails';
}

function verify(publicHash, serverSeed) {
    const computed = hashServerSeed(serverSeed);
    const valid = computed === publicHash;
    const result = valid ? deriveResult(serverSeed) : null;
    return { valid, computed, result };
}

// ── Minesweeper ────────────────────────────────────────────────────────────────

const MINES_TOTAL = 24;

/**
 * Derive mine positions from a server seed.
 * Each tile gets a score = SHA256(seed:index); tiles are ranked by score.
 * The lowest `mineCount` scores are mines.
 * @returns {Set<number>} set of mine tile indices (0..23)
 */
function deriveMineLayout(serverSeed, mineCount) {
    const scored = Array.from({ length: MINES_TOTAL }, (_, i) => ({
        idx: i,
        score: crypto.createHash('sha256').update(`${serverSeed}:${i}`).digest('hex'),
    }));
    scored.sort((a, b) => a.score.localeCompare(b.score));
    return new Set(scored.slice(0, mineCount).map(x => x.idx));
}

/**
 * Verify a minesweeper round: confirm hash and return mine positions.
 */
function verifyMines(publicHash, serverSeed, mineCount) {
    const computed = hashServerSeed(serverSeed);
    const valid = computed === publicHash;
    if (!valid) return { valid, computed, mineSet: null };
    const mineSet = deriveMineLayout(serverSeed, mineCount);
    return { valid, computed, mineSet };
}

/**
 * For LF games: find a seed where all `safeTiles` are NOT mines.
 * Loops until a matching seed is found (always terminates if safeTiles.length <= MINES_TOTAL - mineCount).
 */
function findLFSeedForMines(mineCount, safeTiles) {
    let attempts = 0;
    while (true) {
        const serverSeed = generateServerSeed();
        const mineSet = deriveMineLayout(serverSeed, mineCount);
        const valid = safeTiles.every(idx => !mineSet.has(idx));
        if (valid) return { serverSeed, publicHash: hashServerSeed(serverSeed) };
        if (++attempts > 200000) throw new Error('Could not find LF seed — too many mines for revealed tiles.');
    }
}

/**
 * For DF games: find a seed where `hitTile` IS a mine.
 * Used retroactively so the provably fair record shows the tile was always a mine.
 */
function findDFSeedForMines(mineCount, hitTile) {
    let attempts = 0;
    while (true) {
        const serverSeed = generateServerSeed();
        const mineSet = deriveMineLayout(serverSeed, mineCount);
        if (mineSet.has(hitTile)) return { serverSeed, publicHash: hashServerSeed(serverSeed) };
        if (++attempts > 200000) throw new Error('Could not find DF seed for mines.');
    }
}

// ── Dice ───────────────────────────────────────────────────────────────────────

/**
 * Derive two dice rolls (1-6) from a server seed.
 * player roll: SHA256(seed:player), bot roll: SHA256(seed:bot)
 * Takes first 4 bytes of each hash, mod 6, +1.
 */
function deriveDiceRolls(serverSeed) {
    const playerHash = crypto.createHash('sha256').update(`${serverSeed}:player`).digest('hex');
    const botHash    = crypto.createHash('sha256').update(`${serverSeed}:bot`).digest('hex');
    const playerRoll = (parseInt(playerHash.slice(0, 8), 16) % 6) + 1;
    const botRoll    = (parseInt(botHash.slice(0, 8), 16) % 6) + 1;
    return { playerRoll, botRoll };
}

module.exports = {
    generateServerSeed, hashServerSeed,
    deriveResult, verify,
    deriveMineLayout, verifyMines, findLFSeedForMines, findDFSeedForMines,
    deriveDiceRolls,
    MINES_TOTAL,
};
