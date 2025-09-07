import dotenv from "dotenv";
dotenv.config();

import pkg from "discord.js";
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Routes,
  InteractionType
} = pkg;
import { REST } from "@discordjs/rest";
import fs from "fs";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// Supabaseの設定
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 環境変数
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;
const GACHA_ANIMATION_PATH = "free_gacha_animation.gif";
const GACHA_COST = 10;
const CURRENCY_UNIT = "デルタ";
const ISSUE_ROLE_ID = process.env.ISSUE_ROLE_ID;
const ISSUE_LOG_CHANNEL_ID = process.env.ISSUE_LOG_CHANNEL_ID;

// 商品ラインナップ
const ITEM_LIST = [
  "フィッシュフライ",
  "レモンサワー",
  "蟹ノ足",
  "マグロノ握リ",
  "マグロノ中落チ"
];

// Supabase DB関数
async function getBalance(uid) {
  const { data, error } = await supabase
    .from("balances")
    .select("amount")
    .eq("user_id", uid)
    .single();
  if (error || !data) return 0;
  return data.amount;
}

async function addBalance(uid, amt) {
  const current = await getBalance(uid);
  const newBalance = current + amt;
  // upsert
  const { error } = await supabase
    .from("balances")
    .upsert([{ user_id: uid, amount: newBalance }], { onConflict: ["user_id"] });
  if (error) throw error;
  return newBalance;
}

async function subBalance(uid, amt) {
  const current = await getBalance(uid);
  const newBalance = Math.max(0, current - amt);
  const { error } = await supabase
    .from("balances")
    .upsert([{ user_id: uid, amount: newBalance }], { onConflict: ["user_id"] });
  if (error) throw error;
  return newBalance;
}

async function addGachaHistory(uid, result) {
  const { error } = await supabase
    .from("gacha_history")
    .insert([{ user_id: uid, result, timestamp: new Date().toISOString() }]);
  if (error) throw error;
}

async function getGachaHistory(uid, limit = 10) {
  const { data, error } = await supabase
    .from("gacha_history")
    .select("*")
    .eq("user_id", uid)
    .order("timestamp", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data;
}

async function getItemStock(item) {
  const { data, error } = await supabase
    .from("item_stock")
    .select("count")
    .eq("item", item)
    .maybeSingle();
  if (error || !data) return 0;
  return data.count || 0;
}

async function addItemStock(uid, item, count, date = null) {
  const { data, error } = await supabase
    .from("item_stock")
    .select("*")
    .eq("user_id", uid)
    .eq("item", item)
    .single();
  let newCount = count;
  if (data) newCount = data.count + count;
  const { error: upsertError } = await supabase
    .from("item_stock")
    .upsert([{ user_id: uid, item, count: newCount }], { onConflict: ["user_id", "item"] });
  if (upsertError) throw upsertError;
  return newCount;
}

async function outItemStock(uid, item, count, date = null) {
  const { data, error } = await supabase
    .from("item_stock")
    .select("*")
    .eq("user_id", uid)
    .eq("item", item)
    .single();
  let newCount = 0;
  if (data) newCount = Math.max(0, data.count - count);
  const { error: upsertError } = await supabase
    .from("item_stock")
    .upsert([{ user_id: uid, item, count: newCount }], { onConflict: ["user_id", "item"] });
  if (upsertError) throw upsertError;
  return newCount;
}

// csvimportコマンド（CSV添付で一括登録）-- DB処理なしでOK
async function handleCsvImport(interaction) {
  await interaction.reply({ content: "CSVファイルをこのコマンド実行後、**同じチャンネルに**添付してください。\nファイル名は何でもOKです。", flags: 64 });
}

const CSV_IMPORT_STATE = {
  waiting: false,
  channelId: null,
  userId: null,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

// コマンド登録
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("ガチャ").setDescription(`${GACHA_COST}${CURRENCY_UNIT}消費してガチャ`),
    new SlashCommandBuilder().setName("残高").setDescription("自分の残高確認"),
    new SlashCommandBuilder().setName("発行").setDescription(`${CURRENCY_UNIT}を指定ユーザーに発行`)
      .addUserOption(option => option.setName("user").setDescription("発行先ユーザー").setRequired(true))
      .addIntegerOption(option => option.setName("amount").setDescription(`発行する${CURRENCY_UNIT}量`).setRequired(true)),
    new SlashCommandBuilder().setName("履歴").setDescription("自分のガチャ結果履歴を表示"),
    new SlashCommandBuilder().setName("入庫").setDescription("商品を入庫する")
      .addStringOption(option => option.setName("item").setDescription("商品名").setRequired(true).addChoices(...ITEM_LIST.map(item => ({ name: item, value: item }))))
      .addIntegerOption(option => option.setName("count").setDescription("入庫数").setRequired(true)),
    new SlashCommandBuilder().setName("出庫").setDescription("商品を出庫する")
      .addStringOption(option => option.setName("item").setDescription("商品名").setRequired(true).addChoices(...ITEM_LIST.map(item => ({ name: item, value: item }))))
      .addIntegerOption(option => option.setName("count").setDescription("出庫数").setRequired(true)),
    new SlashCommandBuilder().setName("在庫").setDescription("商品在庫を一覧表示"),
    new SlashCommandBuilder().setName("csvimport").setDescription("入出庫CSVファイルを添付して一括登録"),
    new SlashCommandBuilder().setName("alluserlog").setDescription("DBに登録された全ユーザー分の入庫・出庫数を分割して出力")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("Slash commands registered");
}

// コマンド・メッセージイベント
client.on("interactionCreate", async interaction => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;
  const uid = interaction.user.id;

  // csvimportコマンド
  if (interaction.commandName === "csvimport") {
    CSV_IMPORT_STATE.waiting = true;
    CSV_IMPORT_STATE.channelId = interaction.channel.id;
    CSV_IMPORT_STATE.userId = interaction.user.id;
    await handleCsvImport(interaction);
    return;
  }

  // alluserlogコマンド（DB関係削除）
  if (interaction.commandName === "alluserlog") {
    await interaction.reply({ content: "登録データがありません。", flags: 64 });
    return;
  }

  // ガチャ
  if (interaction.commandName === "ガチャ") {
    let bal = await getBalance(uid);
    if (bal < GACHA_COST) {
      await interaction.reply({ content: `残高不足！（${bal}${CURRENCY_UNIT}）`, flags: 64 });
      return;
    }
    await subBalance(uid, GACHA_COST);
    const nb = await getBalance(uid);

    // 名前リスト・ガチャ動画パス
    const NAME_LIST = ["Aさん", "Bさん", "Cさん"];
    const resultName = NAME_LIST[Math.floor(Math.random() * NAME_LIST.length)];
    const videoPath = `gatyadouga/${resultName}.mp4`;

    let message = `ガチャを回します…\n`;
    let files = [];
    if (fs.existsSync(videoPath)) {
      files.push(videoPath);
    } else {
      message += "演出動画なし\n";
    }

    // ガチャ結果
    message += `結果: ${resultName}！残高: ${nb}${CURRENCY_UNIT}`;
    await addGachaHistory(uid, resultName);

    await interaction.reply({
      content: message,
      files,
      flags: 64
    });
  }

  if (interaction.commandName === "残高") {
    let bal = await getBalance(uid);
    await interaction.reply({ content: `${interaction.user} 残高: ${bal}${CURRENCY_UNIT}`, flags: 64 });
  }

  if (interaction.commandName === "履歴") {
    const history = await getGachaHistory(uid, 10);
    if (history.length === 0) {
      await interaction.reply({ content: "履歴はありません。", flags: 64 });
      return;
    }
    const historyText = history.map(h => `結果: ${h.result} (${h.timestamp})`).join("\n");
    await interaction.reply({ content: `あなたのガチャ履歴（最新10件）:\n${historyText}`, flags: 64 });
  }

  if (interaction.commandName === "発行") {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(ISSUE_ROLE_ID)) {
      await interaction.reply({ content: "あなたは発行権限がありません。", flags: 64 });
      return;
    }
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    if (amount <= 0) {
      await interaction.reply({ content: "発行額は1以上にしてください。", flags: 64 });
      return;
    }
    const nb = await addBalance(targetUser.id, amount);
    await interaction.reply({ content: `${targetUser} に ${amount}${CURRENCY_UNIT} を発行しました。新残高: ${nb}${CURRENCY_UNIT}`, flags: 64 });

    try {
      const logChannel = await client.channels.fetch(ISSUE_LOG_CHANNEL_ID);
      await logChannel.send({
        content: `【デルタ発行ログ】
発行者: ${interaction.user.tag} (${interaction.user.id})
対象: ${targetUser.tag} (${targetUser.id})
金額: ${amount}${CURRENCY_UNIT}
新残高: ${nb}${CURRENCY_UNIT}`
      });
    } catch (e) {
      console.error("ログチャンネル送信失敗:", e);
    }
  }

  if (interaction.commandName === "入庫") {
    const item = interaction.options.getString("item");
    const count = interaction.options.getInteger("count");
    if (!ITEM_LIST.includes(item)) {
      await interaction.reply({ content: "無効な商品名です。", flags: 64 });
      return;
    }
    if (count <= 0) {
      await interaction.reply({ content: "入庫数は1以上を指定してください。", flags: 64 });
      return;
    }
    const stock = await addItemStock(uid, item, count);
    await interaction.reply({ content: `${item}を${count}個入庫しました。在庫: ${stock}個`, flags: 64 });
  }

  if (interaction.commandName === "出庫") {
    const item = interaction.options.getString("item");
    const count = interaction.options.getInteger("count");
    if (!ITEM_LIST.includes(item)) {
      await interaction.reply({ content: "無効な商品名です。", flags: 64 });
      return;
    }
    if (count <= 0) {
      await interaction.reply({ content: "出庫数は1以上を指定してください。", flags: 64 });
      return;
    }
    const currStock = await getItemStock(item);
    if (currStock < count) {
      await interaction.reply({ content: `在庫不足です。在庫: ${currStock}個`, flags: 64 });
      return;
    }
    const stock = await outItemStock(uid, item, count);
    await interaction.reply({ content: `${item}を${count}個出庫しました。在庫: ${stock}個`, flags: 64 });
  }

  if (interaction.commandName === "在庫") {
    let msg = "【商品在庫一覧】\n";
    for (const item of ITEM_LIST) {
      const stock = await getItemStock(item);
      msg += `${item}: ${stock}個\n`;
    }
    await interaction.reply({ content: msg, flags: 64 });
  }
});

// メッセージでcsvファイル添付を受信（DB関係削除）
client.on("messageCreate", async message => {
  if (
    !CSV_IMPORT_STATE.waiting ||
    message.channel.id !== CSV_IMPORT_STATE.channelId ||
    message.author.id !== CSV_IMPORT_STATE.userId
  ) return;

  if (!message.attachments || message.attachments.size === 0) return;
  const attachment = message.attachments.first();
  const url = attachment.url;
  if (!url) return;
  if (!/\.(csv|txt)$/i.test(attachment.name)) {
    await message.reply("CSV形式（.csv/.txt）のみ対応しています。");
    return;
  }

  let text;
  try {
    text = await fetch(url).then(r => r.text());
  } catch (e) {
    await message.reply("ファイルの取得に失敗しました。");
    CSV_IMPORT_STATE.waiting = false;
    return;
  }

  // CSVパース・登録は何もしない（DBなし）
  await message.reply(
    `CSVインポート完了: 成功 0件, 失敗 0件。\n（データベース機能は無効化されています）`
  );
  CSV_IMPORT_STATE.waiting = false;
});

client.login(TOKEN);
