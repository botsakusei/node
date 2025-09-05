import dotenv from "dotenv";
dotenv.config();

import { Client, GatewayIntentBits, SlashCommandBuilder, Routes, InteractionType, PermissionFlagsBits } from "discord.js";
import { REST } from "@discordjs/rest";
import sqlite3 from "better-sqlite3";
import fs from "fs";
import path from "path";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const DB_FILE = "delta_currency.db";
const GACHA_ANIMATION_PATH = "free_gacha_animation.gif";
const GACHA_COST = 10;
const CURRENCY_UNIT = "デルタ";
const ISSUE_ROLE_ID = process.env.ISSUE_ROLE_ID; // 発行権限ロールID
const ISSUE_LOG_CHANNEL_ID = process.env.ISSUE_LOG_CHANNEL_ID; // ログ出力チャンネルID

const db = sqlite3(DB_FILE);
db.prepare(`CREATE TABLE IF NOT EXISTS currency (user_id TEXT PRIMARY KEY, balance INTEGER NOT NULL)`).run();

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
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("Slash commands registered");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

client.on("interactionCreate", async interaction => {
  if (interaction.type !== InteractionType.ApplicationCommand) return;
  const uid = interaction.user.id;

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
    await interaction.followUp(`✨結果: ${result}！残高: ${nb}${CURRENCY_UNIT}`);
  }

  if (interaction.commandName === "残高") {
    let bal = getBalance(uid);
    await interaction.reply(`${interaction.user} 残高: ${bal}${CURRENCY_UNIT}`);
  }

  // 追加: 発行コマンド
  if (interaction.commandName === "発行") {
    // ロールチェック
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
    await interaction.reply(`${targetUser} に ${amount}${CURRENCY_UNIT} を発行しました。新残高: ${nb}${CURRENCY_UNIT}`);

    // ログ出力
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
});

client.login(TOKEN);
