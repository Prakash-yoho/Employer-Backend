import mongoose from "mongoose";

const offerSequenceSchema = new mongoose.Schema({
    lastNumber: {
        type: Number,
        required: true,
        default: 0
    }
});

export default mongoose.model("OfferSequence", offerSequenceSchema);
