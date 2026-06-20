function currencyConvert(points) {
    const dollars = (points * 0.01).toFixed(2);
    return `$${dollars}`;
}

module.exports = { currencyConvert };
