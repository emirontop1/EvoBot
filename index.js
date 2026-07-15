const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, 
    ChannelType, PermissionsBitField, Events 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');
const express = require('express');
require('dotenv').config();

// ==========================================
// ÖNEMLİ: Discord Developer Portal -> Bot sekmesinde
// "MESSAGE CONTENT INTENT" ve "SERVER MEMBERS INTENT"
// açık olmalı, yoksa aşağıdaki kod hiç çalışmaz
// (message.content boş gelir, komutlar tetiklenmez).
// ==========================================

// Render 7/24 Aktif Tutma Sunucusu
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('EvoBot 7/24 Aktif!');
});

app.listen(PORT, () => {
    console.log(`Web sunucusu ${PORT} portunda başarıyla başlatıldı.`);
});

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages 
    ],
    partials: [
        Partials.Channel, 
        Partials.Message
    ]
});

client.on('error', (err) => console.error('[CLIENT ERROR]', err));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED REJECTION]', err));

// Sunucu ID -> Yasaklı Kelimeler Listesi
const serverBannedWords = new Map();

client.once(Events.ClientReady, (readyClient) => {
    console.log(`[AKTİF] ${readyClient.user.tag} sisteme giriş yaptı. Geliştiriciler: Rizza & Emoc.`);
});

// Karşılama Sistemi
client.on(Events.GuildMemberAdd, async (member) => {
    const welcomeChannel = member.guild.systemChannel || member.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText);
    if (!welcomeChannel) return;

    const welcomeEmbed = new EmbedBuilder()
        .setTitle('🎉 Sunucumuza Hoş Geldin!')
        .setColor(0x57F287)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`Merhaba ${member}, **${member.guild.name}** sunucusuna hoş geldin!\nSeninle birlikte **${member.guild.memberCount}** kişi olduk.`)
        .setFooter({ text: 'Rizza & Emoc Karşılama Sistemi' })
        .setTimestamp();

    welcomeChannel.send({ embeds: [welcomeEmbed] }).catch((e) => console.error('[WELCOME]', e));
});

client.on(Events.MessageCreate, async (message) => {
    try {
        if (message.author.bot) return;

        if (message.channel.type === ChannelType.DM) {
            console.log(`[DM LOG] ${message.author.username}: ${message.content}`);
        }

        const args = message.content.trim().split(/ +/);
        const command = args.shift().toLowerCase();

        const sendToLogs = async (guild, embed) => {
            const logChannel = guild.channels.cache.find(ch => ch.name === 'evo-logs' && ch.type === ChannelType.GuildText);
            if (logChannel) {
                logChannel.send({ embeds: [embed] }).catch((e) => console.error('[LOG SEND]', e));
            }
        };

        // ==========================================
        // 1. GENEL KOMUTLAR
        // ==========================================

        if (command === '/help' || command === '!help') {
            const helpEmbed = new EmbedBuilder()
                .setTitle('✨ Evo-Bot Yardım Merkezi ✨')
                .setColor(0x2b2d31)
                .setDescription('Sistemleri yönetmek için kullanabileceğiniz komutlar:')
                .addFields(
                    { name: '🛠️ Genel', value: '`!help`, `!dashboard`, `!avatar`, `!serverinfo`, `!userinfo`', inline: false },
                    { name: '🎵 Müzik', value: '`!spawn <şarkı adı veya link>`, `!ayril`', inline: false },
                    { name: '🛡️ Moderasyon (Yetki Gerekir)', value: '`!clear <sayı>`, `!kick @üye`, `!ban @üye`', inline: false },
                    { name: '⚙️ Kurulum (Sadece DM)', value: '`!setup` - Kelime engelleyici kurulumunu başlatır.', inline: false }
                )
                .setThumbnail(client.user.displayAvatarURL())
                .setFooter({ text: 'Rizza ve Emoc tarafından gururla geliştirildi.', iconURL: message.author.displayAvatarURL() })
                .setTimestamp();
            return message.reply({ embeds: [helpEmbed] });
        }

        if (command === '/dashboard' || command === '!dashboard') {
            const dashboardEmbed = new EmbedBuilder()
                .setTitle('🚀 Sistem Kontrol Paneli')
                .setColor(0x5865F2)
                .setThumbnail(client.user.displayAvatarURL())
                .addFields(
                    { name: '📡 Gecikme', value: `${client.ws.ping}ms`, inline: true },
                    { name: '⏱️ Durum', value: '7/24 Aktif', inline: true },
                    { name: '🛡️ Sunucular', value: `${client.guilds.cache.size} Sunucu`, inline: true },
                    { name: '👑 Geliştiriciler', value: 'Rizza ve Emoc', inline: false }
                )
                .setFooter({ text: 'GitHub & Render Entegrasyonu' })
                .setTimestamp();
            return message.reply({ embeds: [dashboardEmbed] });
        }

        if (command === '!serverinfo') {
            if (message.channel.type === ChannelType.DM) return message.reply("Bu komut sadece sunucularda çalışır.");
            const infoEmbed = new EmbedBuilder()
                .setTitle(`${message.guild.name} | Sunucu Bilgileri`)
                .setColor(0x00FFFF)
                .setThumbnail(message.guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: '👑 Sunucu Sahibi', value: `<@${message.guild.ownerId}>`, inline: true },
                    { name: '👥 Üye Sayısı', value: `${message.guild.memberCount}`, inline: true },
                    { name: '📅 Kuruluş Tarihi', value: `<t:${Math.floor(message.guild.createdTimestamp / 1000)}:D>`, inline: true }
                );
            return message.reply({ embeds: [infoEmbed] });
        }

        if (command === '!userinfo') {
            if (message.channel.type === ChannelType.DM) return message.reply("Bu komut sadece sunucularda çalışır.");
            const member = message.mentions.members.first() || message.member;

            const userEmbed = new EmbedBuilder()
                .setTitle(`${member.user.username} - Kullanıcı Bilgisi`)
                .setColor(0x3498DB)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .addFields(
                    { name: '🆔 Kullanıcı ID', value: `${member.id}`, inline: true },
                    { name: '📅 Katılım Tarihi', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
                    { name: '🚀 Kayıt Tarihi', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: '🎭 En Yüksek Rol', value: `${member.roles.highest}`, inline: false }
                );
            return message.reply({ embeds: [userEmbed] });
        }

        if (command === '!avatar') {
            const user = message.mentions.users.first() || message.author;
            const avatarEmbed = new EmbedBuilder()
                .setTitle(`${user.username} adlı kişinin profil resmi`)
                .setColor(0xFF69B4)
                .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }));
            return message.reply({ embeds: [avatarEmbed] });
        }

        // ==========================================
        // 2. MÜZİK SİSTEMİ (TOKENSIZ / YOUTUBE & SPOTIFY)
        // ==========================================

        if (command === '!spawn') {
            if (message.channel.type === ChannelType.DM) return message.reply("❌ Müzik komutları sadece sunucularda kullanılabilir.");

            const voiceChannel = message.member.voice.channel;
            if (!voiceChannel) {
                return message.reply("❌ Müzik çalabilmem için önce bir ses kanalına katılmalısın.");
            }

            const query = args.join(' ');
            if (!query) {
                return message.reply("❌ Çalınacak bir YouTube/Spotify linki veya şarkı adı belirtmelisin! Örnek: `!spawn <link>`");
            }

            let connection;
            try {
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });

                const loadingMsg = await message.reply("🔎 Şarkı aranıyor ve yükleniyor, lütfen bekleyin...");

                let ytInfo;
                let stream;

                if (query.includes('spotify.com')) {
                    // NOT: play-dl'de Spotify desteği için play.setToken() ile
                    // client_id/client_secret ayarlanmış olması gerekir, yoksa burası patlar.
                    try {
                        const sp_data = await play.spotify(query);
                        const search = await play.search(`${sp_data.name} ${sp_data.artists[0]?.name}`, { limit: 1 });
                        if (!search || search.length === 0) throw new Error("Şarkı bulunamadı.");
                        ytInfo = search[0];
                        stream = await play.stream(ytInfo.url);
                    } catch (spErr) {
                        console.error('[SPOTIFY]', spErr);
                        connection.destroy();
                        await loadingMsg.delete().catch(() => {});
                        return message.reply("❌ Spotify linki işlenemedi. Spotify API anahtarları (`play.setToken`) ayarlı değil olabilir — bunun yerine şarkı adını veya bir YouTube linki dene.");
                    }
                } else if (query.includes('youtube.com') || query.includes('youtu.be')) {
                    const info = await play.video_info(query);
                    ytInfo = info.video_details;
                    stream = await play.stream(query);
                } else {
                    const search = await play.search(query, { limit: 1 });
                    if (!search || search.length === 0) throw new Error("Şarkı bulunamadı.");
                    ytInfo = search[0];
                    stream = await play.stream(ytInfo.url);
                }

                const resource = createAudioResource(stream.stream, { inputType: stream.type });
                const player = createAudioPlayer();

                player.play(resource);
                connection.subscribe(player);

                player.on(AudioPlayerStatus.Idle, () => {
                    connection.destroy();
                });

                player.on('error', error => {
                    console.error('Ses Oynatıcı Hatası:', error);
                    connection.destroy();
                });

                const thumbnail = ytInfo.thumbnails && ytInfo.thumbnails.length > 0 ? ytInfo.thumbnails[0].url : null;

                const playEmbed = new EmbedBuilder()
                    .setTitle('🎶 Müzik Başladı!')
                    .setColor(0x5865F2)
                    .setDescription(`**[${ytInfo.title}](${ytInfo.url})**`)
                    .setThumbnail(thumbnail)
                    .addFields(
                        { name: 'Kanal', value: `${voiceChannel.name}`, inline: true },
                        { name: 'Süre', value: `${ytInfo.durationRaw || 'Bilinmiyor'}`, inline: true }
                    )
                    .setFooter({ text: `İsteyen: ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
                    .setTimestamp();

                await loadingMsg.delete().catch(() => {});
                return message.channel.send({ embeds: [playEmbed] });

            } catch (error) {
                console.error("Müzik Hatası:", error);
                if (connection) connection.destroy();
                return message.reply(`❌ Şarkı çalınırken bir hata oluştu: \`${error.message || 'bilinmeyen hata'}\``);
            }
        }

        if (command === '!ayril') {
            if (message.channel.type === ChannelType.DM) return;
            const connection = getVoiceConnection(message.guild.id);
            if (connection) {
                connection.destroy();
                return message.reply("👋 Ses kanalından ayrıldım.");
            } else {
                return message.reply("❌ Şu an herhangi bir ses kanalında değilim.");
            }
        }

        // ==========================================
        // 3. MODERASYON KOMUTLARI
        // ==========================================

        if (command === '!clear') {
            if (message.channel.type === ChannelType.DM) return;
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                return message.reply("❌ Bu komut için `Mesajları Yönet` yetkisine sahip olmalısın.");
            }
            const amount = parseInt(args[0]);
            // Discord API bulkDelete minimum 2 mesaj ister
            if (isNaN(amount) || amount < 2 || amount > 100) {
                return message.reply("Lütfen 2 ile 100 arasında bir değer belirtin. Örn: `!clear 15`");
            }

            try {
                await message.channel.bulkDelete(amount, true);
            } catch (err) {
                console.error('[CLEAR]', err);
                return message.reply("❌ Mesajlar silinemedi (14 günden eski mesajlar toplu silinemez).");
            }

            const clearLog = new EmbedBuilder()
                .setTitle('🧹 Toplu Mesaj Temizliği')
                .setColor(0x3498DB)
                .setDescription(`**${message.channel.name}** kanalında **${amount}** adet mesaj ${message.author} tarafından temizlendi.`)
                .setTimestamp();
            sendToLogs(message.guild, clearLog);

            const successMsg = await message.channel.send(`✅ **${amount}** mesaj başarıyla silindi.`);
            setTimeout(() => successMsg.delete().catch(() => {}), 3000);
            return;
        }

        if (command === '!kick') {
            if (message.channel.type === ChannelType.DM) return;
            if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
                return message.reply("❌ Üyeleri At yetkiniz bulunmuyor.");
            }
            const target = message.mentions.members.first();
            if (!target) return message.reply("Lütfen atılacak üyeyi etiketleyin.");
            if (!target.kickable) return message.reply("❌ Bu üyeyi atmaya yetkim yetmiyor.");

            try {
                await target.kick(`Kicked by ${message.author.tag}`);
            } catch (err) {
                console.error('[KICK]', err);
                return message.reply("❌ Üye atılırken bir hata oluştu.");
            }

            const kickLog = new EmbedBuilder()
                .setTitle('👢 Üye Sunucudan Atıldı')
                .setColor(0xE67E22)
                .addFields(
                    { name: 'Atılan Üye', value: `${target.user.tag} (${target.id})` },
                    { name: 'Yetkili', value: `${message.author}` }
                )
                .setTimestamp();
            sendToLogs(message.guild, kickLog);

            return message.reply(`✅ **${target.user.tag}** başarıyla sunucudan atıldı.`);
        }

        if (command === '!ban') {
            if (message.channel.type === ChannelType.DM) return;
            if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) {
                return message.reply("❌ Üyeleri Yasakla yetkiniz bulunmuyor.");
            }
            const target = message.mentions.members.first();
            if (!target) return message.reply("Lütfen yasaklanacak üyeyi etiketleyin.");
            if (!target.bannable) return message.reply("❌ Bu üyeyi yasaklamaya yetkim yetmiyor.");

            try {
                await target.ban({ reason: `Banned by ${message.author.tag}` });
            } catch (err) {
                console.error('[BAN]', err);
                return message.reply("❌ Üye yasaklanırken bir hata oluştu.");
            }

            const banLog = new EmbedBuilder()
                .setTitle('🔨 Üye Yasaklandı')
                .setColor(0xED4245)
                .addFields(
                    { name: 'Yasaklanan Üye', value: `${target.user.tag} (${target.id})` },
                    { name: 'Yetkili', value: `${message.author}` }
                )
                .setTimestamp();
            sendToLogs(message.guild, banLog);

            return message.reply(`🔨 **${target.user.tag}** kalıcı olarak yasaklandı.`);
        }

        // ==========================================
        // 4. SETUP KOMUTU (SADECE DM)
        // ==========================================

        if (message.channel.type === ChannelType.DM && (command === '/setup' || command === '!setup')) {
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
                try {
                    if (interaction.user.id !== message.author.id) return;

                    const guildId = interaction.values[0];
                    const guildName = client.guilds.cache.get(guildId).name;

                    await interaction.reply({ embeds: [new EmbedBuilder().setTitle('📝 Kelime Belirleme').setColor(0x57F287).setDescription(`**${guildName}** seçildi!\n\nLütfen yasaklamak istediğin kelimeyi (tek kelime) buraya yaz. *(30 saniye)*`)] });

                    const filter = m => m.author.id === message.author.id;
                    const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });

                    if (collected.size > 0) {
                        const word = collected.first().content.toLowerCase();
                        const list = serverBannedWords.get(guildId) || [];
                        if (!list.includes(word)) list.push(word);
                        serverBannedWords.set(guildId, list);

                        message.channel.send({ embeds: [new EmbedBuilder().setTitle('✅ Başarılı').setColor(0x57F287).setDescription(`**${guildName}** sunucusunda \`${word}\` kelimesi başarıyla yasaklandı!`)] });
                    } else {
                        message.channel.send('⏱️ Süre doldu, kelime alınamadı.');
                    }
                } catch (err) {
                    console.error('[SETUP COLLECTOR]', err);
                }
            });
        }

        // ==========================================
        // 5. KÜFÜR ENGELLEME RADARI
        // ==========================================

        if (message.guild && serverBannedWords.has(message.guild.id)) {
            const bannedWords = serverBannedWords.get(message.guild.id);
            const content = message.content.toLowerCase();

            if (bannedWords.some(word => content.includes(word))) {
                const word = bannedWords.find(w => content.includes(w));
                await message.delete().catch(() => {});

                message.author.send({ embeds: [new EmbedBuilder().setTitle('⚠️ Uyarı: Yasaklı Kelime').setColor(0xED4245).setDescription(`**${message.guild.name}** sunucusunda yasaklı bir kelime (\`${word}\`) kullandığın için mesajın silindi.`).setTimestamp()] }).catch(() => {});

                const filterLog = new EmbedBuilder()
                    .setTitle('🛡️ Yasaklı Kelime Engellendi')
                    .setColor(0xED4245)
                    .addFields(
                        { name: 'Kullanıcı', value: `${message.author} (${message.author.id})`, inline: true },
                        { name: 'Kanal', value: `${message.channel}`, inline: true },
                        { name: 'Engellenen Kelime', value: `\`${word}\``, inline: false },
                        { name: 'Tam Mesaj', value: `\`\`\`${message.content}\`\`\`` }
                    )
                    .setTimestamp();
                sendToLogs(message.guild, filterLog);
            }
        }
    } catch (topLevelErr) {
        console.error('[MESSAGE HANDLER ERROR]', topLevelErr);
    }
});

client.login(process.env.DISCORD_TOKEN);
