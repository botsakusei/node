import mongoose from 'mongoose';

const YoutubeVideoSchema = new mongoose.Schema({
  url: { type: String, required: true, unique: true },
  owner: { type: String, default: '' },
  count: { type: Number, default: 0 }
});

const YoutubeVideo = mongoose.model('YoutubeVideo', YoutubeVideoSchema);
export default YoutubeVideo;
