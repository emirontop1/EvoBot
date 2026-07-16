const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ChannelType, PermissionsBitField, Events, ButtonBuilder, ButtonStyle, ComponentType 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const express = require('express');
require('dotenv').config();

// Web Sunucusu (7/24 Aktif Tutma)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('EvoBot 7/24 Aktif! Deezer API entegrasyonu sağlandı.'));
app.listen(PORT, () => console.log(`Web sunucusu ${PORT} portunda başarıyla başlatıldı.`));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel, Partials.Message]
});

// Veri Depolama (Geçici Hafıza)
const serverBannedWords = new Map();
const serverPrefixes = new Map();
const ticketStaffRoles = new Map();
const afkUsers = new Map();
const userWarnings = new Map();
const defaultPrefix = '!';

client.once(Events.ClientReady, (readyClient) => {
    console.log(`[AKTİF] ${readyClient.user.tag} başarıyla başlatıldı.`);
    client.user.setActivity('Deezer API & Moderasyon', { type: 3 });
});

// --- KARŞILAMA SİSTEMİ ---
client.on(Events.GuildMemberAdd, async (member) => {
    const welcomeChannel = member.guild.systemChannel || member.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText);
    if (!welcomeChannel) return;
    const embed = new EmbedBuilder()
        .setTitle('🎉 Sunucumuza Hoş Geldin!')
        .setColor(0x57F287)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`Merhaba <@${member.id}>, **${member.guild.name}** sunucusuna hoş geldin!\nSeninle beraber **${member.guild.memberCount}** kişi olduk.`)
        .setFooter({ text: 'Rizza & Emoc Sistemleri' });
    welcomeChannel.send({ embeds: [embed] }).catch(() => {});
});

// --- INTERACTION (TICKET BUTONLARI) ---
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    const { customId, guild, user } = interaction;

    if (customId === 'create_ticket') {
        const staffRoleId = ticketStaffRoles.get(guild.id);
        const existingChannel = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase()}`);
        if (existingChannel) return interaction.reply({ content: `❌ Zaten açık bir talebiniz var: ${existingChannel}`, ephemeral: true });

        const channel = await guild.channels.create({
            name: `ticket-${user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('close_ticket').setLabel('Kanalı Kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒')
        );

        channel.send({ 
            content: `${user} | <@&${staffRoleId}>`, 
            embeds: [new EmbedBuilder().setTitle('📩 Destek Talebi').setDescription('Yetkililer birazdan sizinle ilgilenecektir.').setColor(0x5865F2)],
            components: [row] 
        });
        await interaction.reply({ content: `✅ Ticket kanalı başarıyla açıldı: ${channel}`, ephemeral: true });
    }

    if (customId === 'close_ticket') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: "❌ Bu kanalı sadece yetkililer kapatabilir.", ephemeral: true });
        }
        await interaction.reply('🔒 Kanal 5 saniye içinde kalıcı olarak siliniyor...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

// --- MESAJ & KOMUT İŞLEYİCİ ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // AFK Sistemi Kontrolleri
    if (afkUsers.has(message.author.id)) {
        afkUsers.delete(message.author.id);
        message.reply(`👋 Hoş geldin! AFK modundan çıktın.`).then(m => setTimeout(() => m.delete(), 5000));
    }

    message.mentions.users.forEach(user => {
        if (afkUsers.has(user.id)) {
            message.reply(`💤 Etiketlediğin kullanıcı şu an AFK: **${afkUsers.get(user.id)}**`);
        }
    });

    let prefix = serverPrefixes.get(message.guild?.id) || defaultPrefix;

    // Kelime Filtresi
    if (message.guild && serverBannedWords.has(message.guild.id) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        const bannedWords = serverBannedWords.get(message.guild.id);
        if (bannedWords.some(w => message.content.toLowerCase().includes(w))) {
            await message.delete().catch(() => {});
            return;
        }
    }

    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // ==========================================
    // 1. DİREKT DEEZER API MÜZİK SİSTEMİ
    // ==========================================
    if (command === 'play') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply("❌ Önce bir ses kanalına girmelisin.");
        
        const query = args.join(' ');
        if (!query) return message.reply("❌ Çalınacak şarkı adını belirtmelisin. Örnek: `!play The Weeknd Blinding Lights`");

        const loadingMsg = await message.reply("🔎 Deezer API üzerinde aranıyor...");

        try {
            // Resmi Deezer API İsteği
            const response = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}`);
            const data = await response.json();

            if (!data || !data.data || data.data.length === 0) {
                return loadingMsg.edit("❌ Deezer'da böyle bir şarkı bulunamadı.");
            }

            const track = data.data[0];
            
            // Deezer API sadece 30 saniyelik önizleme (preview) sunar
            if (!track.preview) {
                return loadingMsg.edit("❌ Bu şarkı için Deezer tarafından MP3 kaynağı (preview) sağlanmamış.");
            }

            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // Doğrudan Deezer'ın verdiği MP3 URL'sini Discord'a iletiyoruz
            const resource = createAudioResource(track.preview);
            const player = createAudioPlayer();

            player.play(resource);
            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, () => {
                connection.destroy();
            });

            const embed = new EmbedBuilder()
                .setTitle('🎵 Deezer\'dan Çalınıyor (30sn Önizleme)')
                .setDescription(`**[${track.title}](${track.link})** - ${track.artist.name}`)
                .setColor(0x00C7F2)
                .setThumbnail(track.album.cover_medium)
                .setFooter({ text: 'Veriler doğrudan resmi Deezer API üzerinden çekilmektedir.' });

            await loadingMsg.delete();
            return message.channel.send({ embeds: [embed] });

        } catch (err) {
            console.error(err);
            return loadingMsg.edit("❌ Deezer API'sine bağlanırken bir hata oluştu.");
        }
    }

    if (command === 'stop') {
        const connection = getVoiceConnection(message.guild.id);
        if (connection) {
            connection.destroy();
            return message.reply("⏹️ Müzik durduruldu ve kanaldan ayrıldım.");
        }
        return message.reply("❌ Zaten bir kanalda değilim.");
    }

    // ==========================================
    // 2. SAYFALI YARDIM MENÜSÜ (HELP)
    // ==========================================
    if (command === 'help') {
        const pages = [
            new EmbedBuilder().setTitle('🎵 Müzik Komutları (Deezer API)').setColor(0x00C7F2).setDescription(`\`${prefix}play <şarkı adı>\` - Deezer üzerinden şarkının orijinal sesini çalar.\n\`${prefix}stop\` - Müziği durdurur.`),
            new EmbedBuilder().setTitle('🌐 Genel & Eğlence').setColor(0x3498DB).setDescription(`\`${prefix}ping\`, \`${prefix}avatar\`, \`${prefix}serverinfo\`, \`${prefix}afk\`, \`${prefix}zar-at\`, \`${prefix}yazi-tura\`, \`${prefix}oylama <soru>\``),
            new EmbedBuilder().setTitle('🛡️ Moderasyon').setColor(0xE74C3C).setDescription(`\`${prefix}clear\`, \`${prefix}kick\`, \`${prefix}ban\`, \`${prefix}mute\`, \`${prefix}unmute\`, \`${prefix}warn\`, \`${prefix}lock\`, \`${prefix}unlock\`, \`${prefix}slowmode\`, \`${prefix}nuke\``),
            new EmbedBuilder().setTitle('⚙️ Ayarlar').setColor(0xF1C40F).setDescription(`\`${prefix}setprefix\`, \`${prefix}ticket-kur\`, \`${prefix}yasaklaekle\`, \`${prefix}yasaklasil\`, \`${prefix}yasaklilar\``)
        ];

        let currentPage = 0;
        const getButtons = (page) => new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prev_page').setLabel('◀ Geri').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('next_page').setLabel('İleri ▶').setStyle(ButtonStyle.Primary).setDisabled(page === pages.length - 1)
        );

        const helpMsg = await message.reply({ embeds: [pages[currentPage]], components: [getButtons(currentPage)] });
        const collector = helpMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60000 });

        collector.on('collect', async (i) => {
            if (i.user.id !== message.author.id) return i.reply({ content: '❌ Sadece komutu yazan kullanabilir.', ephemeral: true });
            if (i.customId === 'prev_page') currentPage--;
            else if (i.customId === 'next_page') currentPage++;
            await i.update({ embeds: [pages[currentPage]], components: [getButtons(currentPage)] });
        });
        collector.on('end', () => helpMsg.edit({ components: [] }).catch(() => {}));
    }

    // ==========================================
    // 3. EĞLENCE & MODERASYON & SİSTEM 
    // ==========================================
    if (command === 'afk') {
        const reason = args.join(' ') || 'Şu an meşgul.';
        afkUsers.set(message.author.id, reason);
        message.reply(`✅ Başarıyla AFK moduna geçtin. Sebep: **${reason}**`);
    }

    if (command === 'oylama') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        const soru = args.join(' ');
        if (!soru) return message.reply('❌ Oylanacak soruyu yazmalısın.');
        const msg = await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📊 Oylama Vakti!').setDescription(`**${soru}**`).setColor(0xFFFF00)] });
        await msg.react('👍'); await msg.react('👎');
        message.delete().catch(() => {});
    }

    if (command === 'ticket-kur') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const role = message.mentions.roles.first();
        if (!role) return message.reply('❌ Yetkili rolünü etiketle: `!ticket-kur @rol`');
        ticketStaffRoles.set(message.guild.id, role.id);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Talebi Aç').setStyle(ButtonStyle.Success).setEmoji('🎫'));
        message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎫 Destek Sistemi').setDescription('Aşağıdaki butona basarak özel bir kanal oluşturabilirsiniz.')], components: [row] });
    }

    if (command === 'clear') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        const count = parseInt(args[0]);
        if (!count || count < 1 || count > 100) return message.reply('❌ 1-100 arası sayı gir.');
        await message.channel.bulkDelete(count, true);
        message.reply(`✅ **${count}** mesaj silindi.`).then(m => setTimeout(() => m.delete(), 3000));
    }

    if (command === 'nuke') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
        const pos = message.channel.position;
        const clonedChannel = await message.channel.clone();
        await clonedChannel.setPosition(pos);
        await message.channel.delete();
        clonedChannel.send(`💥 Kanal ${message.author} tarafından sıfırlandı!`);
    }

    if (command === 'lock') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
        message.reply('🔒 Kanal yazmaya kapatıldı.');
    }

    if (command === 'unlock') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) return;
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true });
        message.reply('🔓 Kanal yazmaya açıldı.');
    }

    if (command === 'yasaklaekle') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        const word = args[0]?.toLowerCase();
        if (!word) return message.reply('❌ Yasaklanacak kelimeyi yazın.');
        const list = serverBannedWords.get(message.guild.id) || [];
        if (!list.includes(word)) list.push(word);
        serverBannedWords.set(message.guild.id, list);
        message.reply(`✅ \`${word}\` eklendi.`);
    }

    if (command === 'setprefix') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        const newPrefix = args[0];
        if (!newPrefix) return message.reply('❌ Yeni ön ek belirtin.');
        serverPrefixes.set(message.guild.id, newPrefix);
        message.reply(`✅ Prefix **${newPrefix}** yapıldı.`);
    }
});

client.login(process.env.DISCORD_TOKEN);
