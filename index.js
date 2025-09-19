import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import YoutubeCount from './models/YoutubeCount.js';
import express from 'express';

dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// YouTube URL割り当て（例：1～60）
const numberToYoutubeUrl = {};
for (let i = 1; i <= 60; i++) {
    numberToYoutubeUrl[i] = `https://www.youtube.com/watch?v=xxxxxxx${i}`;
}

// MongoDB接続
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('MongoDB connected');
}).catch(e => {
    console.error('MongoDB connection error:', e);
});

// Discord Bot初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const num = parseInt(message.content, 10);
    if (!isNaN(num) && num >= 1 && num <= 60) {
        const url = numberToYoutubeUrl[num];
        if (url) {
            // MongoDBでカウントアップ
            let record = await YoutubeCount.findOne({ url });
            if (!record) {
                record = new YoutubeCount({ url, count: 1 });
            } else {
                record.count += 1;
            }
            await record.save();

            await message.reply(
                `番号${num}に割り当てられたYouTube動画はこちら: ${url}\n` +
                `この動画URLはこれまでに${record.count}回出力されています。`
            );
        } else {
            await message.reply(`番号${num}にはまだURLが割り当てられていません。`);
        }
    }
});

client.login(TOKEN);

// ダミーHTTPサーバーでKoyebのTCPヘルスチェック対策
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Dummy server listening on port ${PORT}`);
});
