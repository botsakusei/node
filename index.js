import dotenv from 'dotenv';
dotenv.config();
import { handleMessageAttachments } from './ocrFish.js';
import express from 'express';
const app = express();
const PORT = process.env.PORT || 8000;
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(PORT, () => {
  console.log(`Dummy web server running on port ${PORT}`);
});

import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  AttachmentBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} from 'discord.js';
import mongoose from 'mongoose';
import fetch from 'node-fetch';

import YoutubeVideo from './models/YoutubeVideo.js';
import numberToYoutubeUrl from './config/numberToYoutubeUrl.js';
import UserCoin from './models/UserCoin.js';
import GachaUserHistory from './models/GachaUserHistory.js';

// ユーティリティ: 正規表現用に文字列を安全にエスケープする
function escapeRegex(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 応答ユーティリティ：どの状態でも安全に返信する
async function safeReply(interaction, options) {
  // options can be object or string
  const payload = (typeof options === 'string') ? { content: options } : options;
  try {
    if (interaction.replied || interaction.deferred) {
      // editReply if deferred/replied
      return await interaction.editReply(payload);
    } else {
      return await interaction.reply(payload);
    }
  } catch (err) {
    // Unknown interaction may occur; try followUp as fallback if possible
    console.warn('safeReply fallback', err?.message);
    try {
      return await interaction.followUp(payload);
    } catch (e) {
      console.error('safeReply failed to followUp', e);
    }
  }
}

// 安全に defer する（既に defer/replied なら無視）
async function safeDefer(interaction, options = { ephemeral: true }) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(options);
    }
  } catch (err) {
    console.warn('safeDefer warning:', err?.message);
  }
}

// Normalize owner strings for robust comparison
function normalizeOwner(name) {
  if (typeof name !== 'string') return null;
  return name.trim().toLowerCase();
}

const ownerMap = {
  1: "うつろみゆむ", 2: "くるみん", 3: "帆立丸", 4: "鮫田さあめ", 5: "七瀬のん", 6: "あいる", 7: "おいも",
  8: "藤堂ロミ", 9: "氷花れき", 10: "藤崎二郎", 11: "蘇田チェリ男", 12: "くまりん", 13: "砂井破亜",
  14: "くろみつ", 15: "猫谷なゆ", 16: "あーす", 17: "佐々木さざんか", 18: "rapis", 19: "氷花しえる",
  20: "うつろみゆむ", 21: "くるみん", 22: "帆立丸", 23: "鮫田さあめ", 24: "七瀬のん", 25: "あいる", 26: "おいも",
  27: "藤堂ロミ", 28: "氷花れき", 29: "藤崎二郎", 30: "蘇田チェリ男", 31: "くまりん", 32: "砂井破亜",
  33: "くろみつ", 34: "猫谷なゆ", 35: "あーす", 36: "佐々木さざんか", 37: "rapis", 38: "氷花しえる",
  39: "うつろみゆむ", 40: "くるみん", 41: "帆立丸", 42: "鮫田さあめ", 43: "七瀬のん", 44: "あいる",
  45: "おいも", 46: "藤堂ロミ", 47: "氷花れき", 48: "藤崎二郎", 49: "蘇田チェリ男", 50: "くまりん",
  51: "砂井破亜", 52: "くろみつ", 53: "猫谷なゆ", 54: "あーす", 55: "佐々木さざんか", 56: "rapis",
  57: "氷花しえる", 58: "うつろみゆむ", 59: "くるみん", 60: "帆立丸", 61: "鮫田さあめ", 62: "七瀬のん",
  63: "あいる", 64: "おいも", 65: "藤堂ロミ", 66: "氷花れき", 67: "藤崎二郎", 68: "蘇田チェリ男",
  69: "くまりん", 70: "れい", 71: "なゆた", 72: "なゆた", 73: "なゆた", 74: "かめはめこ",
  75: "かめはめこ", 76: "かめはめこ", 77: "深橙はく", 78: "深橙はく", 79: "深橙はく",
  80: "深橙はく", 81: "深橙はく", 82: "一風れぐ", 83: "一風れぐ", 84: "一風れぐ",85: "匿名A（実装予定）",
};
const userMap = {
  '636419692353028103': 'うつろみゆむ', '1204420101529673752': 'くるみん', '985863366100803594': '帆立丸',
  '1051175275880259716': '鮫田さあめ', '943525542030901249': '七瀬のん', '774197905921015839': 'あいる',
  '1418491317855588352': 'おいも', '634002738014978071': '藤堂ロミ', '1175820346465722519': '氷花れき',
  '883685991766958080': '藤崎二郎', '425554535449231360': '蘇田チェリ男', '260067535397978122': 'くまりん',
  '736946638479949949': '砂井破亜', '111222333444555666': 'くろみつ', '569215653882363916': '猫谷なゆ',
  '935889095404687400': 'あーす', '354060625334239235': '佐々木さざんか', '712983286082699265': 'rapis',
  '712278533279318146': '氷花しえる', '1365266032272605324': 'れい（外れ確定）', '827942178797780992': 'なゆた',
  '743291606362226718': 'かめはめこ', '1318461683533877319': '深橙はく', '859800561310367774': '一風れぐ', '557208453660147713': '匿名A'
};

const GACHA_GIF_URL = "https://3.bp.blogspot.com/-nCwQHBNVgkQ/W2QwH3KMGnI/AAAAAAABK4c/2P6EwT4c9wAlVjWbZKkA2A2iV1nR1lIvgCLcBGAs/s400/gacha_capsule_machine.gif";
const userOwnerSelection = {};
let isTestMode = false;

const MONGODB_URI = process.env.MONGODB_URI;
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const ROLE_IDS = process.env.ROLE_IDS ? process.env.ROLE_IDS.split(',') : [];

async function getBufferFromUrl(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.content === '!gachabutton' && ADMIN_IDS.includes(message.author.id)) {
    const fetched = await message.channel.messages.fetch({ limit: 10 });
    const botMsgs = fetched.filter(m => m.author.bot && m.content.includes('ガチャを引くボタン'));
    for (const m of botMsgs.values()) { await m.delete(); }
    const ownerOptions = Object.values(userMap).map(owner => ({ label: owner, value: owner }));
    const selectMenu = new StringSelectMenuBuilder().setCustomId('owner_select').setPlaceholder('11連確定枠の所有者を選択').addOptions(ownerOptions);
    const rowMenu = new ActionRowBuilder().addComponents(selectMenu);
    const rowButton = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('gacha_1').setLabel('1回引く').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('gacha_11').setLabel('11回引く').setStyle(ButtonStyle.Success)
    );
    const imageBuffer = await getBufferFromUrl(GACHA_GIF_URL);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'gacha.gif' });
    await message.channel.send({
      content: 'ガチャを引くボタン＆確定枠所有者選択はこちら！',
      files: [attachment],
      components: [rowMenu, rowButton]
    });
    return;
  }
  // 画像添付があるメッセージは魚解析モジュールに渡す（TARGET_CHANNEL_ID が設定されている場合はそこだけ）
try {
  const attachments = Array.from(message.attachments.values()).filter(a => a.contentType && a.contentType.startsWith('image'));
  if (attachments.length > 0) {
    if (!TARGET_CHANNEL_ID || message.channel.id === TARGET_CHANNEL_ID) {
      await handleMessageAttachments(message);
      // 他の処理と競合させたくなければここで return しても良いです
      // return;
    }
  }
} catch (e) {
  console.error('image handler error:', e);
}
});

// スラッシュコマンド（定義）
const globalCommands = [
  new SlashCommandBuilder().setName('コイン一覧').setDescription('全ユーザーのコイン残高一覧').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('コイン削除').setDescription('指定ユーザーのコインを削除')
    .addIntegerOption(option => option.setName('枚数').setDescription('削除枚数').setRequired(true))
    .addStringOption(option => option.setName('ユーザーid').setDescription('対象ユーザーID').setRequired(false))
    .addStringOption(option => option.setName('所有者名').setDescription('対象所有者名').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('コイン発行').setDescription('指定ユーザーにコインを発行').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(option => option.setName('ユーザー').setDescription('対象ユーザー').setRequired(true))
    .addIntegerOption(option => option.setName('枚数').setDescription('発行枚数').setRequired(true)),
  new SlashCommandBuilder().setName('割り当て一覧').setDescription('現在の番号の動画割り当てと所有者一覧をファイルで出力').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder().setName('ガチャ履歴').setDescription('自分または指定ユーザーのガチャ履歴をファイル出力')
    .addUserOption(option => option.setName('対象ユーザー').setDescription('管理者専用: 履歴を見たいユーザー').setRequired(false)),
  new SlashCommandBuilder().setName('累計売上').setDescription('所有者ごとの累計売上集計・出力'),
  new SlashCommandBuilder().setName('テストモード').setDescription('売上DB操作を無効化').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('テストモード解除').setDescription('通常モード復帰').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('代理登録').setDescription('動画URLと所有者登録')
    .addStringOption(option => option.setName('動画url').setDescription('動画URL').setRequired(true))
    .addStringOption(option => option.setName('ユーザー名').setDescription('所有者名').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('累計売上変更').setDescription('売上数を強制変更')
    .addStringOption(option => option.setName('ユーザー名').setDescription('所有者名').setRequired(true))
    .addIntegerOption(option => option.setName('売上数').setDescription('新しい累計売上数').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: globalCommands.map(cmd => cmd.toJSON()) });
    console.log('Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();

function replyWithPossibleFile(interaction, replyMsg, filename = 'result.txt', ephemeral = false) {
  const buffer = Buffer.from(replyMsg, 'utf-8');
  const file = new AttachmentBuilder(buffer, { name: filename });
  return safeReply(interaction, { content: 'ファイルで出力します。', files: [file], ephemeral });
}

client.on('interactionCreate', async (interaction) => {
  try {
    // 確定枠選択（選択メニュー）
    if (interaction.isStringSelectMenu() && interaction.customId === 'owner_select') {
      userOwnerSelection[interaction.user.id] = interaction.values[0];
      await safeReply(interaction, { content: `確定枠: ${interaction.values[0]}を選択しました`, ephemeral: true });
      return;
    }

    // ガチャボタン
    if (interaction.isButton()) {
      // defer early to avoid Unknown interaction on long ops
      await safeDefer(interaction, { ephemeral: true });

      const userId = interaction.user.id;
      let userCoin = await UserCoin.findOne({ userId });
      const times = interaction.customId === 'gacha_1' ? 1 : interaction.customId === 'gacha_11' ? 11 : 0;

      if (!userCoin || userCoin.coin < times) {
        await safeReply(interaction, { content: `コインが足りません（必要: ${times}枚, 所持: ${userCoin ? userCoin.coin : 0}枚）`, ephemeral: true });
        return;
      }

      // Normalized pullingOwner for robust matching
      const pullingOwnerRaw = userMap[userId];
      const pullingOwner = normalizeOwner(pullingOwnerRaw);

      // 1連ガチャ
      if (times === 1) {
        let videos = await YoutubeVideo.find({});
        if (pullingOwner) {
          videos = videos.filter(v => normalizeOwner(v.owner) !== pullingOwner);
        }
        if (videos.length === 0) {
          await safeReply(interaction, { content: '動画データがありません（あなたの所有者の動画は除外されています）。', ephemeral: true });
          return;
        }
        const picked = videos[Math.floor(Math.random() * videos.length)];

        // --- 売上カウント追加（テストモード時は DB 反映をスキップ） ---
        if (!isTestMode) {
          picked.count = (typeof picked.count === 'number' ? picked.count : 0) + 1;
          picked.totalCount = (typeof picked.totalCount === 'number' ? picked.totalCount : 0) + 1;
          await picked.save();
        }
        // --- 売上カウント追加 ---

        let userHistory = await GachaUserHistory.findOne({ userId });
        if (!userHistory) userHistory = new GachaUserHistory({ userId, videoUrls: [], confirmedUrls: [] });
        if (!isTestMode) {
          userHistory.videoUrls.push(picked.url);
        }

        let dmSuccess = false;
        try {
          const dmMsg = `🎉ガチャ結果\n${picked.url}（所有者: ${picked.owner ?? '不明'}）${isTestMode ? '\n\n※現在テストモードONのため、売上/履歴はDBに反映されません。' : ''}`;
          await interaction.user.send(dmMsg);
          dmSuccess = true;
        } catch (e) {
          dmSuccess = false;
        }

        if (dmSuccess) {
          userCoin.coin -= 1;
          await userCoin.save();
          if (!isTestMode) {
            await userHistory.save();
          }
          await safeReply(interaction, { content: `ガチャ結果をDMで送りました！（残りコイン:${userCoin.coin}枚）${isTestMode ? '（テストモードのため売上/履歴は反映されていません）' : ''}`, ephemeral: true });
        } else {
          await safeReply(interaction, { content: 'DM送信に失敗しました。DMを許可してください。コインは減りません。', ephemeral: true });
        }
        return;
      }

      // 11連ガチャ
      if (times === 11) {
        const owner = userOwnerSelection[userId];
        if (!owner) {
          await safeReply(interaction, { content: '確定枠所有者を選択してください。', ephemeral: true });
          return;
        }

        if (pullingOwner && normalizeOwner(owner) === pullingOwner) {
          await safeReply(interaction, { content: '自身が所属する所有者を確定枠に選択することはできません。別の所有者を選んでください。', ephemeral: true });
          return;
        }

        const ownerRegex = new RegExp(`^${escapeRegex(owner.trim())}$`, 'i');
        const ownerVideos = await YoutubeVideo.find({ owner: { $regex: ownerRegex } });

        if (ownerVideos.length === 0) {
          await safeReply(interaction, { content: `指定所有者「${owner}」の動画がありません。`, ephemeral: true });
          return;
        }

        // userHistory with confirmedUrls
        let userHistory = await GachaUserHistory.findOne({ userId });
        if (!userHistory) {
          userHistory = new GachaUserHistory({ userId, videoUrls: [], confirmedUrls: [] });
        } else if (!Array.isArray(userHistory.confirmedUrls)) {
          userHistory.confirmedUrls = [];
        }

        const prevConfirmedUrls = userHistory.confirmedUrls || [];
        const candidateOwnerVideos = ownerVideos.filter(v => !prevConfirmedUrls.includes(v.url));
        if (candidateOwnerVideos.length === 0) {
          await safeReply(interaction, { content: `「${owner}」の動画は既に確定枠として全て排出済みです。`, ephemeral: true });
          return;
        }

        const confirmed = candidateOwnerVideos[Math.floor(Math.random() * candidateOwnerVideos.length)];
        let results = [confirmed];

        const allVideos = await YoutubeVideo.find({});
        const randomPool = allVideos.filter(v => v.url !== confirmed.url && normalizeOwner(v.owner) !== pullingOwner);
        let usedUrls = new Set([confirmed.url]);
        for (let i = 0; i < 10; i++) {
          let pool = randomPool.filter(v => !usedUrls.has(v.url));
          if (pool.length === 0) break;
          const rand = pool[Math.floor(Math.random() * pool.length)];
          results.push(rand);
          usedUrls.add(rand.url);
        }

        // --- 売上カウント追加（テストモード時は反映しない）---
        if (!isTestMode) {
          for (const v of results) {
            v.count = (typeof v.count === 'number' ? v.count : 0) + 1;
            v.totalCount = (typeof v.totalCount === 'number' ? v.totalCount : 0) + 1;
            await v.save();
          }
        }
        // --- 売上カウント追加 ---

        if (!isTestMode) {
          if (!userHistory.confirmedUrls.includes(confirmed.url)) {
            userHistory.confirmedUrls.push(confirmed.url);
          }
          results.forEach(v => userHistory.videoUrls.push(v.url));
        }

        let msg = `🎉11連ガチャ結果\n【確定枠】\n${confirmed.url}（所有者: ${confirmed.owner}）\n【ランダム枠】\n`;
        msg += results.slice(1).map(v => `${v.url}（所有者: ${v.owner ?? '不明'}）`).join('\n');
        if (isTestMode) msg += '\n\n※現在テストモードONのため、売上/履歴はDBに反映されていません。';

        let dmSuccess = false;
        try {
          await interaction.user.send(msg);
          dmSuccess = true;
        } catch (e) {
          dmSuccess = false;
        }

        if (dmSuccess) {
          userCoin.coin -= 11;
          await userCoin.save();
          if (!isTestMode) {
            await userHistory.save();
          }
          await safeReply(interaction, { content: `11連ガチャ結果をDMで送りました！（残りコイン:${userCoin.coin}枚）${isTestMode ? '（テストモードのため売上/履歴は反映されていません）' : ''}`, ephemeral: true });
        } else {
          await safeReply(interaction, { content: 'DM送信に失敗しました。DMを許可してください。コインは減りません。', ephemeral: true });
        }
        return;
      }
    }

    // 以下、スラッシュコマンド群（主要なコマンド例：コイン発行/一覧/削除/割り当て/履歴/累計売上/テストモード/代理登録/累計売上変更）
    // すべて safeDefer / safeReply を使って応答を統一しています。

// 置き換え：/コイン発行 ハンドラ（公開表示にする）
if (interaction.isCommand() && interaction.commandName === 'コイン発行') {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    await safeReply(interaction, { content: '指定ロール権限者のみ実行できます。', ephemeral: true });
    return;
  }

  // defer を「公開」にする（ephemeral: false）
  await safeDefer(interaction, { ephemeral: false });

  const targetUser = interaction.options.getUser('ユーザー');
  if (!targetUser) {
    await safeReply(interaction, { content: '対象ユーザーが見つかりません。', ephemeral: true });
    return;
  }
  const uid = targetUser.id;
  const amount = interaction.options.getInteger('枚数');
  let userCoin = await UserCoin.findOne({ userId: uid });
  if (!userCoin) userCoin = new UserCoin({ userId: uid, coin: 0 });
  userCoin.coin += amount;
  await userCoin.save();

  // 公開で通知（ephemeral を指定しないか false にする）
  await safeReply(interaction, { content: `<@${uid}> に${amount}枚発行しました。現在: ${userCoin.coin}枚` });
  return;
}
    // コイン一覧
    if (interaction.isCommand() && interaction.commandName === 'コイン一覧') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await safeReply(interaction, { content: '指定ロール権限者のみ実行できます。', ephemeral: true });
        return;
      }
      await safeDefer(interaction);
      const allCoins = await UserCoin.find({});
      if (allCoins.length === 0) {
        await safeReply(interaction, { content: 'コインデータがありません。', ephemeral: true });
        return;
      }
      let msg = '【全ユーザーコイン残高一覧】\n';
      allCoins.forEach(u => {
        msg += `ID: ${u.userId}, 枚数: ${u.coin}\n`;
      });
      await replyWithPossibleFile(interaction, msg, 'coin_list.txt');
      return;
    }

    // コイン削除
    if (interaction.isCommand() && interaction.commandName === 'コイン削除') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await safeReply(interaction, { content: '指定ロール権限者のみ実行できます。', ephemeral: true });
        return;
      }
      await safeDefer(interaction);
      const userId = interaction.options.getString('ユーザーid');
      const ownerName = interaction.options.getString('所有者名');
      const amount = interaction.options.getInteger('枚数');
      let targetUserId = userId;
      if (!targetUserId && ownerName) {
        targetUserId = Object.keys(userMap).find(k => userMap[k] === ownerName);
      }
      if (!targetUserId) {
        await safeReply(interaction, { content: 'ユーザーIDまたは所有者名のいずれかを正しく指定してください。', ephemeral: true });
        return;
      }
      let uCoin = await UserCoin.findOne({ userId: targetUserId });
      if (!uCoin) {
        await safeReply(interaction, { content: '指定ユーザーのコインデータが見つかりません。', ephemeral: true });
        return;
      }
      uCoin.coin = Math.max(0, uCoin.coin - amount);
      await uCoin.save();
      await safeReply(interaction, { content: `ユーザーID:${targetUserId} のコインを${amount}枚削除しました。現在:${uCoin.coin}枚` });
      return;
    }

    // 割り当て一覧
    if (interaction.isCommand() && interaction.commandName === '割り当て一覧') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        await safeReply(interaction, { content: '指定ロール権限者のみ実行できます。', ephemeral: true });
        return;
      }
      await safeDefer(interaction);
      let replyMsg = '現在の動画割り当て一覧:\n';
      const maxNum = Math.max(...Object.keys(numberToYoutubeUrl).map(n => Number(n)), 76);
      for (let num = 1; num <= maxNum; num++) {
        const url = numberToYoutubeUrl[num];
        const owner = ownerMap[num];
        if (!url) continue;
        replyMsg += `${num}: ${url}`;
        if (owner) {
          replyMsg += `（所有者: ${owner}）`;
        }
        replyMsg += '\n';
      }
      await replyWithPossibleFile(interaction, replyMsg, 'assignments.txt');
      return;
    }

    // ガチャ履歴
    if (interaction.isCommand() && interaction.commandName === 'ガチャ履歴') {
      await safeDefer(interaction, { ephemeral: true });
      const uid = interaction.user.id;
      const isAdmin = ADMIN_IDS.includes(uid);
      const targetUser = interaction.options.getUser('対象ユーザー');
      if (isAdmin && targetUser) {
        const history = await GachaUserHistory.findOne({ userId: targetUser.id });
        let displayName = targetUser.username;
        let result;
        if (!history || !history.videoUrls.length) {
          result = `${displayName}のガチャ履歴はまだありません。`;
          await safeReply(interaction, { content: result, ephemeral: true });
        } else {
          result = `${displayName}のガチャ履歴:\n` + history.videoUrls.map(url => `- ${url}`).join('\n');
          const buffer = Buffer.from(result, 'utf-8');
          const file = new AttachmentBuilder(buffer, { name: 'gacha_history.txt' });
          await safeReply(interaction, { content: `${displayName}のガチャ履歴ファイルです。`, files: [file], ephemeral: true });
        }
        return;
      }
      const selfHistory = await GachaUserHistory.findOne({ userId: uid });
      let selfDisplayName = interaction.member?.nickname ?? interaction.user.username ?? `ID:${uid}`;
      if (!selfHistory || !selfHistory.videoUrls.length) {
        await safeReply(interaction, { content: `${selfDisplayName}のガチャ履歴はまだありません。`, ephemeral: true });
      } else {
        const result = `${selfDisplayName}のガチャ履歴:\n` + selfHistory.videoUrls.map(url => `- ${url}`).join('\n');
        const buffer = Buffer.from(result, 'utf-8');
        const file = new AttachmentBuilder(buffer, { name: 'my_gacha_history.txt' });
        await safeReply(interaction, { content: 'あなたのガチャ履歴ファイルです。', files: [file], ephemeral: true });
      }
      return;
    }

// 累計売上（公開表示に変更）
if (interaction.isCommand() && interaction.commandName === '累計売上') {
  // defer を公開にする（ephemeral: false）
  await safeDefer(interaction, { ephemeral: false });

  const uid = interaction.user.id;
  const isAdmin = ADMIN_IDS.includes(uid);

  if (isAdmin) {
    const videos = await YoutubeVideo.find({});
    const userTotalSales = {};
    videos.forEach(v => {
      if (v.owner) {
        if (!userTotalSales[v.owner]) userTotalSales[v.owner] = 0;
        userTotalSales[v.owner] += typeof v.totalCount === 'number' ? v.totalCount : 0;
      }
    });
    let replyMsg = '所有者ごとの累計動画販売数（累計販売数×８００万）:\n';
    let totalBooks = 0;
    let totalReward = 0;
    Object.entries(userTotalSales).forEach(([u, c]) => {
      const reward = c * 8000000;
      replyMsg += `${u}: ${c}本（報酬: ¥${reward.toLocaleString()})\n`;
      totalBooks += c;
      totalReward += reward;
    });
    replyMsg += '--------------------\n';
    replyMsg += `合計本数: ${totalBooks}本\n合計報酬金額: ¥${totalReward.toLocaleString()}\n`;
    // 公開でファイル出力（ephemeral = false）
    await replyWithPossibleFile(interaction, replyMsg, 'total_sales.txt', false);
    return;
  } else {
    const ownerName = userMap[uid];
    if (!ownerName) {
      await safeReply(interaction, { content: 'あなたの所有者名が登録されていません。管理者にご連絡ください。', ephemeral: false });
      return;
    }
    const videos = await YoutubeVideo.find({ owner: ownerName });
    const count = videos.reduce((sum, v) => sum + (v.totalCount || 0), 0);
    const reward = count * 8000000;
    // 公開で返信（ephemeral = false）
    await safeReply(interaction, {
      content:
        `所有者ごとの累計動画販売数（累計販売数×８００万）:\n` +
        `${ownerName}: ${count}本（報酬: ¥${reward.toLocaleString()})`,
      ephemeral: false
    });
    return;
  }
}

    // テストモード / テストモード解除
    if (interaction.isCommand() && interaction.commandName === 'テストモード') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await safeReply(interaction, { content: '管理者のみ実行できます。', ephemeral: true });
        return;
      }
      isTestMode = true;
      await safeReply(interaction, { content: 'テストモードON（ガチャの売上カウントと履歴保存は行われません）', ephemeral: true });
      return;
    }
    if (interaction.isCommand() && interaction.commandName === 'テストモード解除') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await safeReply(interaction, { content: '管理者のみ実行できます。', ephemeral: true });
        return;
      }
      isTestMode = false;
      await safeReply(interaction, { content: 'テストモードOFF（ガチャの売上カウントと履歴保存が再び有効になります）', ephemeral: true });
      return;
    }

    // 代理登録
    if (interaction.isCommand() && interaction.commandName === '代理登録') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await safeReply(interaction, { content: '管理者のみ実行できます。', ephemeral: true });
        return;
      }
      await safeDefer(interaction);
      const url = interaction.options.getString('動画url');
      const owner = interaction.options.getString('ユーザー名');
      if (!url) {
        await safeReply(interaction, { content: '動画URLが入力されていません。', ephemeral: true });
        return;
      }
      let video = await YoutubeVideo.findOne({ url });
      if (!video) {
        video = new YoutubeVideo({ url, owner, count: 0, totalCount: 0 });
      } else {
        video.owner = owner;
      }
      await video.save();
      await safeReply(interaction, { content: `動画URL: ${url} の所有者を ${owner} に登録しました。` });
      return;
    }

// 累計売上変更（公開表示に変更）
if (interaction.isCommand() && interaction.commandName === '累計売上変更') {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await safeReply(interaction, { content: '管理者のみ実行できます。', ephemeral: true });
    return;
  }

  // defer を公開にする（ephemeral: false） — 長い処理でもタイムアウトを防ぐ
  await safeDefer(interaction, { ephemeral: false });

  const owner = interaction.options.getString('ユーザー名');
  const newCount = interaction.options.getInteger('売上数');
  if (typeof newCount !== 'number' || newCount < 0) {
    await safeReply(interaction, { content: '売上数は0以上の整数で指定してください。', ephemeral: false });
    return;
  }

  // 正規表現で前後空白と大文字小文字無視（エスケープ）
  const ownerTrim = (typeof owner === 'string') ? owner.trim() : owner;
  const ownerRegex = new RegExp(`^${escapeRegex(ownerTrim)}$`, 'i');
  const videos = await YoutubeVideo.find({
    owner: { $regex: ownerRegex }
  });

  if (videos.length === 0) {
    await safeReply(interaction, { content: `所有者: ${owner} の動画が見つかりません。`, ephemeral: false });
    return;
  }

  const perVideoCount = Math.floor(newCount / videos.length);
  let remainder = newCount % videos.length;
  for (const v of videos) {
    v.totalCount = perVideoCount + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    await v.save();
  }

  // 公開メッセージで通知（全員に見える）
  await safeReply(interaction, { content: `所有者: ${owner} の累計売上（${newCount}本）をDBにも反映しました。`, ephemeral: false });
  return;
}

  } catch (err) {
    console.error(err);
    try {
      if (interaction && (interaction.deferred || interaction.replied)) {
        await interaction.editReply('エラーが発生しました');
      } else if (interaction) {
        await interaction.reply('エラーが発生しました');
      }
    } catch (__) {
      console.error('Failed to notify interaction of error');
    }
  }
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    client.login(TOKEN);
  })
  .catch(err => console.error('MongoDB connection error:', err));
