const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ChannelType, PermissionsBitField, Events, ButtonBuilder, ButtonStyle, ComponentType, ActivityType } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const tts = require('discord-tts');
const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
app.get('/', (req, res) => res.send('EvoBot Sesli Yayın Aktif!'));
app.listen(process.env.PORT || 3000);

const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
    partials: [Partials.Channel, Partials.Message] 
});

const ticketStaffRoles = new Map();
const afkUsers = new Map();
const modChannels = new Map();
const captchaRoles = new Map();

client.once(Events.ClientReady, (c) => console.log(`${c.user.tag} yayına hazır!`));

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.startsWith('!')) return;
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // MODERASYON KANALI KONTROLÜ
    const modCommands = ['clear', 'ban', 'kick', 'mute', 'lock'];
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

        // 'approved' rolünü bul veya oluştur
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

        // Kanalların izinlerini ayarla (Captcha kanalı dışındakileri gizle)
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

    // !play
    if (command === 'play') {
        const vCh = message.member.voice.channel;
        if (!vCh) return message.reply("❌ Ses kanalına gir!");
        const data = await (await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(args.join(' '))}`)).json();
        if (!data.data[0]) return message.reply("❌ Bulunamadı.");
        const conn = joinVoiceChannel({ channelId: vCh.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        const player = createAudioPlayer();
        player.play(createAudioResource(data.data[0].preview));
        conn.subscribe(player);
        message.reply(`🎶 Çalıyor: ${data.data[0].title}`);
    }

    // !help
    if (command === 'help') {
        const pages = [
            new EmbedBuilder().setTitle('🎵 Ses Sistemleri').setDescription('`!play <ad>`, `!konuş <metin>`, `!yayın`'),
            new EmbedBuilder().setTitle('🎟️ Sistemler').setDescription('`!ticket-kur @rol`, `!create captcha`, `!setmoderate #kanal`'),
            new EmbedBuilder().setTitle('🛡️ Mod').setDescription('`!clear`, `!ban`, `!kick`, `!mute`, `!lock`')
        ];
        let p = 0;
        const msg = await message.reply({ embeds: [pages[p]], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary))] });
        const col = msg.createMessageComponentCollector({ time: 60000 });
        col.on('collect', i => { i.customId === 'prev' ? p = (p > 0 ? p - 1 : pages.length - 1) : p = (p < pages.length - 1 ? p + 1 : 0); i.update({ embeds: [pages[p]] }); });
    }

    // DİĞER MODERASYON
    if (command === 'clear') { await message.channel.bulkDelete(parseInt(args[0]) || 1, true); message.reply("✅ Silindi."); }
    if (command === 'ticket-kur') { ticketStaffRoles.set(message.guild.id, message.mentions.roles.first().id); message.channel.send({ embeds: [new EmbedBuilder().setTitle('🎫 Destek')], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Aç').setStyle(ButtonStyle.Success))] }); }
    if (command === 'afk') { afkUsers.set(message.author.id, args.join(' ')); message.reply('💤 AFK.'); }
});

client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton()) return;
    
    if (i.customId === 'create_ticket') {
        const ch = await i.guild.channels.create({ name: `ticket-${i.user.username}`, type: ChannelType.GuildText });
        i.reply({ content: `✅ Kanal: ${ch}`, ephemeral: true });
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

client.login(process.env.DISCORD_TOKEN);
