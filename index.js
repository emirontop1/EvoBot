const { 
    Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, 
    ChannelType, PermissionsBitField, Events, ButtonBuilder, ButtonStyle, ComponentType 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

// Web Sunucusu (Render vb. 7/24 Aktiflik)
const app = express();
app.get('/', (req, res) => res.send('EvoBot Tam Donanımlı Aktif! Ses sistemi düzeltildi.'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.DirectMessages 
    ],
    partials: [Partials.Channel, Partials.Message]
});

// Veri Depolama
const serverBannedWords = new Map();
const serverPrefixes = new Map();
const ticketStaffRoles = new Map();
const afkUsers = new Map();
const userWarnings = new Map();
const defaultPrefix = '!';

client.once(Events.ClientReady, (readyClient) => {
    console.log(`[AKTİF] ${readyClient.user.tag} başarıyla başlatıldı.`);
    client.user.setActivity('Tüm Sistemler Hazır', { type: 3 });
});

// --- KARŞILAMA ---
client.on(Events.GuildMemberAdd, async (member) => {
    const channel = member.guild.systemChannel || member.guild.channels.cache.find(ch => ch.type === ChannelType.GuildText);
    if (!channel) return;
    const embed = new EmbedBuilder().setTitle('🎉 Sunucuya Hoş Geldin!').setDescription(`Merhaba <@${member.id}>!`).setColor(0x57F287);
    channel.send({ embeds: [embed] }).catch(() => {});
});

// --- INTERACTION (TICKET/HELP) ---
client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId === 'create_ticket') {
        const staffRoleId = ticketStaffRoles.get(interaction.guild.id);
        const ch = await interaction.guild.channels.create({
            name: `ticket-${interaction.user.username}`,
            type: ChannelType.GuildText,
            permissionOverwrites: [{ id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }, { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] }, { id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel] }]
        });
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close_ticket').setLabel('Kanalı Kapat').setStyle(ButtonStyle.Danger));
        ch.send({ content: `${interaction.user} | <@&${staffRoleId}>`, embeds: [new EmbedBuilder().setDescription('Destek talebin oluşturuldu.')], components: [row] });
        interaction.reply({ content: `✅ Kanal: ${ch}`, ephemeral: true });
    }
    if (interaction.customId === 'close_ticket') { interaction.channel.delete().catch(() => {}); }
});

// --- KOMUT İŞLEYİCİ ---
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // AFK ve Kelime Filtresi
    if (afkUsers.has(message.author.id)) { afkUsers.delete(message.author.id); message.reply('👋 AFK bitti.'); }
    message.mentions.users.forEach(u => { if (afkUsers.has(u.id)) message.reply(`💤 AFK: ${afkUsers.get(u.id)}`); });
    
    let prefix = serverPrefixes.get(message.guild?.id) || defaultPrefix;
    if (message.guild && serverBannedWords.has(message.guild.id) && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        if (serverBannedWords.get(message.guild.id).some(w => message.content.toLowerCase().includes(w))) { await message.delete().catch(() => {}); return; }
    }

    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // -- MÜZİK (DEEZER API + HATA AYIKLAMA) --
    if (command === 'play') {
        const vCh = message.member.voice.channel;
        if (!vCh) return message.reply("❌ Ses kanalına gir!");
        const loading = await message.reply("🔎 Aranıyor...");
        try {
            const data = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(args.join(' '))}`)).json();
            const track = data.data[0];
            if (!track) return loading.edit("❌ Bulunamadı.");
            
            const conn = joinVoiceChannel({ 
                channelId: vCh.id, 
                guildId: message.guild.id, 
                adapterCreator: message.guild.voiceAdapterCreator 
            });
            
            const player = createAudioPlayer();
            const resource = createAudioResource(track.preview);
            
            player.play(resource);
            conn.subscribe(player);
            loading.edit(`🎶 Çalıyor: **${track.title}** - ${track.artist.name}`);
            
            // Eğer müzik çalarken arka planda hata olursa burası chate yazacak
            player.on('error', error => {
                console.error('Ses oynatma hatası:', error);
                message.channel.send(`❌ Ses oynatılamadı. Sunucu hatası: ${error.message}`);
            });

            player.on(AudioPlayerStatus.Idle, () => conn.destroy());
        } catch(e) { 
            console.error(e);
            loading.edit("❌ Müzik API'sine bağlanırken hata oluştu."); 
        }
    }
    if (command === 'stop') { getVoiceConnection(message.guild.id)?.destroy(); message.reply("⏹️ Müzik durdu."); }

    // -- SAYFALI HELP --
    if (command === 'help') {
        const pages = [
            new EmbedBuilder().setTitle('🎵 Müzik').setDescription('`!play <şarkıcı> <şarkı>`, `!stop`'),
            new EmbedBuilder().setTitle('🛡️ Moderasyon').setDescription('`!clear`, `!ban`, `!kick`, `!mute`, `!lock`, `!unlock`, `!nuke`, `!warn`'),
            new EmbedBuilder().setTitle('🎟️ Ticket & Ayar').setDescription('`!ticket-kur @rol`, `!setprefix <yeni>`, `!yasaklaekle <kelime>`'),
            new EmbedBuilder().setTitle('⚙️ Diğer').setDescription('`!afk`, `!oylama`, `!avatar`, `!serverinfo`, `!zar-at`, `!yazi-tura`')
        ];
        let p = 0;
        const msg = await message.reply({ embeds: [pages[p]], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary))] });
        const col = msg.createMessageComponentCollector({ time: 60000 });
        col.on('collect', i => {
            if (i.customId === 'prev') p = p > 0 ? p - 1 : pages.length - 1;
            else p = p < pages.length - 1 ? p + 1 : 0;
            i.update({ embeds: [pages[p]] });
        });
    }

    // -- MODERASYON & DİĞER --
    if (command === 'clear') { await message.channel.bulkDelete(parseInt(args[0]) || 1, true); message.reply("✅ Silindi."); }
    if (command === 'nuke') { const ch = await message.channel.clone(); ch.setPosition(message.channel.position); message.channel.delete(); }
    if (command === 'lock') { await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false }); message.reply("🔒"); }
    if (command === 'unlock') { await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: true }); message.reply("🔓"); }
    if (command === 'kick') { await message.mentions.members.first()?.kick(); message.reply("👢 Atıldı."); }
    if (command === 'ban') { await message.mentions.members.first()?.ban(); message.reply("🔨 Yasaklandı."); }
    if (command === 'mute') { await message.mentions.members.first()?.timeout(60000 * parseInt(args[1])); message.reply("🔇 Susturuldu."); }
    if (command === 'warn') { const m = message.mentions.members.first(); userWarnings.set(m.id, (userWarnings.get(m.id)||0)+1); message.reply(`⚠️ Uyarıldı! (Toplam: ${userWarnings.get(m.id)})`); }
    if (command === 'ticket-kur') { ticketStaffRoles.set(message.guild.id, message.mentions.roles.first().id); const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Aç').setStyle(ButtonStyle.Success)); message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎫 Destek')], components: [row] }); }
    if (command === 'yasaklaekle') { const list = serverBannedWords.get(message.guild.id) || []; list.push(args[0]); serverBannedWords.set(message.guild.id, list); message.reply('✅ Eklendi.'); }
    if (command === 'afk') { afkUsers.set(message.author.id, args.join(' ')); message.reply('💤 AFK oldun.'); }
    if (command === 'oylama') { const m = await message.channel.send(`📊 ${args.join(' ')}`); m.react('👍'); m.react('👎'); }
    if (command === 'setprefix') { serverPrefixes.set(message.guild.id, args[0]); message.reply('✅ Prefix değişti.'); }
});

client.login(process.env.DISCORD_TOKEN);
