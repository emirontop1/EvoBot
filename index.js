const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, 
    ChannelType, PermissionsBitField, Events 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, getVoiceConnection } = require('@discordjs/voice');
const prism = require('prism-media');
const ffmpegPath = require('ffmpeg-static');
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config();

// ==========================================
// RAPIDAPI YOUTUBE MP3 API KONFIGÜRASYONU
// ==========================================
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'c117d04483msh4264758dcda6a40p10e853jsnf21edfc88ecb';
const RAPIDAPI_HOST = 'youtube-mp310.p.rapidapi.com';
const API_URL = `https://${RAPIDAPI_HOST}/download/mp3`;

// ==========================================
// YT-AUDIO-API (RAPIDAPI TABANLI)
// ==========================================
const API_PORT = process.env.API_PORT || 3001;
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
const TOKEN_EXPIRY = 5 * 60 * 1000; // 5 dakika

const tokens = new Map();

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function generateToken() {
    return crypto.randomBytes(16).toString('base64url');
}

function cleanupExpiredFiles() {
    const now = Date.now();
    for (const [token, data] of tokens.entries()) {
        if (now - data.createdAt > TOKEN_EXPIRY) {
            try {
                if (fs.existsSync(data.filePath)) {
                    fs.unlinkSync(data.filePath);
                }
            } catch (e) {}
            tokens.delete(token);
        }
    }
}

setInterval(cleanupExpiredFiles, 5 * 60 * 1000);

// ==========================================
// RAPIDAPI ÜZERİNDEN MP3 İNDİR
// ==========================================
async function downloadFromRapidAPI(url) {
    try {
        // YouTube URL'sini temizle
        let cleanUrl = url;
        if (url.includes('youtu.be')) {
            const idMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
            if (idMatch) {
                cleanUrl = `https://www.youtube.com/watch?v=${idMatch[1]}`;
            }
        } else if (url.includes('youtube.com/shorts/')) {
            const idMatch = url.match(/shorts\/([a-zA-Z0-9_-]{11})/);
            if (idMatch) {
                cleanUrl = `https://www.youtube.com/watch?v=${idMatch[1]}`;
            }
        }

        console.log(`[RAPIDAPI] İstek gönderiliyor: ${cleanUrl}`);

        // RapidAPI'ye istek at
        const response = await fetch(`${API_URL}?url=${encodeURIComponent(cleanUrl)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-rapidapi-host': RAPIDAPI_HOST,
                'x-rapidapi-key': RAPIDAPI_KEY
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Hatası: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('[RAPIDAPI] Yanıt:', JSON.stringify(data).substring(0, 200));

        // API yanıtını kontrol et
        if (data.error) {
            throw new Error(`API Hatası: ${data.error}`);
        }

        // MP3 dosyasının URL'sini al (farklı formatlara göre)
        let mp3Url = null;
        let title = 'Bilinmeyen Şarkı';
        let duration = 0;
        let thumbnail = null;

        if (data.mp3 || data.downloadUrl || data.url) {
            mp3Url = data.mp3 || data.downloadUrl || data.url;
        } else if (data.link) {
            mp3Url = data.link;
        } else if (data.data && data.data.url) {
            mp3Url = data.data.url;
        }

        // Başlık bilgisini al
        if (data.title) {
            title = data.title;
        } else if (data.Title) {
            title = data.Title;
        } else if (data.meta && data.meta.title) {
            title = data.meta.title;
        }

        // Süre bilgisini al
        if (data.duration) {
            duration = data.duration;
        } else if (data.Duration) {
            duration = data.Duration;
        } else if (data.meta && data.meta.duration) {
            duration = data.meta.duration;
        }

        // Thumbnail bilgisini al
        if (data.thumbnail) {
            thumbnail = data.thumbnail;
        } else if (data.Thumbnail) {
            thumbnail = data.Thumbnail;
        } else if (data.meta && data.meta.thumbnail) {
            thumbnail = data.meta.thumbnail;
        }

        if (!mp3Url) {
            console.error('[RAPIDAPI] MP3 URL bulunamadı, yanıt:', data);
            throw new Error('MP3 dosyası URL\'si bulunamadı');
        }

        console.log(`[RAPIDAPI] ✅ MP3 URL alındı: ${mp3Url.substring(0, 50)}...`);

        return {
            title: title,
            audioUrl: mp3Url,
            duration: duration,
            thumbnail: thumbnail
        };

    } catch (error) {
        console.error('[RAPIDAPI] Hata:', error);
        throw error;
    }
}

// ==========================================
// EXPRESS API SUNUCUSU
// ==========================================
const apiApp = express();

apiApp.get('/', async (req, res) => {
    const url = req.query.url;
    if (!url) {
        return res.status(400).json({ error: 'url parametresi gerekli' });
    }

    try {
        console.log(`[API] İstek: ${url}`);

        // RapidAPI'den MP3 indir
        const info = await downloadFromRapidAPI(url);

        const token = generateToken();
        const filename = `${token}.mp3`;
        const filePath = path.join(DOWNLOAD_DIR, filename);

        console.log(`[API] MP3 indiriliyor: ${info.audioUrl.substring(0, 50)}...`);

        // MP3 dosyasını indir
        const audioRes = await fetch(info.audioUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!audioRes.ok) {
            throw new Error(`İndirme hatası: ${audioRes.status}`);
        }

        const buffer = await audioRes.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));

        // Eğer dosya MP3 değilse (başka format geldiyse) FFmpeg ile dönüştür
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
            // MP3 olup olmadığını kontrol et
            const header = Buffer.from(buffer).slice(0, 3).toString();
            if (header !== 'ID3' && header !== '\xFF\xFB' && header !== '\xFF\xF3') {
                console.log('[API] FFmpeg ile MP3\'e dönüştürülüyor...');
                const tempPath = filePath + '.temp';
                fs.renameSync(filePath, tempPath);

                await new Promise((resolve, reject) => {
                    const ffmpeg = spawn(ffmpegPath, [
                        '-i', tempPath,
                        '-acodec', 'libmp3lame',
                        '-ab', '192k',
                        '-ar', '44100',
                        '-ac', '2',
                        filePath
                    ]);

                    ffmpeg.on('close', (code) => {
                        if (code === 0) {
                            try { fs.unlinkSync(tempPath); } catch (e) {}
                            resolve();
                        } else {
                            reject(new Error(`FFmpeg hatası: ${code}`));
                        }
                    });

                    ffmpeg.on('error', reject);
                });
            }
        }

        tokens.set(token, {
            filePath: filePath,
            filename: filename,
            createdAt: Date.now()
        });

        console.log(`[API] ✅ Başarılı! Token: ${token}`);

        res.json({
            token: token,
            title: info.title,
            duration: info.duration,
            thumbnail: info.thumbnail
        });

    } catch (error) {
        console.error('[API] ❌ Hata:', error);
        res.status(500).json({
            error: error.message || 'Bilinmeyen hata'
        });
    }
});

apiApp.get('/download', (req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.status(400).json({ error: 'token parametresi gerekli' });
    }

    const data = tokens.get(token);
    if (!data) {
        return res.status(404).json({ error: 'Geçersiz veya süresi dolmuş token' });
    }

    if (!fs.existsSync(data.filePath)) {
        tokens.delete(token);
        return res.status(404).json({ error: 'Dosya bulunamadı' });
    }

    res.download(data.filePath, data.filename, (err) => {
        if (err) {
            console.error('[DOWNLOAD] Hata:', err);
        }
    });
});

apiApp.listen(API_PORT, '0.0.0.0', () => {
    console.log(`[API] YouTube Audio API ${API_PORT} portunda başlatıldı.`);
    console.log(`[API] RapidAPI YouTube MP3 aktif!`);
});

// ==========================================
// RENDER 7/24 AKTİF TUTMA SUNUCUSU
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('EvoBot 7/24 Aktif! RapidAPI YouTube MP3 entegre.');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web sunucusu ${PORT} portunda başarıyla başlatıldı.`);
});

// ==========================================
// DISCORD BOT
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

const serverBannedWords = new Map();

client.once(Events.ClientReady, (readyClient) => {
    console.log(`[AKTİF] ${readyClient.user.tag} sisteme giriş yaptı. Geliştiriciler: Rizza & Emoc.`);
    console.log(`[API] RapidAPI YouTube MP3: ${API_URL}`);
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
// YARDIMCI FONKSİYONLAR
// ==========================================
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

function formatDuration(seconds) {
    if (!seconds) return 'Bilinmiyor';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

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
                    { name: '🎵 Müzik Sistemi', value: 'RapidAPI YouTube MP3', inline: false }
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
        // 2. MÜZİK SİSTEMİ (RAPIDAPI)
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

                const loadingMsg = await message.reply("🔎 RapidAPI üzerinden MP3 alınıyor...");

                const apiUrl = `http://localhost:${API_PORT}/?url=${encodeURIComponent(query)}`;
                console.log(`[BOT] API isteği: ${apiUrl}`);

                const tokenRes = await fetch(apiUrl);
                const data = await tokenRes.json();

                if (!tokenRes.ok || !data.token) {
                    throw new Error(data.error || 'API hatası');
                }

                const audioUrl = `http://localhost:${API_PORT}/download?token=${data.token}`;
                const title = data.title || query;
                const duration = data.duration ? formatDuration(data.duration) : 'Bilinmiyor';

                const ffmpegStream = createFfmpegAudioStream(audioUrl);
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
                    .setDescription(`**[${title}](${query})**`)
                    .setThumbnail(data.thumbnail || client.user.displayAvatarURL())
                    .addFields(
                        { name: 'Kanal', value: `${voiceChannel.name}`, inline: true },
                        { name: 'Süre', value: duration, inline: true },
                        { name: 'Kaynak', value: 'RapidAPI YouTube MP3', inline: true }
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
