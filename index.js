import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
const app = express();
const PORT = 8000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => {
  console.log(`Dummy web server running on port ${PORT}`);
});

import { Client, GatewayIntentBits, Collection } from 'discord.js';
import mongoose from 'mongoose';

import YoutubeVideo from './models/YoutubeVideo.js';
import numberToYoutubeUrl from './config/numberToYoutubeUrl.js';

const MONGODB_URI = process.env.MONGODB_URI;
const TOKEN = process.env.TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== TARGET_CHANNEL_ID) return;
  const num = parseInt(message.content, 10);
  if (!isNaN(num) && num >= 1 && num <= 60) {
    const url = numberToYoutubeUrl[num];
    if (url) {
      let video = await YoutubeVideo.findOne({ url });
      if (!video) {
        video = new YoutubeVideo({ url, count: 1 });
      } else {
        video.count += 1;
      }
      await video.save();
      await message.reply(
        `番号${num}の動画URL: ${url}\n` +
        `この動画はこれまでに${video.count}回売れました。\n` +
        (video.owner ? `所有者: ${video.owner}` : '所有者未登録')
      );
    } else {
      await message.reply(`番号${num}には動画URLがありません。`);
    }
  }
});

client.commands = new Collection();
const commands = [
  {
    name: '代理登録',
    description: '動画URLの所有者を登録（管理者のみ）',
    options: [
      { type: 3, name: '動画url', description: '動画URL', required: true },
      { type: 3, name: 'ユーザー名', description: '所有者名', required: true }
    ]
  },
  {
    name: '売上',
    description: '売上ランキングを表示'
  },
  {
    name: '売上リセット',
    description: '指定ユーザーの売上をリセット（管理者のみ）',
    options: [
      { type: 3, name: 'ユーザー名', description: 'リセットする所有者名', required: true }
    ]
  },
  {
    name: '動画シャッフル',
    description: '番号と動画URLの割り当てをランダムシャッフル（管理者のみ）'
  },
  {
    name: '全売上リセット',
    description: '全動画の売上をリセット（管理者のみ）'
  },
  {
    name: '動画一覧',
    description: '登録されている動画URLの一覧を表示（管理者のみ）'
  }
];

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName } = interaction;

  // 代理登録（管理者のみ）
  if (commandName === '代理登録') {
    await interaction.deferReply();
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.editReply('このコマンドは管理者のみ実行できます。');
    }
    const url = interaction.options.getString('動画url');
    const owner = interaction.options.getString('ユーザー名');
    if (!url) {
      return interaction.editReply('動画URLが入力されていません。');
    }
    let video = await YoutubeVideo.findOne({ url });
    if (!video) {
      video = new YoutubeVideo({ url, owner });
    } else {
      video.owner = owner;
    }
    await video.save();
    return interaction.editReply(`動画URL: ${url} の所有者を ${owner} に登録しました。`);
  }

  // 売上ランキング（誰でも見れる）
  if (commandName === '売上') {
    await interaction.deferReply();
    const videos = await YoutubeVideo.find({});
    const userSales = {};
    videos.forEach(v => {
      if (v.owner) {
        if (!userSales[v.owner]) userSales[v.owner] = 0;
        userSales[v.owner] += v.count;
      }
    });
    let replyMsg = '動画販売ランキング:\n';
    Object.entries(userSales).forEach(([u, c]) => {
      replyMsg += `${u}: ${c}本\n`;
    });
    return interaction.editReply(replyMsg || '登録ユーザーがいません');
  }

  // 売上リセット（ユーザー指定・管理者のみ）
  if (commandName === '売上リセット') {
    await interaction.deferReply();
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.editReply('このコマンドは管理者のみ実行できます。');
    }
    const owner = interaction.options.getString('ユーザー名');
    const videos = await YoutubeVideo.find({ owner });
    if (videos.length === 0) return interaction.editReply('そのユーザー名の動画が見つかりません。');
    for (const v of videos) {
      v.count = 0;
      await v.save();
    }
    return interaction.editReply(`${owner}さんの全動画売上をリセットしました。`);
  }

  // 動画シャッフル（管理者のみ）
  if (commandName === '動画シャッフル') {
    await interaction.deferReply();
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.editReply('このコマンドは管理者だけが実行できます。');
    }
    const urls = Object.values(numberToYoutubeUrl);
    const shuffled = urls.sort(() => Math.random() - 0.5);
    Object.keys(numberToYoutubeUrl).forEach((num, idx) => {
      numberToYoutubeUrl[num] = shuffled[idx];
    });
    return interaction.editReply('番号と動画URLの割り当てをランダムにシャッフルしました。');
  }

  // 全売上リセット（管理者のみ）
  if (commandName === '全売上リセット') {
    await interaction.deferReply();
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.editReply('このコマンドは管理者のみ実行できます。');
    }
    const videos = await YoutubeVideo.find({});
    for (const v of videos) {
      v.count = 0;
      await v.save();
    }
    return interaction.editReply('全動画の売上をリセットしました。');
  }

  // 動画一覧表示（管理者のみ）
  if (commandName === '動画一覧') {
    await interaction.deferReply();
    if (!ADMIN_IDS.includes(interaction.user.id)) {
      return interaction.editReply('このコマンドは管理者のみ実行できます。');
    }
    const videos = await YoutubeVideo.find({});
    if (videos.length === 0) {
      return interaction.editReply('登録されている動画はありません。');
    }
    let replyMsg = '登録されている動画URL一覧:\n';
    videos.forEach((v, idx) => {
      replyMsg += `${idx + 1}. ${v.url}${v.owner ? `（所有者: ${v.owner}）` : ''}\n`;
    });
    return interaction.editReply(replyMsg);
  }
});

client.on('ready', async () => {
  const guild = client.guilds.cache.first();
  if (!guild) return;
  await guild.commands.set(commands);
  console.log('Slash commands registered');
});

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    client.login(TOKEN);
  })
  .catch(err => console.error('MongoDB connection error:', err));
