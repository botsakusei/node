import dotenv from 'dotenv';
dotenv.config();

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
  Collection,
  PermissionFlagsBits,
  AttachmentBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder
} from 'discord.js';
import mongoose from 'mongoose';
import axios from 'axios';

import YoutubeVideo from './models/YoutubeVideo.js';
import numberToYoutubeUrl from './config/numberToYoutubeUrl.js';

const MONGODB_URI = process.env.MONGODB_URI;
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID;
const DROP_NOTIFY_CHANNEL_ID = process.env.DROP_NOTIFY_CHANNEL_ID || TARGET_CHANNEL_ID;

const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const TOTAL_SALES_RESET_IDS = process.env.TOTAL_SALES_RESET_IDS ? process.env.TOTAL_SALES_RESET_IDS.split(',') : [];

const userMap = {
  '636419692353028103': 'うつろみゆむ',
  '1204420101529673752': 'くるみん',
  '985863366100803594': '帆立丸',
  '1051175275880259716': '鮫田さあめ',
  '943525542030901249': '七瀬のん',
  '774197905921015839': 'あいる',
  '1418491317855588352': 'おいも',
  '634002738014978071': '藤堂ロミ',
  '1175820346465722519': '氷花れき',
  '883685991766958080': '藤崎二郎',
  '425554535449231360': '蘇田チェリ男',
  '260067535397978122': 'くまりん',
  '736946638479949949': '砂井破亜',
  '111222333444555666': 'くろみつ',
  '569215653882363916': '猫谷なゆ',
  '935889095404687400': 'あーす',
  '354060625334239235': '佐々木さざんか',
  '712983286082699265': 'rapis',
  '1365266032272605324': 'rei',
  '712278533279318146': '氷花しえる',
};

const COINS = [
  'binance-usd', 'polkadot', 'solana', 'bitcoin', 'binancecoin',
  'litecoin', 'dogecoin', 'ripple', 'usd-coin', 'shiba-inu',
  'ethereum', 'cardano', 'tether', 'bitcoin-cash'
];

const coinNames = {
  'binance-usd': 'BUSD',
  'polkadot': 'DOT',
  'solana': 'SOL',
  'bitcoin': 'BTC',
  'binancecoin': 'BNB',
  'litecoin': 'LTC',
  'dogecoin': 'DOGE',
  'ripple': 'XRP',
  'usd-coin': 'USDC',
  'shiba-inu': 'SHIB',
  'ethereum': 'ETH',
  'cardano': 'ADA',
  'tether': 'USDT',
  'bitcoin-cash': 'BCH'
};

const INTERVAL_MIN = 10;

// 演出用フリー画像・音声URL
const FREEMATERIAL = {
  coin: "https://1.bp.blogspot.com/-R4M6kGf8IIA/V0e6Fq_V7zI/AAAAAAAA6KE/81gC4pJQnKMhNwi0uF8lC9KQw8HfY7H7gCLcB/s400/gacha_coin_nyuryoku.png",
  gachaGif: "https://3.bp.blogspot.com/-nCwQHBNVgkQ/W2QwH3KMGnI/AAAAAAABK4c/2P6EwT4c9wAlVjWbZKkA2A2iV1nR1lIvgCLcBGAs/s400/gacha_capsule_machine.gif",
  capsule: "https://1.bp.blogspot.com/-uH9rTgN9QxY/XN4U4UqKzSI/AAAAAAABUuA/3uXshQ3Gn4U1pUgkKC4X2F2f3xBG1kzVgCLcBGAs/s400/gacha_capsule_open.png",
  rare: "https://4.bp.blogspot.com/-ur0A6KD7rU0/W8nJXvVwLXI/AAAAAAABQ9U/1zQcD8suzmUVl0l9MjS3eQqj6dVgJ9tgwCLcBGAs/s400/takarabako_open.png",
  sound: [
    "https://www.youtube.com/watch?v=0qQeV4bA0SU",
    "https://www.youtube.com/watch?v=1rCj3XJ1qkY"
  ]
};

// 価格取得関数
async function getCurrentPrices(coinIds = COINS, vsCurrency = 'usd') {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=${vsCurrency}`;
  try {
    const res = await axios.get(url);
    return res.data;
  } catch (e) {
    console.error('価格取得失敗:', e.message);
    return {};
  }
}

// 急落チェック関数
async function checkDrop(coinId, percent = 5) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=1`;
    const res = await axios.get(url);
    const prices = res.data.prices.map(([t, p]) => p);
    const maxPrice = Math.max(...prices);
    const nowPrice = prices[prices.length - 1];
    const dropRate = ((maxPrice - nowPrice) / maxPrice) * 100;
    if (dropRate >= percent) {
      return { coinId, dropRate: dropRate.toFixed(2), maxPrice, nowPrice };
    }
  } catch (e) {
    console.error(`[${coinId}] API取得エラー:`, e.message);
  }
  return null;
}

// sleep関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const client = new Client({ intents: [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent
] });

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  setInterval(async () => {
    let notifyMsg = '';
    for (const coinId of COINS) {
      const drop = await checkDrop(coinId, 5);
      if (drop) {
        notifyMsg += `🟠 **${coinNames[coinId] || coinId}** が24hで **${drop.dropRate}%急落**！\n（最高値: $${drop.maxPrice.toFixed(4)}→現在値: $${drop.nowPrice.toFixed(4)}）\n`;
      }
    }
    if (notifyMsg) {
      try {
        const channel = await client.channels.fetch(DROP_NOTIFY_CHANNEL_ID);
        channel.send('【自動監視通知】\n' + notifyMsg);
      } catch (e) {
        console.error('急落通知送信エラー:', e);
      }
    }
  }, INTERVAL_MIN * 60 * 1000);
});

// ガチャコマンド演出
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.channel.id !== TARGET_CHANNEL_ID) return;

  // ガチャ演出コマンド
  if (message.content === "!gacha") {
    // 1. コイン投入フェーズ
    await message.reply({
      content: "🪙 持っているコインを投入！",
      files: [FREEMATERIAL.coin]
    });
    await sleep(1200);

    // 2. ガチャガチャが回る
    await message.reply({
      content: "🎰 ガチャガチャが回転中…",
      files: [FREEMATERIAL.gachaGif]
    });
    await sleep(1600);

    // 3. カプセルが出る
    await message.reply({
      content: "🔵 カプセルが出た！",
      files: [FREEMATERIAL.capsule]
    });
    await sleep(1200);

    // 4. カプセルから画像が出現
    await message.reply({
      content: "✨ カプセルが開いた！中身は…！？",
      files: [FREEMATERIAL.rare]
    });
    await sleep(1200);

    // 5. 音声URL送信
    await message.reply(
      `🔉 ガチャ演出効果音: \n${FREEMATERIAL.sound[0]}\nピカーンSE: ${FREEMATERIAL.sound[1]}`
    );
    return;
  }

  // 既存の番号ガチャシステム
  const num = parseInt(message.content, 10);
  if (!isNaN(num) && num >= 1 && num <= 69) {
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
  new SlashCommandBuilder()
    .setName('代理登録')
    .setDescription('動画URLの所有者を登録（管理者のみ）')
    .addStringOption(option => option.setName('動画url').setDescription('動画URL').setRequired(true))
    .addStringOption(option => option.setName('ユーザー名').setDescription('所有者名').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('累計売上')
    .setDescription('自分自身の累計売上'),
  new SlashCommandBuilder()
    .setName('動画シャッフル')
    .setDescription('番号と動画URLの割り当てをランダムシャッフル（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('累計売上リセット')
    .setDescription('全動画の累計売上をリセット（特定ユーザーのみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('累計売上変更')
    .setDescription('累計売上で出力される数をユーザー名指定で変更（管理者のみ）')
    .addStringOption(option => option.setName('ユーザー名').setDescription('所有者名').setRequired(true))
    .addIntegerOption(option => option.setName('売上数').setDescription('新しい累計売上数').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('動画一覧')
    .setDescription('登録されている動画URLの一覧をファイルで出力（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('割り当て一覧')
    .setDescription('現在の番号の動画割り当てと所有者一覧をファイルで出力（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('pricecheck')
    .setDescription('監視銘柄の現在価格を一覧表示（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Slash commands registered!');
  } catch (error) {
    console.error(error);
  }
})();

let customTotalSales = {};

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

    if (commandName === 'pricecheck') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者のみ実行できます。');
        return;
      }
      const prices = await getCurrentPrices(COINS, 'usd');
      let replyMsg = '【監視銘柄 現在価格一覧（USD）】\n';
      for (const coinId of COINS) {
        const name = coinNames[coinId] || coinId;
        const price = prices[coinId]?.usd;
        replyMsg += `${name}: $${price ? price : '取得失敗'}\n`;
      }
      await interaction.editReply(replyMsg);
      return;
    }

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

    if (commandName === '累計売上') {
      const userId = interaction.user.id;

      if (userId === '1365266032272605324') {
        const videos = await YoutubeVideo.find({});
        const userTotalSales = {};
        videos.forEach(v => {
          if (v.owner) {
            if (!userTotalSales[v.owner]) userTotalSales[v.owner] = 0;
            userTotalSales[v.owner] += typeof v.totalCount === 'number' ? v.totalCount : 0;
          }
        });
        for (const owner in customTotalSales) {
          userTotalSales[owner] = customTotalSales[owner];
        }
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
        const buffer = Buffer.from(replyMsg, 'utf-8');
        const file = new AttachmentBuilder(buffer, { name: 'total_sales.txt' });
        await interaction.editReply({ content: '全売上データをファイルで出力します。', files: [file] });
        return;
      }

      const ownerName = userMap[userId];
      if (!ownerName) {
        await interaction.editReply('あなたの所有者名が登録されていません。管理者にご連絡ください。');
        return;
      }
      let count = customTotalSales[ownerName];
      if (typeof count !== 'number') {
        const videos = await YoutubeVideo.find({ owner: ownerName });
        count = videos.reduce((sum, v) => sum + (v.totalCount || 0), 0);
      }
      const reward = count * 8000000;
      await interaction.editReply(
        `所有者ごとの累計動画販売数（累計販売数×８００万）:\n` +
        `${ownerName}: ${count}本（報酬: ¥${reward.toLocaleString()})`
      );
      return;
    }

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
      customTotalSales[owner] = newCount;
      const videos = await YoutubeVideo.find({ owner });
      if (videos.length === 0) {
        await interaction.editReply(`所有者: ${owner} の動画が見つかりません。`);
        return;
      }
      const perVideoCount = Math.floor(newCount / videos.length);
      let remainder = newCount % videos.length;
      for (const v of videos) {
        v.totalCount = perVideoCount + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder--;
        await v.save();
      }
      await interaction.editReply(`所有者: ${owner} の累計売上（${newCount}本）をDBにも反映しました。`);
      return;
    }

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
      customTotalSales = {};
      await interaction.editReply('全動画の累計売上をリセットしました。');
      return;
    }

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

    if (commandName === '割り当て一覧') {
      if (!ADMIN_IDS.includes(interaction.user.id)) {
        await interaction.editReply('このコマンドは管理者のみ実行できます。');
        return;
      }
      let replyMsg = '現在の動画割り当て一覧:\n';
      for (let num = 1; num <= 69; num++) {
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

mongoose.connect(MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    client.login(TOKEN);
  })
  .catch(err => console.error('MongoDB connection error:', err));
