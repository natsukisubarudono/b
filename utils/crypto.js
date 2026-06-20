const { BIP32Factory } = require('bip32');
const ecc = require('tiny-secp256k1');
const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const { Keypair } = require('@solana/web3.js');

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const LTC_NETWORK = {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bip32: { public: 0x019da462, private: 0x019d9cfe },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
};

function deriveLtcAddress(mnemonic, index) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic provided in LTC_MASTER_MNEMONIC secret.');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, LTC_NETWORK);
    const child = root.derivePath(`m/44'/2'/0'/0/${index}`);
    const { address } = bitcoin.payments.p2pkh({
        pubkey: child.publicKey,
        network: LTC_NETWORK,
    });
    return address;
}

function deriveLtcKeyPair(mnemonic, index) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic provided in LTC_MASTER_MNEMONIC secret.');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed, LTC_NETWORK);
    const child = root.derivePath(`m/44'/2'/0'/0/${index}`);
    const payment = bitcoin.payments.p2pkh({ pubkey: child.publicKey, network: LTC_NETWORK });
    return { node: child, address: payment.address, network: LTC_NETWORK };
}

function deriveSolAddress(mnemonic, index) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic provided in LTC_MASTER_MNEMONIC secret.');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const { key } = derivePath(`m/44'/501'/${index}'/0'`, seed.toString('hex'));
    const keypair = Keypair.fromSeed(key);
    return keypair.publicKey.toBase58();
}

function deriveSolKeypair(mnemonic, index) {
    if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error('Invalid mnemonic provided in LTC_MASTER_MNEMONIC secret.');
    }
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const { key } = derivePath(`m/44'/501'/${index}'/0'`, seed.toString('hex'));
    return Keypair.fromSeed(key);
}

module.exports = { deriveLtcAddress, deriveLtcKeyPair, deriveSolAddress, deriveSolKeypair };
