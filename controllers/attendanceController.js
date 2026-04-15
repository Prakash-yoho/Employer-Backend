import Attendance from "../model/Attendance.js";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from '../config/s3.js';
import { v4 as uuidv4 } from "uuid";

const bucketName = process.env.AWS_S3_BUCKET;

// ─── Helpers ───

// Upload Base64 image to S3
async function uploadImage(base64Image, folder = "attendance") {
  if (!base64Image) return null;

  const buffer = Buffer.from(
    base64Image.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );

  const fileName = `${folder}/${uuidv4()}.jpg`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: buffer,
      ContentType: "image/jpeg",
    })
  );

const REGION = "ap-south-2";
return `https://${bucketName}.s3.${REGION}.amazonaws.com/${fileName}`;}

// Parse location safely
function parseLocation(location) {
  if (
    !location ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  ) return null;

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy ?? null,
  };
}

// Get current date & time
function getNow() {
  const now = new Date();
  return {
    date: now.toISOString().split("T")[0],
    time: now.toLocaleTimeString(),
  };
}

// ─── Controllers ─────────────────────────────────────

// Clock In
export const clockIn = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    if (!employeeId) {
      return res.status(400).json({ error: "employeeId is required" });
    }

    const existing = await Attendance.findOne({ employeeId, date });
    if (existing) {
      return res.status(409).json({ error: "Already clocked in today" });
    }

    const [clockInImage, clockInLocation] = await Promise.all([
      uploadImage(image, "clock-in"),
      Promise.resolve(parseLocation(location)),
    ]);

    const attendance = await Attendance.create({
      employeeId,
      date,
      clockIn: time,
      clockInImage,
      clockInLocation,
      breaks: [],
    });

    res.status(201).json(attendance);
  } catch (err) {
    console.error("Clock-In Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Start Break
export const startBreak = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    const attendance = await Attendance.findOne({ employeeId, date });

    if (!attendance) {
      return res.status(404).json({ error: "No clock-in found for today" });
    }

    const lastBreak = attendance.breaks.at(-1);
    if (lastBreak && !lastBreak.end) {
      return res.status(409).json({ error: "Break already in progress" });
    }

    const startImage = await uploadImage(image, "break-start");
    const startLocation = parseLocation(location);

    attendance.breaks.push({
      start: time,
      end: null,
      startImage,
      startLocation,
    });

    await attendance.save();

    res.json(attendance);
  } catch (err) {
    console.error("Start Break Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// End Break
export const endBreak = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    const attendance = await Attendance.findOne({ employeeId, date });

    if (!attendance) {
      return res.status(404).json({ error: "No clock-in found for today" });
    }

    const lastBreak = attendance.breaks.at(-1);

    if (!lastBreak || lastBreak.end) {
      return res.status(404).json({ error: "No active break to end" });
    }

    const endImage = await uploadImage(image, "break-end");
    const endLocation = parseLocation(location);

    lastBreak.end = time;
    lastBreak.endImage = endImage;
    lastBreak.endLocation = endLocation;

    attendance.markModified("breaks");
    await attendance.save();

    res.json(attendance);
  } catch (err) {
    console.error("End Break Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Clock Out
export const clockOut = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    const attendance = await Attendance.findOne({ employeeId, date });

    if (!attendance) {
      return res.status(404).json({ error: "No clock-in found for today" });
    }

    if (attendance.clockOut) {
      return res.status(409).json({ error: "Already clocked out" });
    }

    // Auto close active break
    const lastBreak = attendance.breaks.at(-1);
    if (lastBreak && !lastBreak.end) {
      lastBreak.end = time;
      attendance.markModified("breaks");
    }

    const [clockOutImage, clockOutLocation] = await Promise.all([
      uploadImage(image, "clock-out"),
      Promise.resolve(parseLocation(location)),
    ]);

    attendance.clockOut = time;
    attendance.clockOutImage = clockOutImage;
    attendance.clockOutLocation = clockOutLocation;

    await attendance.save();

    res.json(attendance);
  } catch (err) {
    console.error("Clock-Out Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// Get Logs
export const getLogs = async (req, res) => {
  try {
    const filter = {};

    if (req.query.employeeId) {
      filter.employeeId = req.query.employeeId;
    }

    if (req.query.date) {
      filter.date = req.query.date;
    }

    const logs = await Attendance.find(filter).sort({ createdAt: -1 });

    res.json(logs);
  } catch (err) {
    console.error("Get Logs Error:", err);
    res.status(500).json({ error: err.message });
  }
};









// ─── Get Signed URL for any attendance image ──────────────────────────────────
export const getAttendanceImageUrl = async (req, res) => {
  try {
    const { imageUrl } = req.query;

    if (!imageUrl) {
      return res.status(400).json({ error: "imageUrl query param is required" });
    }

    // Extract S3 key from the full URL
    let s3Key = imageUrl.split(".amazonaws.com/")[1];
    if (!s3Key) {
      return res.status(400).json({ error: "Invalid S3 image URL" });
    }
    if (s3Key.includes("?")) {
      s3Key = s3Key.split("?")[0];
    }

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key:    s3Key,
      ResponseContentType: "image/jpeg",
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 5 }); // 5 min

    return res.status(200).json({
      success:   true,
      signedUrl,
      expiresIn: 300,
    });
  } catch (err) {
    console.error("Get Attendance Image Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── Get all signed URLs for a specific attendance log ────────────────────────
export const getAttendanceLogImages = async (req, res) => {
  try {
    const { logId } = req.params;

    const log = await Attendance.findById(logId);
    if (!log) {
      return res.status(404).json({ error: "Attendance log not found" });
    }

    // Helper — signs a URL or returns null
    const sign = async (url) => {
      if (!url) return null;
      try {
        let s3Key = url.split(".amazonaws.com/")[1];
        if (s3Key?.includes("?")) s3Key = s3Key.split("?")[0];
        const cmd = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
        return await getSignedUrl(s3, cmd, { expiresIn: 300 });
      } catch { return null; }
    };

    // Sign all images in parallel
    const [clockInSigned, clockOutSigned] = await Promise.all([
      sign(log.clockInImage),
      sign(log.clockOutImage),
    ]);

    const breaksSigned = await Promise.all(
      log.breaks.map(async (b) => ({
        start:      b.start,
        end:        b.end,
        startImage: await sign(b.startImage),
        endImage:   await sign(b.endImage),
      }))
    );

    return res.status(200).json({
      success:     true,
      date:        log.date,
      clockIn:     log.clockIn,
      clockOut:    log.clockOut,
      clockInImage:  clockInSigned,
      clockOutImage: clockOutSigned,
      breaks:      breaksSigned,
      expiresIn:   300,
    });
  } catch (err) {
    console.error("Get Log Images Error:", err);
    return res.status(500).json({ error: err.message });
  }
};