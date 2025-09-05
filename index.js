import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits, SlashCommandBuilder, Routes, InteractionType, AttachmentBuilder } from "discord.js";
import { REST } from "@discordjs/rest";
import sqlite3 from "better-sqlite3";
import fs from "fs";
import { createCanvas } from "canvas";

// 環境変数
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DB_FILE = "delta_currency.db";
const GACHA_ANIMATION_PATH = "free_gacha_animation.gif";
const GACHA_COST = 10;
const CURRENCY_UNIT = "デルタ";
const ISSUE_ROLE_ID = process.env.ISSUE_ROLE_ID;
const ISSUE_LOG_CHANNEL_ID = process.env.ISSUE_LOG_CHANNEL_ID;

// 商品ラインナップ
const ITEM_LIST = [
  "フィッシュフライ",
  "レモンサワー",
  "蟹の足",
  "マグロの握り",
  "まぐろの中落ち"
];

// DB初期化
const db = sqlite3(DB_FILE);
db.prepare(`CREATE TABLE IF NOT EXISTS currency (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL)`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS gacha_history (
    user_id TEXT,
    result INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS item_stock (
    item_name TEXT PRIMARY KEY,
    stock INTEGER NOT NULL
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS item_out_log (
    user_id TEXT,
    item_name TEXT,
    count INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();
db.prepare(`
  CREATE TABLE IF NOT EXISTS item_in_log (
    user_id TEXT,
    item_name TEXT,
    count INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

// 在庫初期化
ITEM_LIST.forEach(item => {
  const row = db.prepare("SELECT stock FROM item_stock WHERE item_name = ?").get(item);
  if (!row) {
    db.prepare("INSERT INTO item_stock (item_name, stock) VALUES (?, ?)").run(item, 0);
  }
});

function getBalance(uid) {
  const row = db.prepare("SELECT balance FROM currency WHERE user_id = ?").get(uid);
  return row ? row.balance : 0;
}
function addBalance(uid, amt) {
  const n = getBalance(uid) + amt;
  db.prepare("INSERT OR REPLACE INTO currency (user_id, balance) VALUES (?, ?)").run(uid, n);
  return n;
}
function subBalance(uid, amt) {
  const n = Math.max(0, getBalance(uid) - amt);
  db.prepare("UPDATE currency SET balance = ? WHERE user_id = ?").run(n, uid);
  return n;
}
function addGachaHistory(uid, result) {
  db.prepare("INSERT INTO gacha_history (user_id, result) VALUES (?, ?)").run(uid, result);
}
function getGachaHistory(uid, limit = 10) {
  return db.prepare("SELECT result, timestamp FROM gacha_history WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?").all(uid, limit);
}
function getItemStock(item) {
  const row = db.prepare("SELECT stock FROM item_stock WHERE item_name = ?").get(item);
  return row ? row.stock : 0;
}
function addItemStock(uid, item, count, date = null) {
  const curr = getItemStock(item);
  db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(curr + count, item);
  db.prepare("INSERT INTO item_in_log (user_id, item_name, count, timestamp) VALUES (?, ?, ?, ?)").run(uid, item, count, date || new Date().toISOString());
  return curr + count;
}
function outItemStock(uid, item, count, date = null) {
  const curr = getItemStock(item);
  const newStock = Math.max(0, curr - count);
  db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(newStock, item);
  db.prepare("INSERT INTO item_out_log (user_id, item_name, count, timestamp) VALUES (?, ?, ?, ?)").run(uid, item, count, date || new Date().toISOString());
  return newStock;
}

// bulkregister コマンド実装（コピペデータ一括登録＋ファイル/画像添付）
async function handleBulkRegister(interaction) {
  const text = interaction.options.getString("text");
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  let success = 0, failed = 0, errors = [];

  // 柔軟に区切り文字対応
  const splitLine = (line) => {
    let parts = line.split("\t");
    if (parts.length < 5) {
      parts = line.split(/[\s　,]+/); // 半角/全角スペース/カンマ
    }
    return parts;
  };

  for (const line of lines) {
    const parts = splitLine(line);
    if (parts.length < 5) {
      failed++;
      errors.push(`パース失敗: ${line}`);
      continue;
    }
    const [date, user, item, type, valueRaw] = parts;
    let value = parseInt(valueRaw.replace(/[^0-9\-]/g, ""), 10);
    if (isNaN(value)) {
      failed++;
      errors.push(`数値変換失敗: ${line}`);
      continue;
    }
    // DBに商品追加（初見の場合）
    let validItem = ITEM_LIST.includes(item) ? item : null;
    if (!validItem) {
      validItem = item;
      const row = db.prepare("SELECT stock FROM item_stock WHERE item_name = ?").get(validItem);
      if (!row) db.prepare("INSERT INTO item_stock (item_name, stock) VALUES (?, ?)").run(validItem, 0);
      if (!ITEM_LIST.includes(validItem)) ITEM_LIST.push(validItem);
    }
    if (type === "在庫" || type === "入庫") {
      db.prepare("INSERT INTO item_in_log (user_id, item_name, count, timestamp) VALUES (?, ?, ?, ?)").run(user, validItem, value, date);
      if (type === "在庫") {
        db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(value, validItem);
      } else {
        const before = getItemStock(validItem);
        db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(before + value, validItem);
      }
      success++;
    } else if (type === "出庫") {
      db.prepare("INSERT INTO item_out_log (user_id, item_name, count, timestamp) VALUES (?, ?, ?, ?)").run(user, validItem, value, date);
      const before = getItemStock(validItem);
      db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(before + value, validItem); // valueはマイナス
      success++;
    } else {
      failed++;
      errors.push(`種別不明: ${line}`);
    }
  }

  // エラー内容を生成
  const resultText =
    `登録完了: 成功 ${success}件, 失敗 ${failed}件。\n` +
    (errors.length ? `エラー:\n${errors.join("\n")}` : "");

  let replyText = "";
  let files = [];

  // Discordの1メッセージ最大4000文字制限対応
  if (resultText.length <= 3900) {
    replyText = resultText;
  } else {
    replyText =
      `登録完了: 成功 ${success}件, 失敗 ${failed}件。\n` +
      `（エラー詳細はファイル・画像添付）\n` +
      `エラー件数: ${errors.length}件\n` +
      errors.slice(0, 10).join("\n");
  }

  // ファイル添付
  if (errors.length > 0) {
    const errorFileName = `bulk_error_${Date.now()}.txt`;
    fs.writeFileSync(errorFileName, resultText, "utf-8");
    files.push(new AttachmentBuilder(errorFileName));
  }

  // 画像添付
  if (errors.length > 0) {
    const maxLines = Math.min(errors.length + 3, 100); // タイトル＋エラー数＋空行＋最大エラー100件
    const width = 900;
    const height = 30 * maxLines + 30;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 背景
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);

    // タイトル
    ctx.font = "bold 26px 'sans-serif'";
    ctx.fillStyle = "#222";
    ctx.fillText(`登録完了: 成功 ${success}件, 失敗 ${failed}件`, 20, 28);

    // エラー件数
    ctx.font = "20px 'sans-serif'";
    ctx.fillStyle = "#c00";
    ctx.fillText(`エラー: ${errors.length}件`, 20, 58);

    // エラー詳細
    ctx.font = "17px 'monospace'";
    ctx.fillStyle = "#222";
    let y = 90;
    for (let i = 0; i < Math.min(errors.length, 100); i++) {
      ctx.fillText(errors[i], 20, y);
      y += 26;
    }
    if (errors.length > 100) {
      ctx.fillStyle = "#c00";
      ctx.fillText("...(省略)", 20, y);
    }

    // PNG画像として一時ファイル保存
    const imageFileName = `bulk_error_${Date.now()}.png`;
    const out = fs.createWriteStream(imageFileName);
    const stream = canvas.createPNGStream();
    await new Promise(resolve => {
      stream.pipe(out);
      out.on("finish", resolve);
    });
    files.push(new AttachmentBuilder(imageFileName));
  }

  // Discordに返信（メッセージ＋ファイル添付）
  await interaction.reply({
    content: replyText,
    files: files
  });

  // 添付ファイル（一時ファイル）削除
  files.forEach(f => {
    if (f.attachment && typeof f.attachment === "string") {
      fs.unlink(f.attachment, () => {});
    }
  });
}

// コマンド登録
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("ガチャ")
      .setDescription(`${GACHA_COST}${CURRENCY_UNIT}消費してガチャ`),
    new SlashCommandBuilder()
      .setName("残高")
      .setDescription("自分の残高確認"),
    new SlashCommandBuilder()
      .setName("発行")
      .setDescription(`${CURRENCY_UNIT}を指定ユーザーに発行`)
      .addUserOption(option =>
        option.setName("user").setDescription("発行先ユーザー").setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("amount").setDescription(`発行する${CURRENCY_UNIT}量`).setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("履歴")
      .setDescription("自分のガチャ結果履歴を表示"),
    new SlashCommandBuilder()
      .setName("入庫")
      .setDescription("商品を入庫する")
      .addStringOption(option =>
        option
          .setName("item")
          .setDescription("商品名")
          .setRequired(true)
          .addChoices(...ITEM_LIST.map(item => ({ name: item, value: item })))
      )
      .addIntegerOption(option =>
        option
          .setName("count")
          .setDescription("入庫数")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("出庫")
      .setDescription("商品を出庫する")
      .addStringOption(option =>
        option
          .setName("item")
          .setDescription("商品名")
          .setRequired(true)
          .addChoices(...ITEM_LIST.map(item => ({ name: item, value: item })))
      )
      .addIntegerOption(option =>
        option
          .setName("count")
          .setDescription("出庫数")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("在庫")
      .setDescription("商品在庫を一覧表示"),
    // bulkregister コマンド追加
    new SlashCommandBuilder()
      .setName("bulkregister")
      .setDescription("コピペで入出庫データを一括登録")
      .addStringOption(option =>
        option.setName("text")
          .setDescription("タブ区切りで貼り付けた入出庫データ（行ごと）")
          .setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("Slash commands registered");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;
  const uid = interaction.user.id;

  // bulkregisterコマンド
  if (interaction.commandName === "bulkregister") {
    await handleBulkRegister(interaction);
    return;
  }

  if (interaction.commandName === "ガチャ") {
    let bal = getBalance(uid);
    if (bal < GACHA_COST) {
      await interaction.reply({ content: `残高不足！（${bal}${CURRENCY_UNIT}）`, ephemeral: true });
      return;
    }
    subBalance(uid, GACHA_COST);
    const nb = getBalance(uid);

    await interaction.deferReply();
    await new Promise(r => setTimeout(r, 500));
    await interaction.followUp("ガチャを回します…");
    await new Promise(r => setTimeout(r, 1000));

    if (fs.existsSync(GACHA_ANIMATION_PATH)) {
      await interaction.followUp({ files: [GACHA_ANIMATION_PATH] });
    } else {
      await interaction.followUp("演出画像なし");
    }
    await new Promise(r => setTimeout(r, 2000));
    const result = Math.floor(Math.random() * 100) + 1;
    addGachaHistory(uid, result);
    await interaction.followUp(`✨結果: ${result}！残高: ${nb}${CURRENCY_UNIT}`);
  }

  if (interaction.commandName === "残高") {
    let bal = getBalance(uid);
    await interaction.reply({ content: `${interaction.user} 残高: ${bal}${CURRENCY_UNIT}`, ephemeral: true });
  }

  if (interaction.commandName === "履歴") {
    const history = getGachaHistory(uid, 10);
    if (history.length === 0) {
      await interaction.reply({ content: "履歴はありません。", ephemeral: true });
      return;
    }
    const historyText = history.map(h => `結果: ${h.result} (${h.timestamp})`).join("\n");
    await interaction.reply({ content: `あなたのガチャ履歴（最新10件）:\n${historyText}`, ephemeral: true });
  }

  if (interaction.commandName === "発行") {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(ISSUE_ROLE_ID)) {
      await interaction.reply({ content: "あなたは発行権限がありません。", ephemeral: true });
      return;
    }
    const targetUser = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");
    if (amount <= 0) {
      await interaction.reply({ content: "発行額は1以上にしてください。", ephemeral: true });
      return;
    }
    const nb = addBalance(targetUser.id, amount);
    await interaction.reply({ content: `${targetUser} に ${amount}${CURRENCY_UNIT} を発行しました。新残高: ${nb}${CURRENCY_UNIT}`, ephemeral: true });

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
      await interaction.reply({ content: "無効な商品名です。", ephemeral: true });
      return;
    }
    if (count <= 0) {
      await interaction.reply({ content: "入庫数は1以上を指定してください。", ephemeral: true });
      return;
    }
    const stock = addItemStock(uid, item, count);
    await interaction.reply({ content: `${item}を${count}個入庫しました。在庫: ${stock}個`, ephemeral: true });
  }

  if (interaction.commandName === "出庫") {
    const item = interaction.options.getString("item");
    const count = interaction.options.getInteger("count");
    if (!ITEM_LIST.includes(item)) {
      await interaction.reply({ content: "無効な商品名です。", ephemeral: true });
      return;
    }
    if (count <= 0) {
      await interaction.reply({ content: "出庫数は1以上を指定してください。", ephemeral: true });
      return;
    }
    const currStock = getItemStock(item);
    if (currStock < count) {
      await interaction.reply({ content: `在庫不足です。在庫: ${currStock}個`, ephemeral: true });
      return;
    }
    const stock = outItemStock(uid, item, count);
    await interaction.reply({ content: `${item}を${count}個出庫しました。在庫: ${stock}個`, ephemeral: true });
  }

  if (interaction.commandName === "在庫") {
    let msg = "【商品在庫一覧】\n";
    ITEM_LIST.forEach(item => {
      msg += `${item}: ${getItemStock(item)}個\n`;
    });
    await interaction.reply({ content: msg, ephemeral: true });
  }
});

client.login(TOKEN);
