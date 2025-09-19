import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import express from 'express';

// .env読込
dotenv.config();

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const MONGODB_URI = process.env.MONGODB_URI;

// 管理者のDiscordユーザーID（必要に応じて追加・変更）
const ADMIN_IDS = [
    '123456789012345678', // ←管理者IDをここに記入
    // '987654321098765432',
];

// YouTube URL割り当て（例：1～60）
const numberToYoutubeUrl = {};
for (let i = 1; i <= 60; i++) {
    numberToYoutubeUrl[i] = `https://www.youtube.com/watch?v=xxxxxxx${i}`;
}

// Mongooseモデル
import { Schema, model } from 'mongoose';
const YoutubeCountSchema = new Schema({
    url: String,
    count: { type: Number, default: 0 },
    owner: String,
    number: Number
});
const YoutubeCount = model('YoutubeCount', YoutubeCountSchema);

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

    // 管理者が代理登録できるコマンド（!代理登録 <番号> <ユーザーネーム>）
    if (message.content.startsWith('!代理登録')) {
        const authorId = message.author.id;
        if (!ADMIN_IDS.includes(authorId)) {
            return message.reply('このコマンドは管理者のみ実行できます。');
        }
        const [cmd, numStr, ...ownerArr] = message.content.split(' ');
        const num = parseInt(numStr, 10);
        const owner = ownerArr.join(' ');
        if (!num || !owner) return message.reply('使い方: !代理登録 <番号> <ユーザーネーム>');
        const url = numberToYoutubeUrl[num];
        if (!url) return message.reply('その番号には動画がありません');
        let record = await YoutubeCount.findOne({ number: num });
        if (!record) {
            record = new YoutubeCount({ url, count: 0, owner, number: num });
        } else {
            record.owner = owner;
            record.url = url;
        }
        await record.save();
        return message.reply(`管理者として、番号${num}の動画を「${owner}」に紐づけしました。`);
    }

    // 一般ユーザー用（!登録 <番号>）
    if (message.content.startsWith('!登録')) {
        const [cmd, numStr] = message.content.split(' ');
        const num = parseInt(numStr, 10);
        if (!num) return message.reply('使い方: !登録 <番号>');
        const owner = message.author.username; // Discordユーザーネームを自動取得
        const url = numberToYoutubeUrl[num];
        if (!url) return message.reply('その番号には動画がありません');
        let record = await YoutubeCount.findOne({ number: num });
        if (!record) {
            record = new YoutubeCount({ url, count: 0, owner, number: num });
        } else {
            record.owner = owner;
            record.url = url;
        }
        await record.save();
        return message.reply(`番号${num}の動画を「${owner}」に紐づけしました。`);
    }

    // 売上集計コマンド（!売上）
    if (message.content.startsWith('!売上')) {
        const authorId = message.author.id;
        const authorName = message.author.username;
        if (ADMIN_IDS.includes(authorId)) {
            // 管理者はランキング表示
            const records = await YoutubeCount.find({});
            const users = {};
            records.forEach(r => {
                if (!r.owner) return;
                if (!users[r.owner]) users[r.owner] = 0;
                users[r.owner] += r.count;
            });
            let replyMsg = '動画販売ランキング:\n';
            Object.entries(users).forEach(([u, c]) => {
                replyMsg += `${u}: ${c}本\n`;
            });
            return message.reply(replyMsg || '登録ユーザーがいません');
        } else {
            // 一般ユーザーは自分の動画のみ
            const records = await YoutubeCount.find({ owner: authorName });
            const total = records.reduce((sum, r) => sum + r.count, 0);
            return message.reply(`あなた（${authorName}）の動画は合計${total}本売れました。`);
        }
    }

    // ランダム動画変更コマンド（!動画変更 <番号>）
    if (message.content.startsWith('!動画変更')) {
        const [cmd, numStr] = message.content.split(' ');
        const num = parseInt(numStr, 10);
        if (!num || !(num >= 1 && num <= 60)) return message.reply('使い方: !動画変更 <番号>');
        // ランダム番号取得（元と同じ番号もあり得ます）
        const randNum = Math.floor(Math.random() * 60) + 1;
        const newUrl = numberToYoutubeUrl[randNum];
        let record = await YoutubeCount.findOne({ number: num });
        if (!record) {
            record = new YoutubeCount({ url: newUrl, count: 0, owner: '', number: num });
        } else {
            record.url = newUrl;
            record.owner = '';
        }
        await record.save();
        return message.reply(`番号${num}の動画をランダムに変更しました。\n新しいURL: ${newUrl}`);
    }

    // 売上データリセット（管理者のみ、ユーザー指定）（!売上リセット <ユーザーネーム>）
    if (message.content.startsWith('!売上リセット')) {
        const authorId = message.author.id;
        if (!ADMIN_IDS.includes(authorId)) {
            return message.reply('このコマンドは管理者のみ実行できます。');
        }
        const [cmd, ...userArr] = message.content.split(' ');
        const userName = userArr.join(' ');
        if (!userName) return message.reply('使い方: !売上リセット <ユーザーネーム>');
        const result = await YoutubeCount.updateMany(
            { owner: userName },
            { $set: { count: 0 } }
        );
        return message.reply(`ユーザー「${userName}」の売上データをリセットしました。`);
    }

    // 動画出力（番号入力時）（<番号>）
    const num = parseInt(message.content, 10);
    if (!isNaN(num) && num >= 1 && num <= 60) {
        const url = numberToYoutubeUrl[num];
        if (url) {
            // MongoDBでカウントアップ
            let record = await YoutubeCount.findOne({ number: num });
            if (!record) {
                record = new YoutubeCount({ url, count: 1, number: num });
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
