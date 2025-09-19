// 売上カウント
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

// 代理登録コマンド（owner登録）
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, options, user } = interaction;
  if (commandName === '代理登録') {
    await interaction.deferReply();
    const url = options.getString('動画URL');
    const owner = options.getString('ユーザー名');
    let video = await YoutubeVideo.findOne({ url });
    if (!video) {
      video = new YoutubeVideo({ url, owner });
    } else {
      video.owner = owner;
    }
    await video.save();
    return interaction.editReply(`動画URL: ${url} の所有者を ${owner} に登録しました。`);
  }

  // 売上ランキング
  if (commandName === '売上') {
    await interaction.deferReply();
    const videos = await YoutubeVideo.find({});
    const userSales = {};
    videos.forEach(v => {
      if (v.owner) {
        if (!userSales[v.owner]) userSales[v.owner] = 0;
        userSales[v.owner] += v.count;
      }
    });
    let replyMsg = '動画販売ランキング:\n';
    Object.entries(userSales).forEach(([u, c]) => {
      replyMsg += `${u}: ${c}本\n`;
    });
    return interaction.editReply(replyMsg || '登録ユーザーがいません');
  }
});
