import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const numberToYoutubeUrl = {
    1: 'https://www.youtube.com/watch?v=xxxxxxx1',
    2: 'https://www.youtube.com/watch?v=xxxxxxx2',
    // ... 3～60まで
};

const TARGET_CHANNEL_ID = 'CHANNEL_ID'; // 実際のIDに変更

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const num = parseInt(message.content, 10);
    if (!isNaN(num) && num >= 1 && num <= 60) {
        const url = numberToYoutubeUrl[num];
        if (url) {
            await message.reply(`番号${num}に割り当てられたYouTube動画はこちら: ${url}`);
        } else {
            await message.reply(`番号${num}にはまだURLが割り当てられていません。`);
        }
    }
});

client.login('YOUR_BOT_TOKEN');
