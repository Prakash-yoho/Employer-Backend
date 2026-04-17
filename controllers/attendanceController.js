import Attendance from "../model/Attendance.js";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from '../config/s3.js';
import { v4 as uuidv4 } from "uuid";
import Employee from '../model/Employee.js';

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
  return `https://${bucketName}.s3.${REGION}.amazonaws.com/${fileName}`;
}

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
      Key: s3Key,
      ResponseContentType: "image/jpeg",
    });

    const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 * 5 }); // 5 min

    return res.status(200).json({
      success: true,
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
        start: b.start,
        end: b.end,
        startImage: await sign(b.startImage),
        endImage: await sign(b.endImage),
      }))
    );

    return res.status(200).json({
      success: true,
      date: log.date,
      clockIn: log.clockIn,
      clockOut: log.clockOut,
      clockInImage: clockInSigned,
      clockOutImage: clockOutSigned,
      breaks: breaksSigned,
      expiresIn: 300,
    });
  } catch (err) {
    console.error("Get Log Images Error:", err);
    return res.status(500).json({ error: err.message });
  }
};









// attentance employee details get in hr panel



// ─── Helper: Sign a single S3 URL ────────────────────────────────────────────
const signUrl = async (url) => {
  if (!url) return null;
  try {
    let s3Key = url.split(".amazonaws.com/")[1];
    if (s3Key?.includes("?")) s3Key = s3Key.split("?")[0];
    const cmd = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
    return await getSignedUrl(s3, cmd, { expiresIn: 300 });
  } catch {
    return null;
  }
};

// ─── Helper: Format duration in minutes between two time strings ──────────────
const calcDurationMinutes = (start, end) => {
  if (!start || !end) return null;
  const toMinutes = (t) => {
    const [time, period] = t.split(" ");
    let [h, m, s] = time.split(":").map(Number);
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + m + (s || 0) / 60;
  };
  return Math.round(toMinutes(end) - toMinutes(start));
};

// ─── GET /api/admin/attendance ────────────────────────────────────────────────
// Returns paginated list of all employees with their latest attendance summary
export const getAllEmployeesAttendance = async (req, res) => {
  try {
    const { page = 1, limit = 10, date, search, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const targetDate = date || new Date().toISOString().split("T")[0];

    // Build employee search filter
    const employeeMatch = {};
    if (search) {
      employeeMatch.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } },
      ];
    }

    // Pipeline starting from Employee collection
    const pipeline = [
      { $match: { isActive: true, ...employeeMatch } },
      {
        $lookup: {
          from: "attendances", // your attendance collection name
          let: { empId: "$employeeId" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$employeeId", "$$empId"] },
                    { $eq: ["$date", targetDate] },
                  ],
                },
              },
            },
          ],
          as: "todayAttendance",
        },
      },
      {
        $addFields: {
          attendanceRecord: { $arrayElemAt: ["$todayAttendance", 0] },
        },
      },
      {
        $addFields: {
          clockIn: { $ifNull: ["$attendanceRecord.clockIn", null] },
          clockOut: { $ifNull: ["$attendanceRecord.clockOut", null] },
          breaks: { $ifNull: ["$attendanceRecord.breaks", []] },
          hasRecord: { $cond: [{ $ifNull: ["$attendanceRecord", false] }, true, false] },
        },
      },
      {
        $addFields: {
          attendanceStatus: {
            $cond: [
              { $ifNull: ["$clockIn", false] },
              {
                $let: {
                  vars: {
                    parts: { $split: ["$clockIn", " "] },
                  },
                  in: {
                    $cond: [
                      {
                        $and: [
                          { $eq: [{ $arrayElemAt: ["$$parts", 1] }, "PM"] },
                          { $gte: [{ $toInt: { $arrayElemAt: [{ $split: [{ $arrayElemAt: ["$$parts", 0] }, ":"] }, 0] } }, 10] },
                        ],
                      },
                      "Late",
                      "Present",
                    ],
                  },
                },
              },
              "Absent",
            ],
          },
          totalBreaks: { $size: { $ifNull: ["$attendanceRecord.breaks", []] } },
          hasActiveBreak: {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ["$attendanceRecord.breaks", []] },
                    as: "b",
                    cond: { $and: [{ $ifNull: ["$$b.start", false] }, { $not: { $ifNull: ["$$b.end", false] } }] },
                  },
                },
              },
              0,
            ],
          },
        },
      },
    ];

    // Status filter
    if (status && status !== "all") {
      pipeline.push({ $match: { attendanceStatus: { $regex: status, $options: "i" } } });
    }

    // Count
    const countPipeline = [...pipeline, { $count: "total" }];
    const countResult = await Employee.aggregate(countPipeline); // ← import Employee model
    const total = countResult[0]?.total || 0;

    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: parseInt(limit) });

    const records = await Employee.aggregate(pipeline);

    const data = records.map((emp) => ({
      employeeId: emp.employeeId,
      name: `${emp.firstName} ${emp.lastName}` || emp.employeeId,
      email: emp.officialEmail || "",
      department: emp.department || "",
      designation: emp.designation || "",
      avatar: emp.avatar || null,
      latestDate: targetDate,
      clockIn: emp.clockIn,
      clockOut: emp.clockOut,
      status: emp.attendanceStatus,
      totalBreaks: emp.totalBreaks,
      hasActiveBreak: emp.hasActiveBreak,
      totalDays: 0,
      presentDays: 0,
    }));

    return res.status(200).json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasPrev: parseInt(page) > 1,
        hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getAllEmployeesAttendance Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/admin/attendance/:employeeId ─────────────────────────────────────
// Returns paginated attendance logs for a specific employee
export const getEmployeeAttendanceLogs = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { page = 1, limit = 20, month, year } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = { employeeId };

    // Filter by month/year if provided
    if (month && year) {
      const paddedMonth = String(month).padStart(2, "0");
      filter.date = {
        $regex: `^${year}-${paddedMonth}`,
      };
    } else if (year) {
      filter.date = { $regex: `^${year}` };
    }

    const total = await Attendance.countDocuments(filter);
    const logs = await Attendance.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Calculate work duration per log
    const enrichedLogs = logs.map((log) => {
      const workMinutes = calcDurationMinutes(log.clockIn, log.clockOut);
      const totalBreakMinutes = log.breaks.reduce((acc, b) => {
        const dur = calcDurationMinutes(b.start, b.end);
        return acc + (dur || 0);
      }, 0);

      return {
        _id: log._id,
        date: log.date,
        clockIn: log.clockIn,
        clockOut: log.clockOut || null,
        clockInLocation: log.clockInLocation,
        clockOutLocation: log.clockOutLocation,
        breaks: log.breaks.map((b) => ({
          start: b.start,
          end: b.end || null,
          startLocation: b.startLocation,
          endLocation: b.endLocation,
          duration: calcDurationMinutes(b.start, b.end),
        })),
        totalBreaks: log.breaks.length,
        workDurationMinutes: workMinutes,
        breakDurationMinutes: totalBreakMinutes,
        netWorkMinutes:
          workMinutes != null ? workMinutes - totalBreakMinutes : null,
        status: log.clockOut
          ? "Completed"
          : log.clockIn
            ? "Active"
            : "Absent",
      };
    });

    return res.status(200).json({
      success: true,
      employeeId,
      data: enrichedLogs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasPrev: parseInt(page) > 1,
        hasNext: parseInt(page) < Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error("getEmployeeAttendanceLogs Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/admin/attendance/:employeeId/log/:logId ─────────────────────────
// Returns a single detailed attendance log with signed image URLs
export const getEmployeeLogDetail = async (req, res) => {
  try {
    const { logId } = req.params;

    const log = await Attendance.findById(logId);
    if (!log) {
      return res.status(404).json({ error: "Attendance log not found" });
    }

    // Sign all images in parallel
    const [clockInSigned, clockOutSigned] = await Promise.all([
      signUrl(log.clockInImage),
      signUrl(log.clockOutImage),
    ]);

    const breaksSigned = await Promise.all(
      log.breaks.map(async (b) => ({
        start: b.start,
        end: b.end || null,
        startLocation: b.startLocation,
        endLocation: b.endLocation,
        startImage: await signUrl(b.startImage),
        endImage: await signUrl(b.endImage),
        duration: calcDurationMinutes(b.start, b.end),
      }))
    );

    const workMinutes = calcDurationMinutes(log.clockIn, log.clockOut);
    const totalBreakMinutes = breaksSigned.reduce(
      (acc, b) => acc + (b.duration || 0),
      0
    );

    return res.status(200).json({
      success: true,
      data: {
        _id: log._id,
        employeeId: log.employeeId,
        date: log.date,
        clockIn: log.clockIn,
        clockOut: log.clockOut || null,
        clockInImage: clockInSigned,
        clockOutImage: clockOutSigned,
        clockInLocation: log.clockInLocation,
        clockOutLocation: log.clockOutLocation,
        breaks: breaksSigned,
        totalBreaks: log.breaks.length,
        workDurationMinutes: workMinutes,
        breakDurationMinutes: totalBreakMinutes,
        netWorkMinutes:
          workMinutes != null ? workMinutes - totalBreakMinutes : null,
        status: log.clockOut
          ? "Completed"
          : log.clockIn
            ? "Active"
            : "Absent",
      },
      expiresIn: 300,
    });
  } catch (err) {
    console.error("getEmployeeLogDetail Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── GET /api/admin/attendance/summary ────────────────────────────────────────
// Returns today's overall attendance summary stats
export const getAttendanceSummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split("T")[0];

    const [todayLogs, totalEmployees] = await Promise.all([
      Attendance.find({ date: targetDate }),
      Employee.countDocuments({ isActive: true }),  // ← add this
    ]);

    const present = todayLogs.filter((l) => l.clockIn).length;
    const completed = todayLogs.filter((l) => l.clockIn && l.clockOut).length;
    const active = todayLogs.filter((l) => l.clockIn && !l.clockOut).length;
    const onBreak = todayLogs.filter((l) =>
      l.breaks?.some((b) => b.start && !b.end)
    ).length;

    return res.status(200).json({
      success: true,
      date: targetDate,
      summary: {
        total: totalEmployees,          // ← total active employees, not just logs
        present,
        completed,
        active,
        onBreak,
        absent: totalEmployees - present,  // ← real absent count
      },
    });
  } catch (err) {
    console.error("getAttendanceSummary Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
