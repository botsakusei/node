import { REST } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const TOKEN = process.env.TOKEN; // Botトークン
const CLIENT_ID = process.env.CLIENT_ID; // BotのアプリケーションID（Discord Developer Portalで確認）

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function deleteGlobalCommands() {
  try {
    // まず、現在のグローバルコマンド一覧を取得
    const commands = await rest.get(`/applications/${CLIENT_ID}/commands`);
    console.log('現在登録されているグローバルコマンド:', commands);

    // 各コマンドを削除
    for (const command of commands) {
      await rest.delete(`/applications/${CLIENT_ID}/commands/${command.id}`);
      console.log(`コマンド「${command.name}」を削除しました`);
    }
    console.log('すべてのグローバルコマンドを削除しました！');
  } catch (error) {
    console.error(error);
  }
}

deleteGlobalCommands();
