const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, ChannelType 
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages // DM'leri okuyabilmesi için ZORUNLU
    ],
    partials: [
        Partials.Channel, // DM kanallarını önbelleğe almadan okuyabilmesi için ZORUNLU
        Partials.Message
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
            .setTitle('✨ Evo-Bot Yardım Merkezi ✨')
            .setColor(0x2b2d31) // Modern Koyu Gri Rengi
            .setDescription('Aşağıdaki komutları kullanarak botu yönetebilirsiniz.')
            .addFields(
                { name: '🛠️ `/help`', value: 'Bu yardım menüsünü görüntüler.', inline: false },
                { name: '📊 `/dashboard`', value: 'Botun sistem durumunu ve geliştirici bilgilerini gösterir.', inline: false },
                { name: '🛡️ `/setup`', value: '*(Sadece DM)* Sunucun için kelime engelleyiciyi kurar.', inline: false }
            )
            .setThumbnail(client.user.displayAvatarURL())
            .setFooter({ text: 'Rizza ve Emoc tarafından gururla geliştirildi.', iconURL: message.author.displayAvatarURL() })
            .setTimestamp();
        
        message.reply({ embeds: [helpEmbed] });
    }

    // --- /dashboard KOMUTU ---
    if (message.content === '/dashboard') {
        const dashboardEmbed = new EmbedBuilder()
            .setTitle('🚀 Sistem Kontrol Paneli')
            .setColor(0x5865F2) // Discord Mavi/Mor Rengi
            .setThumbnail(client.user.displayAvatarURL())
            .setDescription(`Merhaba, ben **${client.user.username}**! Sistemlerim şu an stabil çalışıyor.`)
            .addFields(
                { name: '📡 Gecikme', value: `${client.ws.ping}ms`, inline: true },
                { name: '⏱️ Durum', value: '7/24 Aktif', inline: true },
                { name: '🛡️ Korunan Sunucular', value: `${client.guilds.cache.size} Sunucu`, inline: true },
                { name: '👑 Geliştiriciler', value: 'Rizza ve Emoc', inline: false }
            )
            .setFooter({ text: 'Render & GitHub üzerinden desteklenmektedir.' })
            .setTimestamp();
            
        message.reply({ embeds: [dashboardEmbed] });
    }

    // --- /setup KOMUTU (DM'den) ---
    if (message.channel.type === ChannelType.DM && message.content === '/setup') {
        const guilds = client.guilds.cache.filter(g => g.ownerId === message.author.id);
        
        if (guilds.size === 0) {
            const errorEmbed = new EmbedBuilder()
                .setColor(0xED4245) // Kırmızı
                .setTitle('❌ Hata')
                .setDescription('Sahibi olduğun ve benim de bulunduğum bir sunucu bulamadım. Lütfen önce beni sunucuna davet et!');
            return message.reply({ embeds: [errorEmbed] });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId('select_guild')
            .setPlaceholder('🛡️ Korumak istediğin sunucuyu seç...');

        guilds.forEach(g => {
            select.addOptions(new StringSelectMenuOptionBuilder().setLabel(g.name).setValue(g.id).setEmoji('📌'));
        });

        const row = new ActionRowBuilder().addComponents(select);
        
        const setupEmbed = new EmbedBuilder()
            .setTitle('⚙️ Kelime Engelleyici Kurulumu')
            .setColor(0xFEE75C) // Sarı
            .setDescription('Lütfen aşağıdan kelime engelleme sistemini aktif etmek istediğin sunucuyu seç.');

        const setupMsg = await message.reply({ embeds: [setupEmbed], components: [row] });

        // Kelime seçim kolektörü
        const collector = setupMsg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 60000 });
        
        collector.on('collect', async (interaction) => {
            if (interaction.user.id !== message.author.id) return;

            const guildId = interaction.values[0];
            const guildName = client.guilds.cache.get(guildId).name;
            
            const step2Embed = new EmbedBuilder()
                .setTitle('📝 Kelime Belirleme')
                .setColor(0x57F287) // Yeşil
                .setDescription(`**${guildName}** sunucusu seçildi!\n\nLütfen yasaklamak istediğin kelimeyi (tek kelime) buraya yaz. *(Süren 30 saniye)*`);

            await interaction.reply({ embeds: [step2Embed] });
            
            const filter = m => m.author.id === message.author.id;
            const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });
            
            if (collected.size > 0) {
                const word = collected.first().content.toLowerCase();
                const list = serverBannedWords.get(guildId) || [];
                list.push(word);
                serverBannedWords.set(guildId, list);
                
                const successEmbed = new EmbedBuilder()
                    .setTitle('✅ Kurulum Tamamlandı')
                    .setColor(0x57F287)
                    .setDescription(`Harika! Artık **${guildName}** sunucusunda \`${word}\` kelimesi kullanıldığında mesaj silinecek ve kullanıcıya uyarı DM'i gönderilecek.`);
                
                message.channel.send({ embeds: [successEmbed] });
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
            
            const warningEmbed = new EmbedBuilder()
                .setTitle('⚠️ Uyarı: Yasaklı Kelime Kullanımı')
                .setColor(0xED4245)
                .setDescription(`**${message.guild.name}** sunucusunda yasaklı bir kelime kullandığın için mesajın silindi.`)
                .addFields({ name: 'Engellenen Kelime', value: `\`${word}\``, inline: true })
                .setTimestamp();
                
            message.author.send({ embeds: [warningEmbed] }).catch(() => {});
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
