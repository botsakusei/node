import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
const app = express();
const PORT = process.env.PORT || 8000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => {
  console.log(`Dummy web server running on port ${PORT}`);
});

import { Client, GatewayIntentBits, Collection, PermissionFlagsBits, AttachmentBuilder } from 'discord.js';
import mongoose from 'mongoose';

import YoutubeVideo from './models/YoutubeVideo.js';
import numberToYoutubeUrl from './config/numberToYoutubeUrl.js';

const MONGODB_URI = process.env.MONGODB_URI;
const TOKEN = process.env.TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const TOTAL_SALES_RESET_IDS = process.env.TOTAL_SALES_RESET_IDS ? process.env.TOTAL_SALES_RESET_IDS.split(',') : [];

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
        video = new YoutubeVideo({ url, count: 1, totalCount: 1 });
      } else {
        video.count += 1;
        video.totalCount = (typeof video.totalCount === 'number' ? video.totalCount : 0) + 1;
      }
      await video.save();
      await message.reply(
        `番号${num}の動画URL: ${url}\n` +
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
    ],
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: '累計売上',
    description: '所有者ごとの累計売上ランキングをファイルで出力'
  },
  {
    name: '動画シャッフル',
    description: '番号と動画URLの割り当てをランダムシャッフル（管理者のみ）',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: '累計売上リセット',
    description: '全動画の累計売上をリセット（特定ユーザーのみ）',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: '累計売上変更',
    description: '指定ユーザーの累計売上を変更（管理者のみ）',
    options: [
      { type: 3, name: 'ユーザー名', description: '所有者名', required: true },
      { type: 4, name: '売上数', description: '新しい累計売上数', required: true }
    ],
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: '動画一覧',
    description: '登録されている動画URLの一覧をファイルで出力（管理者のみ）',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  },
  {
    name: '割り当て一覧',
    description: '現在の番号の動画割り当てと所有者一覧をファイルで出力（管理者のみ）',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  }
];

// 文字数制限対策: 長文出力はファイル送信
async function replyWithPossibleFile(interaction, replyMsg, filename = 'result.txt') {
  const buffer = Buffer.from(replyMsg, 'utf-8');
  const file = new AttachmentBuilder(buffer, { name: filename });
  await interaction.editReply({ content: 'ファイルで出力します。', files: [file] });
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName } = interaction;
  try {
    await interaction.deferReply();

    // 代理登録（管理者のみ）
    if (commandName === '代理登録') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者のみ実行できます。');
        return;
      }
      const url = interaction.options.getString('動画url');
      const owner = interaction.options.getString('ユーザー名');
      if (!url) {
        await interaction.editReply('動画URLが入力されていません。');
        return;
      }
      let video = await YoutubeVideo.findOne({ url });
      if (!video) {
        video = new YoutubeVideo({ url, owner });
      } else {
        video.owner = owner;
      }
      await video.save();
      await interaction.editReply(`動画URL: ${url} の所有者を ${owner} に登録しました。`);
      return;
    }

    // 累計売上ランキング（ファイル出力）
    if (commandName === '累計売上') {
      const videos = await YoutubeVideo.find({});
      const userTotalSales = {};
      videos.forEach(v => {
        if (v.owner) {
          if (!userTotalSales[v.owner]) userTotalSales[v.owner] = 0;
          userTotalSales[v.owner] += typeof v.totalCount === 'number' ? v.totalCount : 0;
        }
      });
      let replyMsg = '所有者ごとの累計動画販売数（累計販売数×８００万）:\n';
      Object.entries(userTotalSales).forEach(([u, c]) => {
        replyMsg += `${u}: ${c}本\n`;
      });
      await replyWithPossibleFile(interaction, replyMsg || '登録ユーザーがいません', 'total_sales.txt');
      return;
    }

    // 累計売上変更（管理者のみ、ユーザー名指定で全動画の合計を揃える）
    if (commandName === '累計売上変更') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者のみ実行できます。');
        return;
      }
      const owner = interaction.options.getString('ユーザー名');
      const newCount = interaction.options.getInteger('売上数');
      if (typeof newCount !== 'number' || newCount < 0) {
        await interaction.editReply('売上数は0以上の整数で指定してください。');
        return;
      }
      const videos = await YoutubeVideo.find({ owner });
      if (!videos.length) {
        await interaction.editReply('指定した所有者名の動画が見つかりません。');
        return;
      }
      // すべての動画の合計を newCount に揃える（分配方法はここでは最初の動画に全部入れる例）
      // 必要に応じて分配方式を変更してください
      let remaining = newCount;
      for (let i = 0; i < videos.length; i++) {
        if (i === 0) {
          videos[i].totalCount = remaining;
        } else {
          videos[i].totalCount = 0;
        }
        await videos[i].save();
      }
      await interaction.editReply(`所有者: ${owner} の累計売上を合計 ${newCount}本に変更しました（最初の動画にのみ反映）。`);
      return;
    }

    // 動画シャッフル（管理者のみ）
    if (commandName === '動画シャッフル') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者だけが実行できます。');
        return;
      }
      const urls = Object.values(numberToYoutubeUrl);
      const shuffled = urls.sort(() => Math.random() - 0.5);
      Object.keys(numberToYoutubeUrl).forEach((num, idx) => {
        numberToYoutubeUrl[num] = shuffled[idx];
      });
      await interaction.editReply('番号と動画URLの割り当てをランダムにシャッフルしました。');
      return;
    }

    // 累計売上リセット（特定ユーザーのみ）
    if (commandName === '累計売上リセット') {
      if (!TOTAL_SALES_RESET_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは指定ユーザーのみ実行できます。');
        return;
      }
      const videos = await YoutubeVideo.find({});
      for (const v of videos) {
        v.totalCount = 0;
        await v.save();
      }
      await interaction.editReply('全動画の累計売上をリセットしました。');
      return;
    }

    // 動画一覧表示（管理者のみ・ファイル出力）
    if (commandName === '動画一覧') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者のみ実行できます。');
        return;
      }
      const videos = await YoutubeVideo.find({});
      if (videos.length === 0) {
        await interaction.editReply('登録されている動画はありません。');
        return;
      }
      let replyMsg = '登録されている動画URL一覧:\n';
      videos.forEach((v, idx) => {
        replyMsg += `${idx + 1}. ${v.url}${v.owner ? `（所有者: ${v.owner}）` : ''}\n`;
      });
      await replyWithPossibleFile(interaction, replyMsg, 'videos.txt');
      return;
    }

    // 割り当て一覧（管理者のみ・ファイル出力）
    if (commandName === '割り当て一覧') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者のみ実行できます。');
        return;
      }
      let replyMsg = '現在の動画割り当て一覧:\n';
      for (let num = 1; num <= 60; num++) {
        const url = numberToYoutubeUrl[num];
        if (!url) continue;
        const video = await YoutubeVideo.findOne({ url });
        replyMsg += `${num}: ${url}`;
        if (video && video.owner) {
          replyMsg += `（所有者: ${video.owner}）`;
        }
        replyMsg += '\n';
      }
      await replyWithPossibleFile(interaction, replyMsg, 'assignments.txt');
      return;
    }
  } catch (err) {
    console.error(err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('エラーが発生しました');
      } else {
        await interaction.reply('エラーが発生しました');
      }
    } catch (_) {}
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
