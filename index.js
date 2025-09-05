import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits, SlashCommandBuilder, Routes, InteractionType } from "discord.js";
import { REST } from "@discordjs/rest";
import sqlite3 from "better-sqlite3";
import fs from "fs";
import fetch from "node-fetch";

// 環境変数
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;
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

// 関数定義（重複無し！）
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

// csvimportコマンド（CSV添付で一括登録）
async function handleCsvImport(interaction) {
  await interaction.reply({ content: "CSVファイルをこのコマンド実行後、**同じチャンネルに**添付してください。\nファイル名は何でもOKです。", ephemeral: true });
}

// メッセージでcsvファイルを受信してDB登録
const CSV_IMPORT_STATE = {
  waiting: false,
  channelId: null,
  userId: null,
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once("ready", () => {
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
    new SlashCommandBuilder().setName("usernames").setDescription("DBに記載されているメンバーの名前(ユーザー名)をすべて出力"),
    new SlashCommandBuilder().setName("userlogimg").setDescription("指定した名前の入庫・出庫数をテキストで出力")
      .addStringOption(option => option.setName("name").setDescription("集計するユーザー名（CSVのuser列と一致）").setRequired(true)),
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

  // usernamesコマンド
  if (interaction.commandName === "usernames") {
    let names = db.prepare("SELECT DISTINCT user_id FROM item_in_log UNION SELECT DISTINCT user_id FROM item_out_log").all();
    if (names.length === 0) {
      await interaction.reply({ content: "DBに登録されたメンバーがいません。" });
      return;
    }
    let msg = "DBに記載されているメンバー（user_id列＝CSVのuser列）一覧:\n";
    for (const obj of names) {
      msg += `${obj.user_id}\n`;
    }
    // 2000文字制限対応
    let msgArray = [];
    while (msg.length > 1800) {
      msgArray.push(msg.slice(0, 1800));
      msg = msg.slice(1800);
    }
    if (msg.length > 0) msgArray.push(msg);
    for (let i = 0; i < msgArray.length; i++) {
      if (i === 0) {
        await interaction.reply({ content: msgArray[i] });
      } else {
        await interaction.followUp({ content: msgArray[i] });
      }
    }
    return;
  }

  // userlogimgコマンド（指定した名前で入庫・出庫数を出力。見やすく揃えて表示）
  if (interaction.commandName === "userlogimg") {
    const inputName = interaction.options.getString("name");
    let inlog = db.prepare("SELECT item_name, SUM(count) as sum FROM item_in_log WHERE user_id = ? GROUP BY item_name").all(inputName);
    let outlog = db.prepare("SELECT item_name, SUM(count) as sum FROM item_out_log WHERE user_id = ? GROUP BY item_name").all(inputName);

    function normalizeName(name) {
      return name.replace(/[\u30a1-\u30f6]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60));
    }
    const normalizedItemList = ITEM_LIST.map(normalizeName);

    let itemSums = {};
    for (let normItem of normalizedItemList) {
      itemSums[normItem] = { in: 0, out: 0 };
    }
    for (let obj of inlog) {
      let norm = normalizeName(obj.item_name);
      if (itemSums[norm]) itemSums[norm].in += obj.sum;
      else itemSums[norm] = { in: obj.sum, out: 0 };
    }
    for (let obj of outlog) {
      let norm = normalizeName(obj.item_name);
      if (itemSums[norm]) itemSums[norm].out += obj.sum;
      else itemSums[norm] = { in: 0, out: obj.sum };
    }

    let header = `ユーザー: ${inputName}\n`;
    header += "商品名".padEnd(14) + "入庫数".padStart(8) + "出庫数".padStart(8) + "\n";
    let msg = header;
    for (let normItem of normalizedItemList) {
      const sums = itemSums[normItem] || { in: 0, out: 0 };
      let dispName = normItem.replace(/[\u3041-\u3096]/g, s => String.fromCharCode(s.charCodeAt(0) + 0x60));
      msg += dispName.padEnd(14) + String(sums.in).padStart(8) + String(sums.out).padStart(8) + "\n";
    }

    let msgArray = [];
    while (msg.length > 1800) {
      msgArray.push(msg.slice(0, 1800));
      msg = msg.slice(1800);
    }
    if (msg.length > 0) msgArray.push(msg);

    for (let i = 0; i < msgArray.length; i++) {
      if (i == 0) {
        await interaction.reply({ content: msgArray[i] });
      } else {
        await interaction.followUp({ content: msgArray[i] });
      }
    }
    return;
  }

  // alluserlogコマンド（全ユーザー分分割して出力。見やすく揃えて表示）
  if (interaction.commandName === "alluserlog") {
    let allNames = db.prepare("SELECT DISTINCT user_id FROM item_in_log UNION SELECT DISTINCT user_id FROM item_out_log").all();
    if (allNames.length === 0) {
      await interaction.reply("登録データがありません。");
      return;
    }

    function normalizeName(name) {
      return name.replace(/[\u30a1-\u30f6]/g, s => String.fromCharCode(s.charCodeAt(0) - 0x60));
    }
    const normalizedItemList = ITEM_LIST.map(normalizeName);

    let msgArray = [];
    for (const obj of allNames) {
      const name = obj.user_id;
      let inlog = db.prepare("SELECT item_name, SUM(count) as sum FROM item_in_log WHERE user_id = ? GROUP BY item_name").all(name);
      let outlog = db.prepare("SELECT item_name, SUM(count) as sum FROM item_out_log WHERE user_id = ? GROUP BY item_name").all(name);

      let itemSums = {};
      for (let normItem of normalizedItemList) {
        itemSums[normItem] = { in: 0, out: 0 };
      }
      for (let obj of inlog) {
        let norm = normalizeName(obj.item_name);
        if (itemSums[norm]) itemSums[norm].in += obj.sum;
        else itemSums[norm] = { in: obj.sum, out: 0 };
      }
      for (let obj of outlog) {
        let norm = normalizeName(obj.item_name);
        if (itemSums[norm]) itemSums[norm].out += obj.sum;
        else itemSums[norm] = { in: 0, out: obj.sum };
      }

      let header = `ユーザー: ${name}\n`;
      header += "商品名".padEnd(14) + "入庫数".padStart(8) + "出庫数".padStart(8) + "\n";
      let msg = header;
      for (let normItem of normalizedItemList) {
        const sums = itemSums[normItem] || { in: 0, out: 0 };
        let dispName = normItem.replace(/[\u3041-\u3096]/g, s => String.fromCharCode(s.charCodeAt(0) + 0x60));
        msg += dispName.padEnd(14) + String(sums.in).padStart(8) + String(sums.out).padStart(8) + "\n";
      }
      msgArray.push(msg);
    }

    for (let i = 0; i < msgArray.length; i++) {
      if (i === 0) {
        await interaction.reply({ content: msgArray[i] });
      } else {
        await interaction.followUp({ content: msgArray[i] });
      }
    }
    return;
  }

  // ----- 既存の各種コマンド -----
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

// メッセージでcsvファイル添付を受信
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

  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  let success = 0, failed = 0, errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /日付|date|user|item|type|value/i.test(line)) continue;
    let parts = line.split(",");
    if (parts.length < 5) parts = line.split("\t");
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
    let validItem = ITEM_LIST.includes(item) ? item : null;
    if (!validItem) {
      validItem = item;
      const row = db.prepare("SELECT stock FROM item_stock WHERE item_name = ?").get(validItem);
      if (!row) db.prepare("INSERT INTO item_stock (item_name, stock) VALUES (?, ?)").run(validItem, 0);
      if (!ITEM_LIST.includes(validItem)) ITEM_LIST.push(validItem);
    }
    if (type === "在庫" || type === "入庫") {
      if (type === "在庫") {
        db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(value, validItem);
      } else {
        const before = getItemStock(validItem);
        db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(before + value, validItem);
      }
      db.prepare("INSERT INTO item_in_log (user_id, item_name, count, timestamp) VALUES (?, ?, ?, ?)").run(user, validItem, value, date);
      success++;
    } else if (type === "出庫") {
      const before = getItemStock(validItem);
      db.prepare("UPDATE item_stock SET stock = ? WHERE item_name = ?").run(before + value, validItem); // valueはマイナス
      db.prepare("INSERT INTO item_out_log (user_id, item_name, count, timestamp) VALUES (?, ?, ?, ?)").run(user, validItem, value, date);
      success++;
    } else {
      failed++;
      errors.push(`種別不明: ${line}`);
    }
  }

  await message.reply(
    `CSVインポート完了: 成功 ${success}件, 失敗 ${failed}件。\n` +
    (errors.length ? `エラー:\n${errors.join("\n")}` : "")
  );
  CSV_IMPORT_STATE.waiting = false;
});

client.login(TOKEN);
