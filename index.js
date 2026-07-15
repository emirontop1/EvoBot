const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder 
} = require('discord.js');
const http = require('http');
require('dotenv').config();

// Render'ı aktif tutmak için
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot aktif!');
}).listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ] 
});

// Basit veritabanı (Sunucu ID -> Yasaklı Kelimeler)
const serverBannedWords = new Map();

client.once('ready', () => {
    console.log(`${client.user.tag} başarıyla giriş yaptı!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // --- /help KOMUTU ---
    if (message.content === '/help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('📖 Yardım Menüsü')
            .setColor(0xFFD700)
            .setDescription('Komut listesi:')
            .addFields(
                { name: '/help', value: 'Yardım menüsünü görüntüler.', inline: false },
                { name: '/dashboard', value: 'Botun profilini ve bilgilerini gösterir.', inline: false },
                { name: '/setup', value: 'DM üzerinden sunucu kurulumunu başlatır.', inline: false }
            )
            .setFooter({ text: 'Rizza ve Emoc tarafından desteklenir' });
        message.reply({ embeds: [helpEmbed] });
    }

    // --- /dashboard KOMUTU ---
    if (message.content === '/dashboard') {
        const dashboardEmbed = new EmbedBuilder()
            .setTitle('🤖 Bot Hakkında')
            .setColor(0x00FF80)
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(`Merhaba, ben **${client.user.username}**!`)
            .addFields(
                { name: '🛠️ Özellikler:', value: 'Küfür engelleme ve sunucu yönetimi.', inline: false },
                { name: '⚡ Durum', value: '7/24 Aktif', inline: true },
                { name: '💻 Geliştiriciler', value: 'Rizza ve Emoc', inline: true }
            )
            .setFooter({ text: 'GitHub üzerinden yönetiliyor.' })
            .setTimestamp();
        message.reply({ embeds: [dashboardEmbed] });
    }

    // --- /setup KOMUTU (SADECE DM) ---
    if (message.channel.type === 1 && message.content === '/setup') {
        const guilds = client.guilds.cache.filter(g => g.ownerId === message.author.id);
        
        if (guilds.size === 0) return message.reply("Yönetici olduğun bir sunucu bulamadım.");

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_guild')
            .setPlaceholder('Sunucunu seç...');

        guilds.forEach(g => {
            select.addOptions(new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(g.id));
        });

        const row = new ActionRowBuilder().addComponents(select);
        await message.reply({ content: 'Lütfen küfür engelleme kurmak istediğin sunucuyu seç:', components: [row] });
    }

    // --- KÜFÜR ENGELLEME MANTIĞI ---
    if (message.guild && serverBannedWords.has(message.guild.id)) {
        const bannedWords = serverBannedWords.get(message.guild.id);
        const content = message.content.toLowerCase();
        
        if (bannedWords.some(word => content.includes(word))) {
            const word = bannedWords.find(w => content.includes(w));
            await message.delete().catch(() => {});
            message.author.send(`⚠️ "${word}" kelimesini ${message.guild.name} sunucusunda kullandığınız için mesajınız silindi.`);
        }
    }
});

// --- DROPDOWN SEÇİMİ YAKALAMA ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    
    if (interaction.customId === 'select_guild') {
        const guildId = interaction.values[0];
        const guildName = interaction.component.options.find(o => o.value === guildId).label;
        
        // Örnek yasaklı kelimeler (burayı geliştirebilirsin)
        serverBannedWords.set(guildId, ['küfür1', 'küfür2', 'yasaklıkelime']); 
        
        await interaction.reply(`✅ Başarılı! **${guildName}** sunucusu için küfür engelleme aktif edildi.`);
    }
});

client.login(process.env.DISCORD_TOKEN);
