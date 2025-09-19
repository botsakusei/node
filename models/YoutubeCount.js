import { Schema, model } from 'mongoose';

const YoutubeVideoSchema = new Schema({
  url: { type: String, required: true, unique: true },
  owner: { type: String, default: '' },
  count: { type: Number, default: 0 }
});

export default model('YoutubeVideo', YoutubeVideoSchema);
