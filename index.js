import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
const app = express();
const PORT = 8000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => {
  console.log(`Dummy web server running on port ${PORT}`);
});

import { Client, GatewayIntentBits, Collection, PermissionFlagsBits } from 'discord.js';
import mongoose from 'mongoose';

import YoutubeVideo from './models/YoutubeVideo.js';
import numberToYoutubeUrl from './config/numberToYoutubeUrl.js';

const MONGODB_URI = process.env.MONGODB_URI;
const TOKEN = process.env.TOKEN;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
] });

client.once('clientReady', () => {
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
    name: '割り当て一覧',
    description: '現在の番号の動画割り当てと所有者一覧（管理者のみ）',
    default_member_permissions: PermissionFlagsBits.Administrator.toString()
  }
  // 他のコマンドは必要ならここに追加
];

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  const { commandName } = interaction;

  // 割り当て一覧（管理者のみ）
  if (commandName === '割り当て一覧') {
    await interaction.deferReply();

    // 念のため管理者チェック
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.editReply('このコマンドは管理者のみ実行できます。');
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
    await interaction.editReply(replyMsg);
  }
});

client.on('clientReady', async () => {
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
