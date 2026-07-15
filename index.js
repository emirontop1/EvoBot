const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const http = require('http');
require('dotenv').config();

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

    // Yardım Komutu
    if (message.content === '/help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('📖 Yardım Menüsü')
            .setColor(0xFFD700) // Altın rengi
            .setDescription('İşte kullanabileceğin komutlar:')
            .addFields(
                { name: '/help', value: 'Yardım menüsünü görüntüler.', inline: false },
                { name: '/dashboard', value: 'Botun profilini ve bilgilerini gösterir.', inline: false }
            )
            .setFooter({ text: 'EvoBot tarafından desteklenir' });
        
        message.reply({ embeds: [helpEmbed] });
    }

    // Dashboard Komutu
    if (message.content === '/dashboard') {
        const dashboardEmbed = new EmbedBuilder()
            .setTitle('🤖 Bot Hakkında')
            .setColor(0x00FF80) // Yeşilimsi
            .setThumbnail(client.user.displayAvatarURL()) // Botun profil resmi
            .setDescription(`Merhaba, ben **${client.user.username}**!`)
            .addFields(
                { name: '🛠️ Şu an destekliyorum:', value: '/help ve /dashboard komutlarını kullanabilirsin.', inline: false },
                { name: '⚡ Durum', value: '7/24 Aktif', inline: true },
                { name: '💻 Geliştirici', value: 'Burak', inline: true }
            )
            .setFooter({ text: 'Kodlarım GitHub üzerinden yönetiliyor.' })
            .setTimestamp();
            
        message.reply({ embeds: [dashboardEmbed] });
    }
});

client.login(process.env.DISCORD_TOKEN);
