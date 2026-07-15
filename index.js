const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');
require('dotenv').config();

// Render'ı uyanık tutmak için
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

    if (message.content === '!ping') {
        // Logları artık Supabase'e değil, direkt Render'ın kendi konsoluna yazdırıyoruz
        console.log(`Log: ${message.author.username} tarafından ping komutu kullanıldı.`);
        message.reply('Pong! Log başarıyla konsola kaydedildi.');
    }
});

client.login(process.env.DISCORD_TOKEN);
