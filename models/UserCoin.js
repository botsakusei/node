import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  coin: { type: Number, default: 0 }
});

export default mongoose.model('UserCoin', schema);
