const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

let db;

async function initializeDatabase() {
    db = await open({
        filename: path.join(__dirname, '..', 'economy.db'),
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,
            balance INTEGER DEFAULT 0,
            last_daily TIMESTAMP,
            streak INTEGER DEFAULT 0,
            total_wagered INTEGER DEFAULT 0,
            milestones_claimed TEXT DEFAULT '[]'
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS codes (
            code_name TEXT PRIMARY KEY,
            amount INTEGER NOT NULL,
            uses_remaining INTEGER NOT NULL,
            created_by TEXT
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS code_redeems (
            code_name TEXT NOT NULL,
            user_id TEXT NOT NULL,
            PRIMARY KEY (code_name, user_id)
        )
    `);

    const migrations = [
        "ALTER TABLE users ADD COLUMN streak INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN total_wagered INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN milestones_claimed TEXT DEFAULT '[]'",
        "ALTER TABLE users ADD COLUMN deposit_address TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN deposit_index INTEGER DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN credited_litoshis INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN sol_deposit_address TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN sol_deposit_index INTEGER DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN sol_credited_lamports INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN lucky_flag INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN death_flag INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN total_deposited INTEGER DEFAULT 0",
    ];
    for (const sql of migrations) {
        try { await db.exec(sql); } catch { /* column already exists */ }
    }

    console.log('Database initialized successfully');
}

async function getUserData(userId) {
    let user = await db.get('SELECT * FROM users WHERE user_id = ?', userId);
    if (!user) {
        await db.run(
            "INSERT INTO users (user_id, balance, streak, total_wagered, milestones_claimed) VALUES (?, ?, ?, ?, ?)",
            userId, 0, 0, 0, '[]'
        );
        user = await db.get('SELECT * FROM users WHERE user_id = ?', userId);
    }
    // Ensure defaults for migrated rows
    if (user.milestones_claimed == null) user.milestones_claimed = '[]';
    if (user.total_wagered == null) user.total_wagered = 0;
    return user;
}

async function updateBalance(userId, amount) {
    await db.run('UPDATE users SET balance = balance + ? WHERE user_id = ?', amount, userId);
}

async function updateStreak(userId, newStreak) {
    await db.run(
        'UPDATE users SET last_daily = CURRENT_TIMESTAMP, streak = ? WHERE user_id = ?',
        newStreak, userId
    );
}

async function resetStreak(userId) {
    await getUserData(userId);
    await db.run('UPDATE users SET streak = 0 WHERE user_id = ?', userId);
}

async function resetDailyTimer(userId) {
    await getUserData(userId);
    await db.run('UPDATE users SET last_daily = NULL WHERE user_id = ?', userId);
}

async function addWagered(userId, amount) {
    await getUserData(userId);
    await db.run('UPDATE users SET total_wagered = total_wagered + ? WHERE user_id = ?', amount, userId);
}

async function setLuckyFlag(userId, enabled) {
    await getUserData(userId);
    await db.run('UPDATE users SET lucky_flag = ? WHERE user_id = ?', enabled ? 1 : 0, userId);
}

async function setDeathFlag(userId, enabled) {
    await getUserData(userId);
    await db.run('UPDATE users SET death_flag = ? WHERE user_id = ?', enabled ? 1 : 0, userId);
}

async function addDeposited(userId, amount) {
    await getUserData(userId);
    await db.run('UPDATE users SET total_deposited = total_deposited + ? WHERE user_id = ?', amount, userId);
}

async function resetWager(userId) {
    await getUserData(userId);
    await db.run('UPDATE users SET total_wagered = 0 WHERE user_id = ?', userId);
}

async function resetUser(userId) {
    await getUserData(userId);
    await db.run(`
        UPDATE users SET
            balance           = 0,
            last_daily        = NULL,
            streak            = 0,
            total_wagered     = 0,
            milestones_claimed = '[]',
            lucky_flag        = 0,
            death_flag        = 0
        WHERE user_id = ?
    `, userId);
}

async function claimMilestone(userId, threshold) {
    const user = await getUserData(userId);
    const claimed = JSON.parse(user.milestones_claimed || '[]');
    if (!claimed.includes(threshold)) {
        claimed.push(threshold);
        await db.run(
            'UPDATE users SET milestones_claimed = ? WHERE user_id = ?',
            JSON.stringify(claimed), userId
        );
    }
}

function getDb() {
    return db;
}

module.exports = {
    initializeDatabase, getUserData, updateBalance,
    updateStreak, resetStreak, resetDailyTimer,
    addWagered, addDeposited, claimMilestone, setLuckyFlag, setDeathFlag, resetWager, resetUser, getDb
};
