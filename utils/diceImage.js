const fs = require('fs');
const path = require('path');

const DICE_DIR = path.join(__dirname, '..', 'dicevalues');

/**
 * Returns the PNG Buffer for the pre-generated dice image
 * where the left die shows playerRoll and the right die shows botRoll.
 */
function buildDiceImage(playerRoll, botRoll) {
    const filePath = path.join(DICE_DIR, `${playerRoll}_${botRoll}.png`);
    return fs.readFileSync(filePath);
}

module.exports = { buildDiceImage };
