const {
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
    ChannelType, PermissionsBitField, Events, ButtonBuilder, ButtonStyle,
    ComponentType, ActivityType
} = require('discord.js');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    AudioPlayerStatus, getVoiceConnection, VoiceConnectionStatus,
    entersState, StreamType
} = require('@discordjs/voice');
const tts = require('discord-tts');
const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.get('/', (req, res) => res.send('EvoBot Sesli Yayın Aktif!'));
app.listen(process.env.PORT || 3000);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel, Partials.Message]
});

// ================== ESKİ STATE (DOKUNULMADI) ==================
const ticketStaffRoles = new Map();
const afkUsers = new Map();
const modChannels = new Map();
const captchaRoles = new Map();

// ================== YENİ STATE ==================
const musicQueues = new Map();       // guildId -> { connection, player, songs: [], volume, playing, textChannelId }
const warnings = new Map();          // guildId -> Map(userId -> [ {reason, date, mod} ])
const ticketCategories = new Map();  // guildId -> categoryId
const welcomeChannels = new Map();   // guildId -> channelId
const leaveChannels = new Map();     // guildId -> channelId
const autoRoles = new Map();         // guildId -> roleId
const logChannels = new Map();       // guildId -> channelId
const antiLinkGuilds = new Set();    // guildId'ler (açık olanlar)
const lockedChannels = new Set();    // channelId'ler

function getWarnList(guildId, userId) {
    if (!warnings.has(guildId)) warnings.set(guildId, new Map());
    const guildWarns = warnings.get(guildId);
    if (!guildWarns.has(userId)) guildWarns.set(userId, []);
    return guildWarns.get(userId);
}

function sendLog(guild, embed) {
    const logChId = logChannels.get(guild.id);
    if (!logChId) return;
    const ch = guild.channels.cache.get(logChId);
    if (ch) ch.send({ embeds: [embed] }).catch(() => {});
}

function getQueue(guildId) {
    return musicQueues.get(guildId);
}

function ensureQueue(guild, textChannelId) {
    let q = musicQueues.get(guild.id);
    if (!q) {
        q = { connection: null, player: createAudioPlayer(), songs: [], volume: 100, playing: false, textChannelId };
        musicQueues.set(guild.id, q);

        q.player.on(AudioPlayerStatus.Idle, () => {
            q.songs.shift();
            if (q.songs.length > 0) {
                playNext(guild);
            } else {
                q.playing = false;
            }
        });

        q.player.on('error', (err) => {
            console.log('Player hatası:', err.message);
            q.songs.shift();
            if (q.songs.length > 0) playNext(guild);
        });
    }
    return q;
}

function playNext(guild) {
    const q = getQueue(guild.id);
    if (!q || q.songs.length === 0) return;
    const song = q.songs[0];
    const resource = createAudioResource(song.url, { inlineVolume: true });
    resource.volume.setVolume(q.volume / 100);
    q.player.play(resource);
    q.connection.subscribe(q.player);
    q.playing = true;

    const ch = guild.channels.cache.get(q.textChannelId);
    if (ch) ch.send(`🎶 Şimdi çalıyor: **${song.title}**`).catch(() => {});
}

client.once(Events.ClientReady, (c) => console.log(`${c.user.tag} yayına hazır!`));

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // ================== AFK SİSTEMİ (TAMAMLANDI) ==================
    if (afkUsers.has(message.author.id)) {
        afkUsers.delete(message.author.id);
        message.reply('👋 AFK durumun kaldırıldı, tekrar hoş geldin!').catch(() => {});
    }
    if (message.mentions.users.size > 0) {
        message.mentions.users.forEach((user) => {
            if (afkUsers.has(user.id)) {
                message.reply(`💤 **${user.username}** şu anda AFK: ${afkUsers.get(user.id)}`).catch(() => {});
            }
        });
    }

    // ================== ANTI-LINK ==================
    if (antiLinkGuilds.has(message.guild?.id) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const linkRegex = /(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/gi;
        if (linkRegex.test(message.content)) {
            await message.delete().catch(() => {});
            message.channel.send(`⚠️ ${message.author}, bu kanalda link paylaşımı yasak.`).then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
            return;
        }
    }

    if (!message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // MODERASYON KANALI KONTROLÜ
    const modCommands = ['clear', 'ban', 'kick', 'mute', 'unmute', 'lock', 'unlock', 'warn', 'unwarn', 'unban', 'slowmode', 'nick'];
    if (modCommands.includes(command)) {
        const allowedChannel = modChannels.get(message.guild.id);
        if (allowedChannel && message.channel.id !== allowedChannel) {
            return message.reply(`❌ Bu komut sadece <#${allowedChannel}> kanalında kullanılabilir.`);
        }
    }

    // !setmoderate
    if (command === 'setmoderate') {
        const channelId = args[0]?.replace(/[<#>]/g, '');
        if (!channelId) return message.reply("❌ Bir kanal ID'si veya etiketi girmelisin.");
        modChannels.set(message.guild.id, channelId);
        message.reply(`✅ Moderasyon komutları sadece <#${channelId}> kanalına kilitlendi.`);
    }

    // !create captcha
    if (command === 'create' && args[0] === 'captcha') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("❌ Bu komut için Yönetici yetkisi gereklidir.");
        }

        let approvedRole = message.guild.roles.cache.find(r => r.name === 'approved');
        if (!approvedRole) {
            try {
                approvedRole = await message.guild.roles.create({
                    name: 'approved',
                    color: '#2ecc71',
                    reason: 'Captcha doğrulama rolü'
                });
            } catch (err) {
                return message.reply("❌ 'approved' rolü oluşturulamadı. Botun yetkilerini kontrol edin.");
            }
        }

        captchaRoles.set(message.guild.id, approvedRole.id);

        message.guild.channels.cache.forEach(async (channel) => {
            try {
                if (channel.id === message.channel.id) {
                    await channel.permissionOverwrites.create(message.guild.roles.everyone, { ViewChannel: true });
                    await channel.permissionOverwrites.create(approvedRole, { ViewChannel: false });
                } else {
                    await channel.permissionOverwrites.create(message.guild.roles.everyone, { ViewChannel: false });
                    await channel.permissionOverwrites.create(approvedRole, { ViewChannel: true });
                }
            } catch (e) {
                console.log(`${channel.name} kanalının yetkileri düzenlenemedi.`);
            }
        });

        message.channel.send({
            content: "Sunucuya tam erişim sağlamak için aşağıdaki butona tıklayarak doğrulama yapın.",
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('captcha_verify').setLabel('Doğrula').setStyle(ButtonStyle.Success))]
        });
        message.reply("✅ Captcha paneli kuruldu, 'approved' rolü ayarlandı ve diğer kanallar gizlendi.");
    }

    // !yayın
    if (command === 'yayın') {
        const vCh = message.member.voice.channel;
        if (!vCh) return message.reply("❌ Önce bir ses kanalına gir.");

        joinVoiceChannel({ channelId: vCh.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        client.user.setActivity('CANLI YAYIN!', { type: ActivityType.Streaming, url: 'https://twitch.tv/discord' });
        message.reply("🔴 Yayın başlatıldı! (Statü güncellendi).");
    }

    // !konuş
    if (command === 'konuş') {
        const metin = args.join(' ');
        const vCh = message.member.voice.channel;
        if (!vCh || !metin) return message.reply("❌ Kanalda olmalısın ve metin girmelisin.");

        const connection = joinVoiceChannel({ channelId: vCh.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        const player = createAudioPlayer();
        const resource = createAudioResource(tts.getVoiceStream(metin));
        player.play(resource);
        connection.subscribe(player);
        player.on(AudioPlayerStatus.Idle, () => connection.destroy());
    }

    // !play (SIRA/QUEUE SİSTEMİYLE GÜÇLENDİRİLDİ)
    if (command === 'play') {
        const vCh = message.member.voice.channel;
        if (!vCh) return message.reply("❌ Ses kanalına gir!");
        const data = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(args.join(' '))}`)).json();
        if (!data.data[0]) return message.reply("❌ Bulunamadı.");

        const q = ensureQueue(message.guild, message.channel.id);
        if (!q.connection) {
            q.connection = joinVoiceChannel({ channelId: vCh.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        }

        q.songs.push({ title: data.data[0].title, url: data.data[0].preview });

        if (!q.playing) {
            playNext(message.guild);
        } else {
            message.reply(`➕ Sıraya eklendi: **${data.data[0].title}** (Sırada #${q.songs.length})`);
        }
    }

    // !skip
    if (command === 'skip') {
        const q = getQueue(message.guild.id);
        if (!q || !q.playing) return message.reply("❌ Şu anda çalan bir şey yok.");
        message.reply("⏭️ Şarkı geçildi.");
        q.player.stop();
    }

    // !pause
    if (command === 'pause') {
        const q = getQueue(message.guild.id);
        if (!q || !q.playing) return message.reply("❌ Çalan bir şey yok.");
        q.player.pause();
        message.reply("⏸️ Duraklatıldı.");
    }

    // !resume
    if (command === 'resume') {
        const q = getQueue(message.guild.id);
        if (!q) return message.reply("❌ Çalan bir şey yok.");
        q.player.unpause();
        message.reply("▶️ Devam ediyor.");
    }

    // !stop
    if (command === 'stop') {
        const q = getQueue(message.guild.id);
        if (q) {
            q.songs = [];
            q.player.stop();
            if (q.connection) q.connection.destroy();
            musicQueues.delete(message.guild.id);
        }
        message.reply("⏹️ Durduruldu ve sıra temizlendi.");
    }

    // !queue
    if (command === 'queue') {
        const q = getQueue(message.guild.id);
        if (!q || q.songs.length === 0) return message.reply("📭 Sıra boş.");
        const list = q.songs.map((s, i) => `${i === 0 ? '▶️' : `${i}.`} ${s.title}`).join('\n');
        message.reply({ embeds: [new EmbedBuilder().setTitle('🎶 Sıra').setDescription(list).setColor('#3498db')] });
    }

    // !volume
    if (command === 'volume') {
        const q = getQueue(message.guild.id);
        if (!q) return message.reply("❌ Aktif bir yayın yok.");
        const vol = parseInt(args[0]);
        if (isNaN(vol) || vol < 0 || vol > 200) return message.reply("❌ 0-200 arası bir değer gir.");
        q.volume = vol;
        message.reply(`🔊 Ses seviyesi %${vol} olarak ayarlandı.`);
    }

    // !join
    if (command === 'join') {
        const vCh = message.member.voice.channel;
        if (!vCh) return message.reply("❌ Önce bir ses kanalına gir.");
        const q = ensureQueue(message.guild, message.channel.id);
        q.connection = joinVoiceChannel({ channelId: vCh.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        message.reply(`✅ **${vCh.name}** kanalına katıldım.`);
    }

    // !leave / !ayrıl
    if (command === 'leave' || command === 'ayrıl') {
        const conn = getVoiceConnection(message.guild.id);
        if (!conn) return message.reply("❌ Zaten bir kanalda değilim.");
        conn.destroy();
        musicQueues.delete(message.guild.id);
        message.reply("👋 Ses kanalından ayrıldım.");
    }

    // !help
    if (command === 'help') {
        const pages = [
            new EmbedBuilder().setTitle('🎵 Ses Sistemleri').setDescription('`!play <ad>`, `!konuş <metin>`, `!yayın`, `!join`, `!leave`, `!skip`, `!pause`, `!resume`, `!stop`, `!queue`, `!volume <0-200>`'),
            new EmbedBuilder().setTitle('🎟️ Sistemler').setDescription('`!ticket-kur @rol`, `!create captcha`, `!setmoderate #kanal`, `!setwelcome #kanal`, `!setleave #kanal`, `!autorol @rol`, `!setlogs #kanal`, `!antilink on/off`'),
            new EmbedBuilder().setTitle('🛡️ Mod').setDescription('`!clear`, `!ban`, `!kick`, `!mute`, `!unmute`, `!warn`, `!warnings`, `!unwarn`, `!unban`, `!lock`, `!unlock`, `!slowmode`, `!nick`'),
            new EmbedBuilder().setTitle('🛠️ Araçlar').setDescription('`!ping`, `!userinfo`, `!serverinfo`, `!avatar`, `!say`, `!poll`, `!afk`')
        ];
        let p = 0;
        const msg = await message.reply({ embeds: [pages[p]], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary))] });
        const col = msg.createMessageComponentCollector({ time: 60000 });
        col.on('collect', i => { i.customId === 'prev' ? p = (p > 0 ? p - 1 : pages.length - 1) : p = (p < pages.length - 1 ? p + 1 : 0); i.update({ embeds: [pages[p]] }); });
    }

    // DİĞER MODERASYON (ESKİ)
    if (command === 'clear') { await message.channel.bulkDelete(parseInt(args[0]) || 1, true); message.reply("✅ Silindi."); }
    if (command === 'ticket-kur') { ticketStaffRoles.set(message.guild.id, message.mentions.roles.first().id); message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎫 Destek')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Aç').setStyle(ButtonStyle.Success))] }); }
    if (command === 'afk') { afkUsers.set(message.author.id, args.join(' ') || 'Bir sebep belirtmedi.'); message.reply('💤 AFK.'); }

    // ================== YENİ MODERASYON KOMUTLARI ==================
    if (command === 'ban') {
        const member = message.mentions.members.first();
        if (!member) return message.reply("❌ Banlanacak kullanıcıyı etiketle.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return message.reply("❌ Yetkin yok.");
        const reason = args.slice(1).join(' ') || 'Sebep belirtilmedi';
        await member.ban({ reason }).catch(() => message.reply("❌ Banlanamadı."));
        message.reply(`✅ ${member.user.tag} banlandı. Sebep: ${reason}`);
        sendLog(message.guild, new EmbedBuilder().setTitle('🔨 Ban').setDescription(`${member.user.tag} → ${reason}`).setColor('#e74c3c'));
    }

    if (command === 'unban') {
        const userId = args[0];
        if (!userId) return message.reply("❌ Bir kullanıcı ID'si girmelisin.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) return message.reply("❌ Yetkin yok.");
        await message.guild.bans.remove(userId).then(() => message.reply("✅ Ban kaldırıldı.")).catch(() => message.reply("❌ Ban kaldırılamadı."));
    }

    if (command === 'kick') {
        const member = message.mentions.members.first();
        if (!member) return message.reply("❌ Atılacak kullanıcıyı etiketle.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) return message.reply("❌ Yetkin yok.");
        const reason = args.slice(1).join(' ') || 'Sebep belirtilmedi';
        await member.kick(reason).catch(() => message.reply("❌ Atılamadı."));
        message.reply(`✅ ${member.user.tag} sunucudan atıldı. Sebep: ${reason}`);
        sendLog(message.guild, new EmbedBuilder().setTitle('👢 Kick').setDescription(`${member.user.tag} → ${reason}`).setColor('#e67e22'));
    }

    if (command === 'mute') {
        const member = message.mentions.members.first();
        if (!member) return message.reply("❌ Susturulacak kullanıcıyı etiketle.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("❌ Yetkin yok.");
        const minutes = parseInt(args[1]) || 10;
        const reason = args.slice(2).join(' ') || 'Sebep belirtilmedi';
        await member.timeout(minutes * 60 * 1000, reason).catch(() => message.reply("❌ Susturulamadı."));
        message.reply(`🔇 ${member.user.tag} ${minutes} dakika susturuldu. Sebep: ${reason}`);
    }

    if (command === 'unmute') {
        const member = message.mentions.members.first();
        if (!member) return message.reply("❌ Kullanıcıyı etiketle.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("❌ Yetkin yok.");
        await member.timeout(null).catch(() => message.reply("❌ İşlem başarısız."));
        message.reply(`🔊 ${member.user.tag} susturması kaldırıldı.`);
    }

    if (command === 'warn') {
        const member = message.mentions.members.first();
        if (!member) return message.reply("❌ Kullanıcıyı etiketle.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return message.reply("❌ Yetkin yok.");
        const reason = args.slice(1).join(' ') || 'Sebep belirtilmedi';
        const list = getWarnList(message.guild.id, member.id);
        list.push({ reason, date: new Date().toISOString(), mod: message.author.tag });
        message.reply(`⚠️ ${member.user.tag} uyarıldı. (Toplam: ${list.length}) Sebep: ${reason}`);
    }

    if (command === 'warnings') {
        const member = message.mentions.members.first() || message.member;
        const list = getWarnList(message.guild.id, member.id);
        if (list.length === 0) return message.reply(`✅ ${member.user.tag} kullanıcısının hiç uyarısı yok.`);
        const desc = list.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.mod}*`).join('\n');
        message.reply({ embeds: [new EmbedBuilder().setTitle(`⚠️ ${member.user.tag} - Uyarılar`).setDescription(desc).setColor('#f1c40f')] });
    }

    if (command === 'unwarn') {
        const member = message.mentions.members.first();
        const index = parseInt(args[1]) - 1;
        if (!member || isNaN(index)) return message.reply("❌ Kullanım: !unwarn @kullanıcı <sıra_no>");
        const list = getWarnList(message.guild.id, member.id);
        if (!list[index]) return message.reply("❌ Bu numarada bir uyarı yok.");
        list.splice(index, 1);
        message.reply(`✅ Uyarı silindi. Kalan: ${list.length}`);
    }

    if (command === 'lock') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ Yetkin yok.");
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
        lockedChannels.add(message.channel.id);
        message.reply("🔒 Kanal kilitlendi.");
    }

    if (command === 'unlock') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ Yetkin yok.");
        await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
        lockedChannels.delete(message.channel.id);
        message.reply("🔓 Kanal kilidi açıldı.");
    }

    if (command === 'slowmode') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ Yetkin yok.");
        const seconds = parseInt(args[0]) || 0;
        await message.channel.setRateLimitPerUser(seconds);
        message.reply(seconds === 0 ? "✅ Yavaş mod kapatıldı." : `🐢 Yavaş mod ${seconds} saniye olarak ayarlandı.`);
    }

    if (command === 'nick') {
        const member = message.mentions.members.first();
        if (!member) return message.reply("❌ Kullanıcıyı etiketle.");
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageNicknames)) return message.reply("❌ Yetkin yok.");
        const newNick = args.slice(1).join(' ');
        await member.setNickname(newNick).catch(() => message.reply("❌ Takma isim değiştirilemedi."));
        message.reply(`✅ ${member.user.tag} kullanıcısının takma ismi "${newNick}" olarak değiştirildi.`);
    }

    // ================== SUNUCU YÖNETİMİ ==================
    if (command === 'setwelcome') {
        const channelId = args[0]?.replace(/[<#>]/g, '');
        if (!channelId) return message.reply("❌ Bir kanal etiketle.");
        welcomeChannels.set(message.guild.id, channelId);
        message.reply(`✅ Hoş geldin mesajları <#${channelId}> kanalına ayarlandı.`);
    }

    if (command === 'setleave') {
        const channelId = args[0]?.replace(/[<#>]/g, '');
        if (!channelId) return message.reply("❌ Bir kanal etiketle.");
        leaveChannels.set(message.guild.id, channelId);
        message.reply(`✅ Ayrılma mesajları <#${channelId}> kanalına ayarlandı.`);
    }

    if (command === 'autorol') {
        const role = message.mentions.roles.first();
        if (!role) return message.reply("❌ Bir rol etiketle.");
        autoRoles.set(message.guild.id, role.id);
        message.reply(`✅ Yeni üyelere otomatik olarak **${role.name}** rolü verilecek.`);
    }

    if (command === 'setlogs') {
        const channelId = args[0]?.replace(/[<#>]/g, '');
        if (!channelId) return message.reply("❌ Bir kanal etiketle.");
        logChannels.set(message.guild.id, channelId);
        message.reply(`✅ Log kayıtları <#${channelId}> kanalına yönlendirilecek.`);
    }

    if (command === 'antilink') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return message.reply("❌ Yetkin yok.");
        if (args[0] === 'on') { antiLinkGuilds.add(message.guild.id); message.reply("✅ Anti-link aktif edildi."); }
        else if (args[0] === 'off') { antiLinkGuilds.delete(message.guild.id); message.reply("✅ Anti-link kapatıldı."); }
        else message.reply("❌ Kullanım: !antilink on / off");
    }

    if (command === 'ticket-kategori') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return message.reply("❌ Yetkin yok.");
        const categoryId = args[0];
        if (!categoryId) return message.reply("❌ Bir kategori ID'si gir.");
        ticketCategories.set(message.guild.id, categoryId);
        message.reply("✅ Ticket kategorisi ayarlandı.");
    }

    // ================== ARAÇLAR / UTILITY ==================
    if (command === 'ping') {
        message.reply(`🏓 Pong! Gecikme: ${Date.now() - message.createdTimestamp}ms | API: ${Math.round(client.ws.ping)}ms`);
    }

    if (command === 'userinfo') {
        const member = message.mentions.members.first() || message.member;
        const embed = new EmbedBuilder()
            .setTitle(`👤 ${member.user.tag}`)
            .setThumbnail(member.user.displayAvatarURL())
            .addFields(
                { name: 'ID', value: member.id, inline: true },
                { name: 'Katılma Tarihi', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`, inline: true },
                { name: 'Hesap Oluşturma', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:D>`, inline: true },
                { name: 'Roller', value: member.roles.cache.map(r => r.name).join(', ') || 'Yok' }
            )
            .setColor('#9b59b6');
        message.reply({ embeds: [embed] });
    }

    if (command === 'serverinfo') {
        const g = message.guild;
        const embed = new EmbedBuilder()
            .setTitle(`🏰 ${g.name}`)
            .setThumbnail(g.iconURL())
            .addFields(
                { name: 'Üye Sayısı', value: `${g.memberCount}`, inline: true },
                { name: 'Kanal Sayısı', value: `${g.channels.cache.size}`, inline: true },
                { name: 'Rol Sayısı', value: `${g.roles.cache.size}`, inline: true },
                { name: 'Sahip', value: `<@${g.ownerId}>`, inline: true },
                { name: 'Oluşturma Tarihi', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`, inline: true }
            )
            .setColor('#1abc9c');
        message.reply({ embeds: [embed] });
    }

    if (command === 'avatar') {
        const user = message.mentions.users.first() || message.author;
        message.reply({ embeds: [new EmbedBuilder().setTitle(`${user.tag} - Avatar`).setImage(user.displayAvatarURL({ size: 512 })).setColor('#e67e22')] });
    }

    if (command === 'say') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return message.reply("❌ Yetkin yok.");
        const text = args.join(' ');
        if (!text) return message.reply("❌ Bir metin gir.");
        message.delete().catch(() => {});
        message.channel.send(text);
    }

    if (command === 'poll') {
        const parts = args.join(' ').split('|').map(p => p.trim()).filter(Boolean);
        if (parts.length < 2) return message.reply("❌ Kullanım: !poll Soru | Seçenek1 | Seçenek2 ...");
        const question = parts[0];
        const options = parts.slice(1, 11);
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
        const desc = options.map((o, i) => `${numberEmojis[i]} ${o}`).join('\n');
        const pollMsg = await message.channel.send({ embeds: [new EmbedBuilder().setTitle(`📊 ${question}`).setDescription(desc).setColor('#3498db')] });
        for (let i = 0; i < options.length; i++) await pollMsg.react(numberEmojis[i]);
    }
});

// ================== BUTONLAR ==================
client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton()) return;

    if (i.customId === 'create_ticket') {
        const categoryId = ticketCategories.get(i.guild.id);
        const staffRoleId = ticketStaffRoles.get(i.guild.id);
        const overwrites = [
            { id: i.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ];
        if (staffRoleId) overwrites.push({ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] });

        const ch = await i.guild.channels.create({
            name: `ticket-${i.user.username}`,
            type: ChannelType.GuildText,
            parent: categoryId || null,
            permissionOverwrites: overwrites
        });

        await ch.send({
            embeds: [new EmbedBuilder().setTitle('🎫 Destek Talebi').setDescription(`${i.user}, bir yetkili en kısa sürede seninle ilgilenecek.`)],
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Kapat').setStyle(ButtonStyle.Danger))]
        });

        i.reply({ content: `✅ Kanal: ${ch}`, ephemeral: true });
    }

    if (i.customId === 'close_ticket') {
        await i.reply({ content: '🔒 Bu ticket 5 saniye içinde kapatılacak...', ephemeral: false });
        setTimeout(() => i.channel.delete().catch(() => {}), 5000);
    }

    // CAPTCHA DOĞRULAMA İŞLEMİ
    if (i.customId === 'captcha_verify') {
        const roleId = captchaRoles.get(i.guild.id);
        if (!roleId) return i.reply({ content: '❌ Captcha sistemi ayarlanmamış.', ephemeral: true });

        const role = i.guild.roles.cache.get(roleId);
        if (role) {
            await i.member.roles.add(role);
            i.reply({ content: '✅ Başarıyla doğrulandın, kanallara artık erişebilirsin!', ephemeral: true });
        } else {
            i.reply({ content: '❌ approved rolü bulunamadı.', ephemeral: true });
        }
    }
});

// ================== ÜYE KATILMA / AYRILMA ==================
client.on(Events.GuildMemberAdd, async (member) => {
    const welcomeChId = welcomeChannels.get(member.guild.id);
    if (welcomeChId) {
        const ch = member.guild.channels.cache.get(welcomeChId);
        if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('👋 Hoş geldin!').setDescription(`${member} sunucumuza katıldı! Artık **${member.guild.memberCount}** kişiyiz.`).setColor('#2ecc71').setThumbnail(member.user.displayAvatarURL())] }).catch(() => {});
    }

    const autoRoleId = autoRoles.get(member.guild.id);
    if (autoRoleId) {
        const role = member.guild.roles.cache.get(autoRoleId);
        if (role) member.roles.add(role).catch(() => {});
    }

    sendLog(member.guild, new EmbedBuilder().setTitle('📥 Üye Katıldı').setDescription(`${member.user.tag}`).setColor('#2ecc71'));
});

client.on(Events.GuildMemberRemove, async (member) => {
    const leaveChId = leaveChannels.get(member.guild.id);
    if (leaveChId) {
        const ch = member.guild.channels.cache.get(leaveChId);
        if (ch) ch.send({ embeds: [new EmbedBuilder().setTitle('👋 Görüşürüz').setDescription(`${member.user.tag} sunucudan ayrıldı.`).setColor('#e74c3c')] }).catch(() => {});
    }
    sendLog(member.guild, new EmbedBuilder().setTitle('📤 Üye Ayrıldı').setDescription(`${member.user.tag}`).setColor('#e74c3c'));
});

// ================== LOG: MESAJ SİLME / DÜZENLEME ==================
client.on(Events.MessageDelete, (message) => {
    if (!message.guild || message.author?.bot) return;
    sendLog(message.guild, new EmbedBuilder().setTitle('🗑️ Mesaj Silindi').setDescription(`**Kanal:** ${message.channel}\n**Yazar:** ${message.author?.tag}\n**İçerik:** ${message.content || '*(içerik yok)*'}`).setColor('#e67e22'));
});

client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
    if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    sendLog(oldMsg.guild, new EmbedBuilder().setTitle('✏️ Mesaj Düzenlendi').setDescription(`**Kanal:** ${oldMsg.channel}\n**Yazar:** ${oldMsg.author?.tag}\n**Önce:** ${oldMsg.content || '*(yok)*'}\n**Sonra:** ${newMsg.content || '*(yok)*'}`).setColor('#f1c40f'));
});

client.login(process.env.DISCORD_TOKEN);
