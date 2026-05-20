import BreakPolicy from "../model/BreakPolicy.js";

async function getPolicy() {
  let doc = await BreakPolicy.findOne({ key: "default" });
  if (!doc) doc = await BreakPolicy.create({ key: "default" });
  return doc;
}

export const getBreakPolicy = async (req, res) => {
  try {
    const policy = await getPolicy();
    return res.status(200).json({ success: true, data: policy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

export const updateBreakPolicy = async (req, res) => {
  try {
    const { slots } = req.body;
    const updatedBy = req.user?.employeeId ?? null;

    if (!Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({ error: "slots array is required" });
    }

    for (const s of slots) {
      if (!["MORNING", "LUNCH", "EVENING"].includes(s.type)) {
        return res.status(400).json({ error: `Invalid break type: ${s.type}` });
      }
      if (typeof s.allowedMinutes !== "number" || s.allowedMinutes < 1) {
        return res.status(400).json({ error: "allowedMinutes must be a positive number" });
      }
    }

    const policy = await BreakPolicy.findOneAndUpdate(
      { key: "default" },
      { $set: { slots, updatedBy } },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, data: policy });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};