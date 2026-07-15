const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ChannelType 
} = require('discord.js');
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
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages 
    ],
    partials: [
        Partials.Channel, 
        Partials.Message
    ]
});

const serverBannedWords = new Map();

client.once('ready', () => {
    console.log(`${client.user.tag} başarıyla giriş yaptı!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 🔍 GİZLİ RADAR: Botun Dm'leri duyup duymadığını Render panelinde (Logs) görmek için
    if (message.channel.type === ChannelType.DM) {
        console.log(`[DM ALINDI] Kimden: ${message.author.username} | Mesaj: ${message.content}`);
    }

    const icerik = message.content.trim().toLowerCase(); // Boşlukları sil ve küçük harfe çevir

    // --- /help veya !help KOMUTU ---
    if (icerik === '/help' || icerik === '!help') {
        const helpEmbed = new EmbedBuilder()
            .setTitle('✨ Evo-Bot Yardım Merkezi ✨')
            .setColor(0x2b2d31)
            .setDescription('Aşağıdaki komutları kullanarak botu yönetebilirsiniz.')
            .addFields(
                { name: '🛠️ `!help`', value: 'Bu yardım menüsünü görüntüler.', inline: false },
                { name: '📊 `!dashboard`', value: 'Botun sistem durumunu ve bilgilerini gösterir.', inline: false },
                { name: '🛡️ `!setup`', value: '*(Sadece DM)* Sunucun için kelime engelleyiciyi kurar.', inline: false }
            )
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: 'Rizza ve Emoc tarafından gururla geliştirildi.', iconURL: message.author.displayAvatarURL() })
            .setTimestamp();
        message.reply({ embeds: [helpEmbed] });
    }

    // --- /dashboard veya !dashboard KOMUTU ---
    if (icerik === '/dashboard' || icerik === '!dashboard') {
        const dashboardEmbed = new EmbedBuilder()
            .setTitle('🚀 Sistem Kontrol Paneli')
            .setColor(0x5865F2)
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(`Merhaba, ben **${client.user.username}**! Sistemlerim stabil çalışıyor.`)
            .addFields(
                { name: '📡 Gecikme', value: `${client.ws.ping}ms`, inline: true },
                { name: '⏱️ Durum', value: '7/24 Aktif', inline: true },
                { name: '🛡️ Sunucular', value: `${client.guilds.cache.size} Sunucu`, inline: true },
                { name: '👑 Geliştiriciler', value: 'Rizza ve Emoc', inline: false }
            )
            .setFooter({ text: 'Render & GitHub üzerinden desteklenmektedir.' })
            .setTimestamp();
        message.reply({ embeds: [dashboardEmbed] });
    }

    // --- /setup veya !setup KOMUTU (DM'den) ---
    if (message.channel.type === ChannelType.DM && (icerik === '/setup' || icerik === '!setup')) {
        const guilds = client.guilds.cache.filter(g => g.ownerId === message.author.id);
        
        if (guilds.size === 0) {
            return message.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌ Hata').setDescription('Sahibi olduğun ve benim de bulunduğum bir sunucu bulamadım. Önce beni sunucuna davet et!')] });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_guild')
            .setPlaceholder('🛡️ Korumak istediğin sunucuyu seç...');

        guilds.forEach(g => {
            select.addOptions(new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(g.id).setEmoji('📌'));
        });

        const setupEmbed = new EmbedBuilder()
            .setTitle('⚙️ Kelime Engelleyici Kurulumu')
            .setColor(0xFEE75C)
            .setDescription('Aşağıdan kelime engelleme sistemini aktif etmek istediğin sunucuyu seç.');

        const setupMsg = await message.reply({ embeds: [setupEmbed], components: [new ActionRowBuilder().addComponents(select)] });

        const collector = setupMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
        
        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) return;

            const guildId = interaction.values[0];
            const guildName = client.guilds.cache.get(guildId).name;
            
            await interaction.reply({ embeds: [new EmbedBuilder().setTitle('📝 Kelime Belirleme').setColor(0x57F287).setDescription(`**${guildName}** seçildi!\n\nYasaklamak istediğin kelimeyi (tek kelime) buraya yaz. *(30 saniye)*`)] });
            
            const filter = m => m.author.id === message.author.id;
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });
            
            if (collected.size > 0) {
                const word = collected.first().content.toLowerCase();
                const list = serverBannedWords.get(guildId) || [];
                list.push(word);
                serverBannedWords.set(guildId, list);
                
                message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Başarılı').setColor(0x57F287).setDescription(`**${guildName}** sunucusunda \`${word}\` kelimesi yasaklandı!`)] });
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
            
            message.author.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Uyarı: Yasaklı Kelime').setColor(0xED4245).setDescription(`**${message.guild.name}** sunucusunda yasaklı bir kelime (\`${word}\`) kullandığın için mesajın silindi.`).setTimestamp()] }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
