const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 数字ごとのYouTube URLの対応表（例：1~5のみ。60個追加してください）
const numberToYoutubeUrl = {
    1: 'https://www.youtube.com/watch?v=xxxxxxx1',
    2: 'https://www.youtube.com/watch?v=xxxxxxx2',
    3: 'https://www.youtube.com/watch?v=xxxxxxx3',
    4: 'https://www.youtube.com/watch?v=xxxxxxx4',
    5: 'https://www.youtube.com/watch?v=xxxxxxx5',
    // ... 6～60まで追加
};

const TARGET_CHANNEL_ID = 'CHANNEL_ID'; // ここを指定チャンネルIDに変更

client.on('messageCreate', async (message) => {
    // ボット自身の発言は無視
    if (message.author.bot) return;

    // 指定チャンネル以外は無視
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    // メッセージが「1～60の数字」かどうか判定
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
