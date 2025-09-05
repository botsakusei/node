client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands(); // ← コメントアウトを外して起動
});
