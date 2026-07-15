const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, 
    ChannelType, PermissionsBitField, Events 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const express = require('express');
require('dotenv').config();

// ==========================================
// RENDER 7/24 AKTİF TUTMA SUNUCUSU
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('EvoBot 7/24 Aktif! Zırhlı Bağlantı Koruması Devrede.');
});

app.listen(PORT, () => {
    console.log(`Web sunucusu ${PORT} portunda başarıyla başlatıldı.`);
});

// ==========================================
// YENİ: ÖZEL YT-AUDIO-API ENTEGRASYONU
// ==========================================
const YT_AUDIO_API_URL = process.env.YT_AUDIO_API_URL || 'http://localhost:5000';

async function getAudioFromMyApi(query) {
    try {
        // 1. API'den token al
        const tokenRes = await fetch(`${YT_AUDIO_API_URL}/?url=${encodeURIComponent(query)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (!tokenRes.ok) {
            const errorText = await tokenRes.text();
            throw new Error(`API Token Hatası: ${tokenRes.status} - ${errorText}`);
        }
        
        const data = await tokenRes.json();
        if (!data.token) throw new Error('API token döndürmedi.');
        
        // 2. Token ile indirme URL'sini oluştur
        const audioDownloadUrl = `${YT_AUDIO_API_URL}/download?token=${data.token}`;
        
        // 3. Video bilgilerini al (API'den gelmiyorsa başlık olarak query'yi kullan)
        const title = query.includes('youtube.com') || query.includes('youtu.be') 
            ? 'YouTube Şarkısı' 
            : query;
        
        return {
            title: title,
            url: query,
            audioUrl: audioDownloadUrl,
            durationRaw: 'Bilinmiyor',
            thumbnail: null
        };
    } catch (error) {
        throw new Error(`API Hatası: ${error.message}`);
    }
}

// ==========================================
// YARDIMCI FONKSİYONLAR
// ==========================================
function extractYoutubeId(url) {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

async function getSpotifyTrackName(url) {
    try {
        const data = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
        const json = await data.json();
        return json.title || 'Spotify Şarkısı';
    } catch {
        return 'Spotify Şarkısı';
    }
}

function formatDuration(seconds) {
    if (!seconds) return 'Bilinmiyor';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function createFfmpegAudioStream(audioUrl) {
    return new prism.FFmpeg({
        command: ffmpegPath,
        args: [
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '5',
            '-i', audioUrl,
            '-analyzeduration', '0',
            '-loglevel', '0',
            '-f', 's16le',
            '-ar', '48000',
            '-ac', '2',
        ],
    });
}

// ==========================================
// DISCORD CLIENT
// ==========================================
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
    console.log(`[API] YouTube Audio API: ${YT_AUDIO_API_URL}`);
});

// ==========================================
// KARŞILAMA SİSTEMİ
// ==========================================
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

// ==========================================
// MESAJ YAKALAYICI
// ==========================================
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
                    { name: '👑 Geliştiriciler', value: 'Rizza ve Emoc', inline: false },
                    { name: '🎵 Müzik API', value: YT_AUDIO_API_URL, inline: false }
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
        // 2. MÜZİK SİSTEMİ (API ENTEGRASYONLU)
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

                const loadingMsg = await message.reply("🔎 Özel API üzerinden şarkı aranıyor ve dönüştürülüyor...");

                let searchQuery = query;

                // Spotify linki ise başlığını al
                if (query.includes('spotify.com')) {
                    searchQuery = await getSpotifyTrackName(query);
                }

                // API'den ses bilgisini al
                const audioInfo = await getAudioFromMyApi(searchQuery);

                const ffmpegStream = createFfmpegAudioStream(audioInfo.audioUrl);
                const resource = createAudioResource(ffmpegStream, { inputType: StreamType.Raw });
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

                const playEmbed = new EmbedBuilder()
                    .setTitle('🎶 Müzik Başladı!')
                    .setColor(0x5865F2)
                    .setDescription(`**[${audioInfo.title}](${audioInfo.url})**`)
                    .setThumbnail(audioInfo.thumbnail || client.user.displayAvatarURL())
                    .addFields(
                        { name: 'Kanal', value: `${voiceChannel.name}`, inline: true },
                        { name: 'Süre', value: `${audioInfo.durationRaw}`, inline: true },
                        { name: 'Kaynak', value: 'Özel YouTube Audio API', inline: true }
                    )
                    .setFooter({ text: `İsteyen: ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
                    .setTimestamp();

                await loadingMsg.delete().catch(() => {});
                return message.channel.send({ embeds: [playEmbed] });

            } catch (error) {
                console.error("Müzik Hatası:", error);
                if (connection) connection.destroy();
                return message.reply(`❌ Şarkı çalınırken bir hata oluştu: \`${error.message || 'Bilinmeyen hata'}\``);
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
