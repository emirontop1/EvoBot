const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');
require('dotenv').config();

// Render'ı uyanık tutmak için basit sunucu
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot aktif!');
}).listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

client.once('ready', () => {
    console.log(`${client.user.tag} başarıyla giriş yaptı!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // /help komutu
    if (message.content === '/help') {
        message.reply('**Komutlar:**\n/help - Yardım menüsünü gösterir.\n/dashboard - Botun durum bilgilerini gösterir.');
    }

    // /dashboard komutu
    if (message.content === '/dashboard') {
        const embed = new EmbedBuilder()
            .setTitle('Bot Paneli')
            .setColor(0x0099FF)
            .setDescription('Bot şu an aktif ve sorunsuz çalışıyor.')
            .addFields(
                { name: 'Durum', value: 'Çevrimiçi', inline: true },
                { name: 'Kütüphane', value: 'Discord.js', inline: true }
            )
            .setTimestamp();
            
        message.reply({ embeds: [embed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
