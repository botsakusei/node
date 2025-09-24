import mongoose from 'mongoose';

const YoutubeVideoSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    unique: true
  },
  owner: {
    type: String,
    required: false
  },
  count: {
    type: Number,
    default: 0
  },
  totalCount: {        // ←★累計売上を追加
    type: Number,
    default: 0
  }
});

export default mongoose.model('YoutubeVideo', YoutubeVideoSchema);
