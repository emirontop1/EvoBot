const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType 
} = require('discord.js');
const http = require('http');
require('dotenv').config();

// Render için aktif tutma sunucusu
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

// Veritabanı (Sunucu ID -> Yasaklı Kelimeler Listesi)
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
            .setDescription('Komut listesi aşağıdadır:')
            .addFields(
                { name: '/help', value: 'Yardım menüsünü görüntüler.', inline: false },
                { name: '/dashboard', value: 'Bot profilini ve bilgilerini gösterir.', inline: false },
                { name: '/setup', value: 'DM üzerinden küfür engelleme kurulumunu başlatır.', inline: false }
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
                { name: '🛠️ Desteklenenler:', value: '/help, /dashboard, /setup', inline: false },
                { name: '⚡ Durum', value: '7/24 Aktif', inline: true },
                { name: '💻 Geliştiriciler', value: 'Rizza ve Emoc', inline: true }
            )
            .setFooter({ text: 'GitHub & Render üzerinden yönetiliyor.' })
            .setTimestamp();
        message.reply({ embeds: [dashboardEmbed] });
    }

    // --- /setup KOMUTU (DM'den) ---
    if (message.channel.type === 1 && message.content === '/setup') {
        const guilds = client.guilds.cache.filter(g => g.ownerId === message.author.id);
        
        if (guilds.size === 0) return message.reply("Yönetici olduğun bir sunucu bulamadım (Botun sunucuda olduğundan emin ol).");

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_guild')
            .setPlaceholder('Sunucunu seç...');

        guilds.forEach(g => {
            select.addOptions(new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(g.id));
        });

        const row = new ActionRowBuilder().addComponents(select);
        const setupMsg = await message.reply({ content: 'Lütfen küfür engelleme kurmak istediğin sunucuyu seç:', components: [row] });

        // Kelime seçim kolektörü
        const collector = setupMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
        
        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) return interaction.reply({ content: 'Bu menü sana ait değil!', ephemeral: true });

            const guildId = interaction.values[0];
            await interaction.reply("✅ Sunucu seçildi! Şimdi yasaklamak istediğin kelimeyi (tek kelime) yaz:");
            
            const filter = m => m.author.id === message.author.id;
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });
            
            if (collected.size > 0) {
                const word = collected.first().content.toLowerCase();
                const list = serverBannedWords.get(guildId) || [];
                list.push(word);
                serverBannedWords.set(guildId, list);
                message.channel.send(`✅ **${word}** kelimesi sunucuda yasaklandı!`);
            }
        });
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

client.login(process.env.DISCORD_TOKEN);
