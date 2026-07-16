const { Client, GatewayIntentBits, EmbedBuilder, Events } = require('discord.js');
require('dotenv').config();

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent 
    ] 
});

client.once(Events.ClientReady, (c) => {
    console.log(`${c.user.tag} hazır!`);
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // 1. !YAYIN KOMUTU
    if (command === 'yayın') {
        const yayinGorselleri = [
            "https://i.imgur.com/8m5l7P0.gif", // Örnek yayın gifleri
            "https://i.imgur.com/Kz8lJv6.png",
            "https://i.imgur.com/V9wZfV1.gif"
        ];
        const randomGorsel = yayinGorselleri[Math.floor(Math.random() * yayinGorselleri.length)];

        const embed = new EmbedBuilder()
            .setTitle('🔴 CANLI YAYIN BAŞLADI!')
            .setDescription(`${message.author.username} şu an yayında! Katılmak için ses kanalına göz atabilirsin.`)
            .setColor(0xFF0000)
            .setImage(randomGorsel)
            .setFooter({ text: 'EvoBot Yayın Sistemi' })
            .setTimestamp();

        message.channel.send({ embeds: [embed] });
    }

    // 2. !KONUŞ KOMUTU
    if (command === 'konuş') {
        const metin = args.join(' ');
        if (!metin) return message.reply("Lütfen söylememi istediğin bir şey yaz. Örn: `!konuş Merhaba millet!`");

        // Mesajı silip botun sanki o mesajı atmış gibi görünmesini sağlayabiliriz
        message.delete().catch(() => {});
        message.channel.send(metin);
    }
});

client.login(process.env.DISCORD_TOKEN);
