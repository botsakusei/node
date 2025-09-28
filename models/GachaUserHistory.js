import mongoose from 'mongoose';
const GachaUserHistorySchema = new mongoose.Schema({
  userId: String,             // DiscordユーザーID
  videoUrls: [String],        // 過去に引いたことのある動画URL配列
  lastUpdated: { type: Date, default: Date.now }
});
export default mongoose.model('GachaUserHistory', GachaUserHistorySchema);
