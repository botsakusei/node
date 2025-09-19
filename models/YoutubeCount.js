const { Schema, model } = require('mongoose');

const YoutubeVideoSchema = new Schema({
  url: { type: String, required: true, unique: true }, // 動画URL主キー
  owner: { type: String, default: '' },                // 所有者（ユーザー名）
  count: { type: Number, default: 0 }                  // 売上数
});

module.exports = model('YoutubeVideo', YoutubeVideoSchema);
