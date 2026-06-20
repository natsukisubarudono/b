const bitcoin = require('bitcoinjs-lib');
const ecc = require('tiny-secp256k1');

bitcoin.initEccLib(ecc);

const ESPLORA = 'https://litecoinspace.org/api';
const LITOSHIS_PER_LTC = 1e8;

const LTC_NETWORK = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bip32: { public: 0x019da462, private: 0x019d9cfe },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
    bech32: 'ltc',
};

async function getUtxos(address) {
    const res = await fetch(`${ESPLORA}/address/${address}/utxo`);
    if (!res.ok) throw new Error(`UTXO fetch failed: ${res.status}`);
    return res.json();
}

async function getTxHex(txid) {
    const res = await fetch(`${ESPLORA}/tx/${txid}/hex`);
    if (!res.ok) throw new Error(`TX hex fetch failed: ${res.status}`);
    return res.text();
}

async function getFeeRate() {
    try {
        const res = await fetch(`${ESPLORA}/fee-estimates`);
        if (!res.ok) return 20;
        const data = await res.json();
        return Math.ceil(data['2'] ?? data['3'] ?? 20);
    } catch {
        return 20;
    }
}

async function broadcastTx(txHex) {
    const res = await fetch(`${ESPLORA}/tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: txHex,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Broadcast failed: ${text}`);
    return text.trim();
}

/**
 * Build, sign, and broadcast a P2PKH LTC transaction.
 *
 * @param {object} keyPair   - { node (BIP32 child), address, network } from deriveLtcKeyPair
 * @param {string} toAddress - recipient LTC address
 * @param {number|'all'} sendLitoshis - amount to send in litoshis, or 'all' to sweep
 * @returns {{ txid, sentLitoshis, feeLitoshis }}
 */
async function sendLtc(keyPair, toAddress, sendLitoshis) {
    const utxos = await getUtxos(keyPair.address);
    if (!utxos.length) throw new Error('No UTXOs found for that address.');

    const confirmedUtxos = utxos.filter(u => u.status?.confirmed);
    if (!confirmedUtxos.length) throw new Error('No confirmed UTXOs — funds may still be unconfirmed.');

    // Work in BigInt throughout — bitcoinjs-lib v7 requires BigInt values
    const totalAvailable = confirmedUtxos.reduce((s, u) => s + BigInt(u.value), 0n);
    const feeRate = await getFeeRate();

    const isSweep = sendLitoshis === 'all';
    const outputCount = isSweep ? 1 : 2;
    const estimatedSize = 10 + 148 * confirmedUtxos.length + 34 * outputCount;
    const feeLitoshis = BigInt(feeRate * estimatedSize);

    let actualSend;
    if (isSweep) {
        actualSend = totalAvailable - feeLitoshis;
        if (actualSend <= 0n) throw new Error(`Balance (${totalAvailable} litoshis) is less than fee (${feeLitoshis} litoshis).`);
    } else {
        const sendBig = BigInt(sendLitoshis);
        if (totalAvailable < sendBig + feeLitoshis) {
            throw new Error(`Insufficient funds: need ${sendBig + feeLitoshis} litoshis (incl. fee), have ${totalAvailable}.`);
        }
        actualSend = sendBig;
    }

    // Fetch raw tx hex for each input (required for nonWitnessUtxo in PSBT)
    const txHexes = await Promise.all(confirmedUtxos.map(u => getTxHex(u.txid)));

    const psbt = new bitcoin.Psbt({ network: LTC_NETWORK });

    for (let i = 0; i < confirmedUtxos.length; i++) {
        psbt.addInput({
            hash: confirmedUtxos[i].txid,
            index: confirmedUtxos[i].vout,
            nonWitnessUtxo: Buffer.from(txHexes[i], 'hex'),
        });
    }

    psbt.addOutput({ script: bitcoin.address.toOutputScript(toAddress, LTC_NETWORK), value: actualSend });

    if (!isSweep) {
        const change = totalAvailable - actualSend - feeLitoshis;
        if (change > 546n) {
            psbt.addOutput({ script: bitcoin.address.toOutputScript(keyPair.address, LTC_NETWORK), value: change });
        }
    }

    const signer = {
        publicKey: keyPair.node.publicKey,
        sign: (hash) => Buffer.from(ecc.sign(hash, keyPair.node.privateKey)),
    };

    for (let i = 0; i < confirmedUtxos.length; i++) {
        psbt.signInput(i, signer);
    }

    psbt.finalizeAllInputs();
    const txHex = psbt.extractTransaction().toHex();
    const txid = await broadcastTx(txHex);

    // Return as Numbers for display
    return { txid, sentLitoshis: Number(actualSend), feeLitoshis: Number(feeLitoshis) };
}

module.exports = { sendLtc, LITOSHIS_PER_LTC };
