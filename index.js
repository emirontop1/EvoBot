const { 
    Client, 
    GatewayIntentBits, 
    Partials, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ChannelType, 
    PermissionsBitField, 
    Events, 
    ButtonBuilder, 
    ButtonStyle, 
    ComponentType, 
    ActivityType,
    AttachmentBuilder
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const tts = require('discord-tts');
const express = require('express');
const fetch = require('node-fetch');
const { createCanvas } = require('canvas');
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

const PREFIX = 'E,';

// Premium Sistem Veritabanı (Render üzerinde geçici bellek - Production için veritabanı önerilir)
const ticketStaffRoles = new Map();
const afkUsers = new Map();
const modChannels = new Map(); // guildId -> channelId
const captchaSettings = new Map(); // guildId -> { roleId: string, channelId: string }

client.once(Events.ClientReady, (c) => console.log(`🚀 ${c.user.tag} premium sürümüyle yayına hazır!`));

// Captcha Görseli Oluşturma Fonksiyonu
function generateCaptcha() {
    const canvas = createCanvas(150, 50);
    const ctx = canvas.getContext('2d');
    
    // Arka plan rengi
    ctx.fillStyle = '#2c2f33';
    ctx.fillRect(0, 0, 150, 50);
    
    // Rastgele 5 haneli kod üretme
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Metin çizimi ve karalama çizgileri
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#7289da';
    ctx.fillText(code, 25, 35);
    
    // Gürültü çizgileri (Botların okumasını engellemek için)
    ctx.strokeStyle = '#99aab5';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * 150, Math.random() * 50);
        ctx.lineTo(Math.random() * 150, Math.random() * 50);
        ctx.stroke();
    }
    
    return { buffer: canvas.toBuffer(), code };
}

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // MODERASYON KANALI KONTROLÜ
    // Eğer bir moderasyon kanalı ayarlandıysa ve komut o kanal dışında yazıldıysa engelle.
    const allowedModChannel = modChannels.get(message.guild.id);
    const isModCommand = ['clear', 'ban', 'kick', 'mute', 'lock', 'setmodchannel', 'captcha-kur'].includes(command);
    
    if (isModCommand && allowedModChannel && message.channel.id !== allowedModChannel) {
        return message.reply({ 
            embeds: [
                new EmbedBuilder()
                    .setColor('#ff4757')
                    .setTitle('⚠️ Yetkisiz Kanal!')
                    .setDescription(`Bu moderasyon komutunu sadece ayarlanan kanalda kullanabilirsin: <#${allowedModChannel}>`)
            ] 
        });
    }

    // 1. E,setmodchannel <channelId> (Sadece o kanaldan mod komutları çalıştırılabilir)
    if (command === 'setmodchannel') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("❌ Bu komutu kullanmak için `Yönetici` yetkisine sahip olmalısın.");
        }
        
        const targetChannelId = args[0]?.replace(/[<#>]/g, '');
        const targetChannel = message.guild.channels.cache.get(targetChannelId);
        
        if (!targetChannel) {
            return message.reply("❌ Lütfen geçerli bir kanal ID'si veya kanal etiketleyin. Örnek: `E,setmodchannel #kanal` veya `E,setmodchannel 123456789` ");
        }

        modChannels.set(message.guild.id, targetChannel.id);
        
        message.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor('#2ecc71')
                    .setTitle('🔒 Mod Kanalı Ayarlandı!')
                    .setDescription(`Artık tüm moderatör komutları sadece ${targetChannel} kanalında çalışacak şekilde kilitlendi.`)
            ]
        });
    }

    // 2. E,captcha-kur <@rol> (Captcha doğrulama paneli oluşturur)
    if (command === 'captcha-kur') {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("❌ Bu komutu kullanmak için `Yönetici` yetkisine sahip olmalısın.");
        }

        const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
        if (!role) return message.reply("❌ Lütfen doğrulamadan sonra verilecek rolü belirtin. Örnek: `E,captcha-kur @Üye` ");

        captchaSettings.set(message.guild.id, { roleId: role.id, channelId: message.channel.id });

        const embed = new EmbedBuilder()
            .setColor('#7289da')
            .setTitle('🛡️ Sunucu Güvenlik Doğrulaması')
            .setDescription('Sunucuya erişmek ve bot korumasını geçmek için aşağıdaki butona tıkla ve ekranda beliren güvenlik kodunu doğrula.')
            .setFooter({ text: 'EvoBot Güvenlik Sistemi' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_captcha')
                .setLabel('Doğrulamayı Başlat')
                .setStyle(ButtonStyle.Success)
                .setEmoji('🛡️')
        );

        message.channel.send({ embeds: [embed], components: [row] });
        message.reply("✅ Captcha paneli başarıyla kuruldu!");
    }

    // 3. E,YAYIN (Ses kanalına girer ve statüyü günceller)
    if (command === 'yayın') {
        const vCh = message.member.voice.channel;
        if (!vCh) return message.reply("❌ Önce bir ses kanalına gir.");
        
        joinVoiceChannel({ channelId: vCh.id, guildId: message.guild.id, adapterCreator: message.guild.voiceAdapterCreator });
        client.user.setActivity('CANLI YAYIN!', { type: ActivityType.Streaming, url: 'https://twitch.tv/discord' });
        message.reply("🔴 Yayın başlatıldı! (Statü güncellendi).");
    }

    // 4. E,KONUŞ (Sesli kanalda TTS)
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

    // 5. E,PLAY (Deezer API)
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

    // 6. E,HELP (Menü)
    if (command === 'help') {
        const pages = [
            new EmbedBuilder().setTitle('🎵 Ses Sistemleri').setDescription('`E,play <ad>`, `E,konuş <metin>`, `E,yayın`'),
            new EmbedBuilder().setTitle('🎟️ Ticket & Captcha').setDescription('`E,ticket-kur @rol`, `E,captcha-kur @rol`'),
            new EmbedBuilder().setTitle('🛡️ Mod Kilit Sistemi').setDescription('`E,setmodchannel #kanal`, `E,clear`, `E,ban`, `E,kick`, `E,mute`, `E,lock`')
        ];
        let p = 0;
        const msg = await message.reply({ 
            embeds: [pages[p]], 
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('prev').setLabel('◀').setStyle(ButtonStyle.Primary), 
                    new ButtonBuilder().setCustomId('next').setLabel('▶').setStyle(ButtonStyle.Primary)
                )
            ] 
        });
        const col = msg.createMessageComponentCollector({ time: 60000 });
        col.on('collect', i => { 
            i.customId === 'prev' ? p = (p > 0 ? p - 1 : pages.length - 1) : p = (p < pages.length - 1 ? p + 1 : 0); 
            i.update({ embeds: [pages[p]] }); 
        });
    }

    // 7. DİĞER MODERASYON
    if (command === 'clear') { 
        await message.channel.bulkDelete(parseInt(args[0]) || 1, true); 
        message.reply("✅ Silindi.").then(m => setTimeout(() => m.delete(), 3000)); 
    }
    
    if (command === 'ticket-kur') { 
        const role = message.mentions.roles.first();
        if (!role) return message.reply("❌ Lütfen bir yetkili rolü etiketleyin!");
        ticketStaffRoles.set(message.guild.id, role.id); 
        message.channel.send({ 
            embeds: [new EmbedBuilder().setTitle('🎫 Destek').setDescription('Destek talebi açmak için aşağıdaki butona tıklayın.')], 
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Destek Aç').setStyle(ButtonStyle.Success))] 
        }); 
    }
    
    if (command === 'afk') { 
        afkUsers.set(message.author.id, args.join(' ') || 'Belirtilmedi'); 
        message.reply('💤 AFK moduna geçildi.'); 
    }
});

// BUTON & CAPTCHA ETKİLEŞİM YÖNETİCİSİ
client.on(Events.InteractionCreate, async (i) => {
    if (!i.isButton()) return;

    // Ticket Sistemi Tetikleyicisi
    if (i.customId === 'create_ticket') {
        const staffRoleId = ticketStaffRoles.get(i.guild.id);
        const ch = await i.guild.channels.create({ 
            name: `ticket-${i.user.username}`, 
            type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: i.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: i.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                ...(staffRoleId ? [{ id: staffRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }] : [])
            ]
        });
        await ch.send({ content: `Merhaba ${i.user}, destek ekibimiz en kısa sürede yardımcı olacaktır.` });
        return i.reply({ content: `✅ Kanal oluşturuldu: ${ch}`, ephemeral: true });
    }

    // Captcha Sistemi Tetikleyicisi
    if (i.customId === 'start_captcha') {
        const config = captchaSettings.get(i.guild.id);
        if (!config) return i.reply({ content: '❌ Captcha sistemi düzgün yapılandırılmamış.', ephemeral: true });

        // Kullanıcı zaten doğrulanmış mı kontrol et
        if (i.member.roles.cache.has(config.roleId)) {
            return i.reply({ content: '✅ Zaten başarıyla doğrulanmışsın!', ephemeral: true });
        }

        // Güvenlik görselini ve kodunu üret
        const { buffer, code } = generateCaptcha();
        const attachment = new AttachmentBuilder(buffer, { name: 'captcha.png' });

        await i.reply({
            content: 'Lütfen resimde gördüğün güvenlik kodunu aşağıdaki butonlardan doğru olanını seçerek doğrula. **Tek hakkın var!**',
            files: [attachment],
            ephemeral: true,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`cap_correct_${code}`).setLabel(code).setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('cap_wrong_1').setLabel('AJ391').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('cap_wrong_2').setLabel('M62K8').setStyle(ButtonStyle.Secondary)
                )
            ]
        });
    }

    // Doğru Captcha Butonu Tıklanırsa
    if (i.customId.startsWith('cap_correct_')) {
        const config = captchaSettings.get(i.guild.id);
        const role = i.guild.roles.cache.get(config.roleId);
        
        if (role) {
            await i.member.roles.add(role);
            await i.update({ content: '🎉 Tebrikler! Güvenlik adımını başarıyla geçtin ve üye rolün tanımlandı.', files: [], components: [] });
        } else {
            await i.update({ content: '❌ Bir hata oluştu. Verilecek rol sunucuda bulunamadı.', files: [], components: [] });
        }
    }

    // Yanlış Captcha Butonu Tıklanırsa
    if (i.customId.startsWith('cap_wrong_')) {
        await i.update({ content: '❌ Yanlış kodu seçtin! Lütfen doğrulamayı tekrar başlatmayı dene.', files: [], components: [] });
    }
});

client.login(process.env.DISCORD_TOKEN);

