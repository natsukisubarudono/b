module.exports = {
    name: 'ping',
    async execute(message, args, client) {
        const sent = await message.reply('Pinging...');
        const ping = sent.createdTimestamp - message.createdTimestamp;
        await sent.edit(`🏓 Pong! Latency: ${ping}ms | API Latency: ${Math.round(client.ws.ping)}ms`);
    }
};
