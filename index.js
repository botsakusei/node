import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
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

// スラッシュコマンド定義一覧（日本語）
const commands = [
    {
        name: '登録',
        description: '自分の動画を登録します',
        options: [
            {
                name: '番号',
                description: '動画番号',
                type: 4, // INTEGER
                required: true
            }
        ]
    },
    {
        name: '代理登録',
        description: '管理者が他ユーザーの動画を代理登録します',
        options: [
            {
                name: '番号',
                description: '動画番号',
                type: 4,
                required: true
            },
            {
                name: 'ユーザー名',
                description: '登録するDiscordユーザーネーム',
                type: 3, // STRING
                required: true
            }
        ]
    },
    {
        name: '売上',
        description: '売上集計を表示します'
    },
    {
        name: '動画変更',
        description: '動画のランダム変更',
        options: [
            {
                name: '番号',
                description: '動画番号',
                type: 4,
                required: true
            }
        ]
    },
    {
        name: '売上リセット',
        description: '指定ユーザーの売上リセット（管理者のみ）',
        options: [
            {
                name: 'ユーザー名',
                description: 'リセットするDiscordユーザーネーム',
                type: 3,
                required: true
            }
        ]
    }
];

// コマンド登録（Bot起動時に一度だけ実行）
client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('スラッシュコマンドを登録しました');
    } catch (error) {
        console.error(error);
    }
    console.log(`Logged in as ${client.user.tag}`);
});

// スラッシュコマンドイベント
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, user } = interaction;

    // !登録 <番号>
    if (commandName === '登録') {
        const num = options.getInteger('番号');
        const owner = user.username;
        const url = numberToYoutubeUrl[num];
        if (!url) return interaction.reply({ content: 'その番号には動画がありません', ephemeral: true });
        let record = await YoutubeCount.findOne({ number: num });
        if (!record) {
            record = new YoutubeCount({ url, count: 0, owner, number: num });
        } else {
            record.owner = owner;
            record.url = url;
        }
        await record.save();
        return interaction.reply(`番号${num}の動画を「${owner}」に紐づけしました。`);
    }

    // !代理登録 <番号> <ユーザーネーム>
    if (commandName === '代理登録') {
        const authorId = user.id;
        if (!ADMIN_IDS.includes(authorId)) {
            return interaction.reply({ content: 'このコマンドは管理者のみ実行できます。', ephemeral: true });
        }
        const num = options.getInteger('番号');
        const owner = options.getString('ユーザー名');
        const url = numberToYoutubeUrl[num];
        if (!url) return interaction.reply({ content: 'その番号には動画がありません', ephemeral: true });
        let record = await YoutubeCount.findOne({ number: num });
        if (!record) {
            record = new YoutubeCount({ url, count: 0, owner, number: num });
        } else {
            record.owner = owner;
            record.url = url;
        }
        await record.save();
        return interaction.reply(`管理者として、番号${num}の動画を「${owner}」に紐づけしました。`);
    }

    // !売上
    if (commandName === '売上') {
        const authorId = user.id;
        const authorName = user.username;
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
            return interaction.reply(replyMsg || '登録ユーザーがいません');
        } else {
            // 一般ユーザーは自分の動画のみ
            const records = await YoutubeCount.find({ owner: authorName });
            const total = records.reduce((sum, r) => sum + r.count, 0);
            return interaction.reply(`あなた（${authorName}）の動画は合計${total}本売れました。`);
        }
    }

    // !動画変更 <番号>
    if (commandName === '動画変更') {
        const num = options.getInteger('番号');
        if (!num || !(num >= 1 && num <= 60)) return interaction.reply({ content: '使い方: !動画変更 <番号>', ephemeral: true });
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
        return interaction.reply(`番号${num}の動画をランダムに変更しました。\n新しいURL: ${newUrl}`);
    }

    // !売上リセット <ユーザーネーム>
    if (commandName === '売上リセット') {
        const authorId = user.id;
        if (!ADMIN_IDS.includes(authorId)) {
            return interaction.reply({ content: 'このコマンドは管理者のみ実行できます。', ephemeral: true });
        }
        const userName = options.getString('ユーザー名');
        if (!userName) return interaction.reply({ content: '使い方: !売上リセット <ユーザーネーム>', ephemeral: true });
        const result = await YoutubeCount.updateMany(
            { owner: userName },
            { $set: { count: 0 } }
        );
        return interaction.reply(`ユーザー「${userName}」の売上データをリセットしました。`);
    }
});

// 通常の番号入力（<番号>）はテキストメッセージで判定
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

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
