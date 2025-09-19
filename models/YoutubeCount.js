import mongoose from 'mongoose';

const YoutubeCountSchema = new mongoose.Schema({
    url: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
});

export default mongoose.model('YoutubeCount', YoutubeCountSchema);
