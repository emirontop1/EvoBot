const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');
require('dotenv').config();

// Render'ı uyandırmak için boş bir HTTP sunucusu
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot aktif!');
}).listen(process.env.PORT || 3000);

// Supabase bağlantısı
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

client.once('ready', () => {
    console.log(`${client.user.tag} olarak giriş yapıldı!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!ping') {
        const { error } = await supabase
            .from('logs')
            .insert([{ user: message.author.username, message: 'ping komutu kullanıldı' }]);

        if (error) {
            console.error('Supabase Hatası:', error);
            message.reply('Veri kaydedilirken hata oluştu.');
        } else {
            message.reply('Pong! Veri Supabase\'e kaydedildi.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);

