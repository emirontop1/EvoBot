const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, 
    ChannelType, PermissionsBitField, Events, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const play = require('play-dl');
const express = require('express');
require('dotenv').config();

// Web Sunucusu (Render vb. platformlar için)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('EvoBot 7/24 Aktif!'));
app.listen(PORT, () => console.log(`Web sunucusu ${PORT} portunda başarıyla başlatıldı.`));

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel, Partials.Message]
});

// Veri Depolama (Hafıza)
const serverBannedWords = new Map();
const serverPrefixes = new Map();
const ticketStaffRoles = new Map();
const defaultPrefix = '!';

client.once(Events.ClientReady, (readyClient) => {
    console.log(`[AKTİF] ${readyClient.user.tag} başarıyla başlatıldı.`);
    client.user.setActivity('Rizza & Emoc Sistemleri', { type: 3 });
});

// --- KARŞILAMA SİSTEMİ ---
client.on(Events.GuildMemberAdd, async (member) => {
    const welcomeChannel = member.guild.systemChannel || member.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText);
    if (!welcomeChannel) return;
    const embed = new EmbedBuilder()
        .setTitle('🎉 Sunucumuza Hoş Geldin!')
        .setColor(0x57F287)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setDescription(`Merhaba ${member}, **${member.guild.name}** sunucusuna hoş geldin! İyi vakit geçirmen dileğiyle.`)
        .setFooter({ text: 'Rizza & Emoc Karşılama' });
    welcomeChannel.send({ embeds: [embed] }).catch(() => {});
});

// --- INTERACTION (TICKET BUTONLARI) ---
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    const { customId, guild, member, user } = interaction;

    if (customId === 'create_ticket') {
        const staffRoleId = ticketStaffRoles.get(guild.id);
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
            embeds: [new EmbedBuilder().setTitle('📩 Destek Talebi').setDescription('Yetkililer birazdan ilgilenecektir.').setColor(0x5865F2)],
            components: [row] 
        });
        await interaction.reply({ content: `✅ Ticket kanalı açıldı: ${channel}`, ephemeral: true });
    }

    if (customId === 'close_ticket') {
        await interaction.reply('🔒 Kanal 5 saniye içinde siliniyor...');
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
});

// --- MESAJ & KOMUT İŞLEYİCİ ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

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

    // --- GENEL KOMUTLAR ---
    if (command === 'help') {
        const embed = new EmbedBuilder().setTitle('✨ EvoBot Komut Listesi').setColor(0x2b2d31)
            .addFields(
                { name: '🎟️ Ticket', value: `\`${prefix}ticket-kur @rol\`` },
                { name: '📊 Oylama', value: `\`${prefix}oylama <soru>\`` },
                { name: '🛡️ Moderasyon', value: `\`${prefix}clear <sayı>, !kick @üye, !ban @üye, !mute @üye, !lock, !unlock\`` },
                { name: '🎵 Müzik', value: `\`${prefix}spawn <isim/link>, !pause, !resume, !ayril\`` },
                { name: '⚙️ Ayarlar', value: `\`${prefix}setprefix <char>, !yasaklaekle <kelime>, !yasaklasil <kelime>, !yasaklilar\`` }
            );
        message.reply({ embeds: [embed] });
    }

    // --- TICKET KURULUM ---
    if (command === 'ticket-kur') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return message.reply('❌ Yetkin yok.');
        const role = message.mentions.roles.first();
        if (!role) return message.reply('Bir yetkili rolü etiketle: `!ticket-kur @rol`');
        ticketStaffRoles.set(message.guild.id, role.id);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Talebi Aç').setStyle(ButtonStyle.Primary).setEmoji('🎫')
        );
        message.channel.send({ 
            embeds: [new EmbedBuilder().setTitle('🎫 Destek Sistemi').setDescription('Butona basarak destek talebi oluştur.').setColor(0x57F287)],
            components: [row]
        });
    }

    // --- KELİME FİLTRESİ YÖNETİMİ ---
    if (command === 'yasaklaekle') {
        const word = args[0]?.toLowerCase();
        if (!word) return message.reply('Kelime gir!');
        const list = serverBannedWords.get(message.guild.id) || [];
        list.push(word);
        serverBannedWords.set(message.guild.id, list);
        message.reply(`✅ \`${word}\` eklendi.`);
    }

    if (command === 'yasaklasil') {
        const word = args[0]?.toLowerCase();
        const list = serverBannedWords.get(message.guild.id) || [];
        const filtered = list.filter(w => w !== word);
        serverBannedWords.set(message.guild.id, filtered);
        message.reply(`✅ \`${word}\` silindi.`);
    }

    if (command === 'yasaklilar') {
        const list = serverBannedWords.get(message.guild.id) || [];
        message.reply(`🚫 Yasaklılar: ${list.join(', ') || 'Yok'}`);
    }

    // --- MODERASYON ---
    if (command === 'clear') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;
        const count = parseInt(args[0]) || 1;
        await message.channel.bulkDelete(count, true);
        message.reply('✅ Temizlendi.').then(m => setTimeout(() => m.delete(), 2000));
    }

    if (command === 'lock') {
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
        message.reply('🔒 Kanal kilitlendi.');
    }

    if (command === 'unlock') {
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true });
        message.reply('🔓 Kanal açıldı.');
    }

    if (command === 'mute') {
        const member = message.mentions.members.first();
        if (!member) return message.reply('Üye etiketle!');
        await member.timeout(60000 * (parseInt(args[1]) || 5), 'Muted');
        message.reply(`🔇 ${member.user.tag} susturuldu.`);
    }

    // --- MÜZİK ---
    if (command === 'spawn') {
        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('Ses kanalına gir!');
        const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        try {
            const search = await play.search(args.join(' '), { limit: 1 });
            const stream = await play.stream(search[0].url);
            const player = createAudioPlayer();
            player.play(createAudioResource(stream.stream, { inputType: stream.type }));
            connection.subscribe(player);
            message.reply('🎶 Çalıyor: ' + search[0].title);
        } catch(e) { message.reply('Hata!'); }
    }

    if (command === 'pause') {
        const conn = getVoiceConnection(message.guild.id);
        if (conn?.state.subscription) conn.state.subscription.player.pause();
    }

    if (command === 'resume') {
        const conn = getVoiceConnection(message.guild.id);
        if (conn?.state.subscription) conn.state.subscription.player.unpause();
    }

    // --- OYLAMA ---
    if (command === 'oylama') {
        const soru = args.join(' ');
        if (!soru) return message.reply('Soru yaz!');
        const msg = await message.channel.send({ embeds: [new EmbedBuilder().setTitle('📊 Oylama').setDescription(soru)] });
        await msg.react('👍'); await msg.react('👎');
    }
});

client.login(process.env.DISCORD_TOKEN);
