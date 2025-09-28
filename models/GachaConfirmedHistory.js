import mongoose from 'mongoose';
const GachaConfirmedHistorySchema = new mongoose.Schema({
  userId: String,         // ガチャを引いたユーザーID
  owner: String,          // 確定枠の所有者名
  urls: [String],         // これまで当たった動画URL配列
});
export default mongoose.model('GachaConfirmedHistory', GachaConfirmedHistorySchema);
