const { Connection, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const SOL_CONNECTION = new Connection('https://api.mainnet-beta.solana.com', 'finalized');

/**
 * Send SOL from a bot-managed keypair to any Solana address.
 *
 * @param {Keypair} keypair       - Solana Keypair from deriveSolKeypair
 * @param {string}  toAddress     - recipient base58 public key
 * @param {number|'all'} sendLamports - lamports to send, or 'all' to sweep
 * @returns {{ txid, sentLamports, feeLamports }}
 */
async function sendSol(keypair, toAddress, sendLamports) {
    const toPubkey = new PublicKey(toAddress);
    const balance = await SOL_CONNECTION.getBalance(keypair.publicKey, 'finalized');
    if (balance === 0) throw new Error('No SOL balance on that address.');

    // Estimate fee with a dummy transaction
    const { blockhash, lastValidBlockHeight } = await SOL_CONNECTION.getLatestBlockhash('finalized');

    const dummyTx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
    dummyTx.add(SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey,
        lamports: 1,
    }));
    const feeResponse = await SOL_CONNECTION.getFeeForMessage(dummyTx.compileMessage(), 'finalized');
    const feeLamports = feeResponse.value ?? 5000;

    const isSweep = sendLamports === 'all';
    let actualSend;
    if (isSweep) {
        actualSend = balance - feeLamports;
        if (actualSend <= 0) throw new Error(`Balance (${balance} lamports) is less than fee (${feeLamports} lamports).`);
    } else {
        if (balance < sendLamports + feeLamports) {
            throw new Error(`Insufficient SOL: need ${sendLamports + feeLamports} lamports (incl. fee), have ${balance}.`);
        }
        actualSend = sendLamports;
    }

    const tx = new Transaction({ recentBlockhash: blockhash, feePayer: keypair.publicKey });
    tx.add(SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey,
        lamports: actualSend,
    }));
    tx.sign(keypair);

    const txid = await SOL_CONNECTION.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await SOL_CONNECTION.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, 'finalized');

    return { txid, sentLamports: actualSend, feeLamports };
}

module.exports = { sendSol, LAMPORTS_PER_SOL };
