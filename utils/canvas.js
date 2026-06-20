let createCanvas;
try {
    createCanvas = require('canvas').createCanvas;
} catch (e) {
    createCanvas = null;
}

const { currencyConvert } = require('./currency');

function generateBalanceImage(balance, username) {
    if (!createCanvas) throw new Error('Canvas not available');

    const width = 800;
    const height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#00ff00';
    ctx.font = 'bold 38px Arial';
    ctx.fillText(`${username}'s Balance`, width / 2, 110);

    ctx.font = 'bold 80px Arial';
    ctx.fillText(`${balance} points`, width / 2, 220);

    ctx.fillStyle = '#00cc00';
    ctx.font = '32px Arial';
    ctx.fillText(`≈ ${currencyConvert(balance)}`, width / 2, 305);

    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    ctx.font = '20px Arial';
    ctx.fillStyle = '#00ff00';
    ctx.fillText('💰', 50, 50);
    ctx.fillText('💰', width - 50, height - 50);

    return canvas.toBuffer();
}

module.exports = { generateBalanceImage };
