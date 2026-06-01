import Attendance from "../model/Attendance.js";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from '../config/s3.js';
import { v4 as uuidv4 } from "uuid";
import Employee from '../model/Employee.js';
import Holiday from "../model/Holiday.js";
import OfficeTiming from "../model/Officetiming.js";
import BreakPolicy from "../model/BreakPolicy.js";
import { hhmmToMinutes, timeStrToMinutes } from "./Officetimingcontroller.js";
import dayjs from "dayjs";

const bucketName = process.env.AWS_S3_BUCKET;
const awsregion = process.env.AWS_REGION;

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
  return `https://${bucketName}.s3.${awsregion}.amazonaws.com/${fileName}`;
}

// Parse location safely
function parseLocation(location) {
  if (
    !location ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  )
    return null;
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

/** Lazily fetch (or create) the singleton OfficeTiming document. */
async function getOfficeTiming() {
  let doc = await OfficeTiming.findOne({ key: "default" });
  if (!doc) doc = await OfficeTiming.create({ key: "default" });
  return doc;
}

// ─── Controllers ─────────────────────────────────────

// Clock In
// ─── Clock In ─────────────────────────────────────────────────────────────────
export const clockIn = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    if (!employeeId)
      return res.status(400).json({ error: "employeeId is required" });

    const existing = await Attendance.findOne({ employeeId, date });
    if (existing)
      return res.status(409).json({ error: "Already clocked in today" });

    // ── Office timing check ──────────────────────────────────────────────────
    const timing = await getOfficeTiming();
    const cutoffMins = hhmmToMinutes(timing.startTime) + timing.graceMinutes;
    const clockInMin = timeStrToMinutes(time);

    const lateLogin = clockInMin != null && clockInMin > cutoffMins;
    const lateByMinutes = lateLogin ? Math.round(clockInMin - cutoffMins) : null;

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
      lateLogin,
      lateByMinutes,
    });

    // Include timing info in response so the client can show a toast/modal
    return res.status(201).json({
      ...attendance.toObject(),
      _officeTiming: {
        startTime: timing.startTime,
        endTime: timing.endTime,
        graceMinutes: timing.graceMinutes,
        lateLogin,
        lateByMinutes,
      },
    });
  } catch (err) {
    console.error("Clock-In Error:", err);
    return res.status(500).json({ error: err.message });
  }
};


// ─── Helper: get break policy ─────────────────────────────────────────────────
async function getBreakPolicy() {
  let doc = await BreakPolicy.findOne({ key: "default" });
  if (!doc) doc = await BreakPolicy.create({ key: "default" });
  return doc;
}

// Start Break
export const startBreak = async (req, res) => {
  const { employeeId, image, location, breakType = "OTHER" } = req.body;
  const { date, time } = getNow();

  try {
    const attendance = await Attendance.findOne({ employeeId, date });
    if (!attendance)
      return res.status(404).json({ error: "No clock-in found for today" });

    const lastBreak = attendance.breaks.at(-1);
    if (lastBreak && !lastBreak.end)
      return res.status(409).json({ error: "Break already in progress" });

    // ── Validate breakType against policy ──────────────────────────────────
    const policy = await getBreakPolicy();
    const slot = policy.slots.find((s) => s.type === breakType && s.isActive);

    // Check if this breakType was already used today
    if (breakType !== "OTHER") {
      const alreadyUsed = attendance.breaks.some(
        (b) => b.breakType === breakType && b.end // completed break of same type
      );
      if (alreadyUsed) {
        return res.status(409).json({
          error: `${breakType.charAt(0) + breakType.slice(1).toLowerCase()} break already taken today`,
        });
      }
    }

    const startImage    = await uploadImage(image, "break-start");
    const startLocation = parseLocation(location);

    attendance.breaks.push({
      start:          time,
      end:            null,
      startImage,
      startLocation,
      breakType,
      allowedMinutes: slot?.allowedMinutes ?? null,
      overByMinutes:  null,
      isBreakViolation: false,
    });

    await attendance.save();

    return res.json({
      ...attendance.toObject(),
      _breakPolicy: slot
        ? { type: slot.type, label: slot.label, allowedMinutes: slot.allowedMinutes }
        : null,
    });
  } catch (err) {
    console.error("Start Break Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// End Break
export const endBreak = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    const attendance = await Attendance.findOne({ employeeId, date });
    if (!attendance)
      return res.status(404).json({ error: "No clock-in found for today" });

    const lastBreak = attendance.breaks.at(-1);
    if (!lastBreak || lastBreak.end)
      return res.status(404).json({ error: "No active break to end" });

    const endImage    = await uploadImage(image, "break-end");
    const endLocation = parseLocation(location);

    // ── Compute duration & violation ─────────────────────────────────────────
    const durationMins = calcDurationMinutes(lastBreak.start, time);
    const allowed      = lastBreak.allowedMinutes;
    const overByMinutes =
      allowed != null && durationMins != null && durationMins > allowed
        ? Math.round(durationMins - allowed)
        : null;

    lastBreak.end              = time;
    lastBreak.endImage         = endImage;
    lastBreak.endLocation      = endLocation;
    lastBreak.overByMinutes    = overByMinutes;
    lastBreak.isBreakViolation = overByMinutes != null && overByMinutes > 0;

    attendance.markModified("breaks");
    await attendance.save();

    return res.json({
      ...attendance.toObject(),
      _breakFeedback: {
        breakType:    lastBreak.breakType,
        durationMins,
        allowedMinutes: allowed,
        overByMinutes,
        isViolation:  lastBreak.isBreakViolation,
      },
    });
  } catch (err) {
    console.error("End Break Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// Clock Out
// ─── Clock Out ────────────────────────────────────────────────────────────────
export const clockOut = async (req, res) => {
  const { employeeId, image, location } = req.body;
  const { date, time } = getNow();

  try {
    const attendance = await Attendance.findOne({ employeeId, date });
    if (!attendance)
      return res.status(404).json({ error: "No clock-in found for today" });
    if (attendance.clockOut)
      return res.status(409).json({ error: "Already clocked out" });

    // Auto-close any open break
    const lastBreak = attendance.breaks.at(-1);
    if (lastBreak && !lastBreak.end) {
      lastBreak.end = time;
      attendance.markModified("breaks");
    }

    // ── Office timing check ──────────────────────────────────────────────────
    const timing = await getOfficeTiming();
    const endTimeMins = hhmmToMinutes(timing.endTime);
    const clockOutMins = timeStrToMinutes(time);

    const earlyLogout = clockOutMins != null && clockOutMins < endTimeMins;
    const earlyByMinutes = earlyLogout
      ? Math.round(endTimeMins - clockOutMins)
      : null;

    const [clockOutImage, clockOutLocation] = await Promise.all([
      uploadImage(image, "clock-out"),
      Promise.resolve(parseLocation(location)),
    ]);

    attendance.clockOut = time;
    attendance.clockOutImage = clockOutImage;
    attendance.clockOutLocation = clockOutLocation;
    attendance.earlyLogout = earlyLogout;
    attendance.earlyByMinutes = earlyByMinutes;

    await attendance.save();

    return res.json({
      ...attendance.toObject(),
      _officeTiming: {
        startTime: timing.startTime,
        endTime: timing.endTime,
        graceMinutes: timing.graceMinutes,
        earlyLogout,
        earlyByMinutes,
      },
    });
  } catch (err) {
    console.error("Clock-Out Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// Get Logs
export const getLogs = async (req, res) => {
  try {
    const filter = {};

    if (req.query.employeeId) filter.employeeId = req.query.employeeId;

    if (req.query.date) {
      filter.date = req.query.date;
    } else if (req.query.month) {
      filter.date = { $regex: `^${req.query.month}` };
    } else if (req.query.year) {
      filter.date = { $regex: `^${req.query.year}` };
    }

    const logs = await Attendance.find(filter).sort({ createdAt: -1 });

    // ── Shared helper ─────────────────────────────────────────────────────────
    const buildCalendar = (logs, holidayDocs, startDate, endDate) => {
      const today = new Date().toISOString().split("T")[0];

      // Build holidayMap: "YYYY-MM-DD" → full holiday doc
      const holidayMap = {};
      for (const h of holidayDocs) {
        const key = dayjs.utc(h.date).format("YYYY-MM-DD");
        holidayMap[key] = h;
      }

      // Build logMap: "YYYY-MM-DD" → attendance doc
      const logMap = {};
      for (const log of logs) {
        logMap[log.date] = log;
      }

      const fullCalendar = [];
      const cursor = new Date(startDate + "T00:00:00Z");
      const end = new Date(endDate + "T00:00:00Z");

      while (cursor <= end) {
        const dateStr = cursor.toISOString().split("T")[0];
        const dow = cursor.getUTCDay(); // 0=Sun, 6=Sat

        // Skip future dates
        if (dateStr > today) {
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          continue;
        }

        const isWeekend = dow === 0 || dow === 6;
        const hDoc = holidayMap[dateStr] ?? null;
        const isHoliday = !!hDoc;

        if (logMap[dateStr]) {
          // Real attendance record
          const log = logMap[dateStr].toObject
            ? logMap[dateStr].toObject()
            : { ...logMap[dateStr] };

          log.status = log.clockOut ? "present" : log.clockIn ? "incomplete" : "absent";
          log.isHoliday = isHoliday;
          log.holidayName = isHoliday ? hDoc.name : null;
          log.holidayType = isHoliday ? hDoc.type : null;
          fullCalendar.push(log);

        } else if (isHoliday || isWeekend) {
          let statusLabel;
          let holidayType;

          if (isHoliday) {
            const typeLabel = {
              GOVERNMENT: "Government Holiday",
              OPTIONAL: "Optional Holiday",
              COMPANY: "Company Holiday",
            }[hDoc.type] ?? "Holiday";

            statusLabel = `${hDoc.name} · ${typeLabel}`;
            holidayType = hDoc.type;
          } else {
            statusLabel = dow === 0 ? "Sunday · Weekend" : "Saturday · Weekend";
            holidayType = "WEEKEND";
          }

          fullCalendar.push({
            _id: `holiday-${dateStr}`,
            employeeId: req.query.employeeId,
            date: dateStr,
            status: "holiday",
            holidayType,
            statusLabel,
            clockIn: null,
            clockOut: null,
            breaks: [],
          });

        } else {
          // Weekday, past/today, no record
          fullCalendar.push({
            _id: `absent-${dateStr}`,
            employeeId: req.query.employeeId,
            date: dateStr,
            status: "absent",
            statusLabel: "No attendance marked for the day",
            clockIn: null,
            clockOut: null,
            breaks: [],
          });
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      // Most recent first
      fullCalendar.sort((a, b) => (a.date > b.date ? -1 : 1));
      return fullCalendar;
    };

    // ── Month view ────────────────────────────────────────────────────────────
    if (req.query.month && !req.query.date) {
      const [year, month] = req.query.month.split("-").map(Number);
      const daysInMonth = new Date(year, month, 0).getDate();
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

      const holidayDocs = await Holiday.find({ year }).lean();
      return res.json(buildCalendar(logs, holidayDocs, startDate, endDate));
    }

    // ── Year view ─────────────────────────────────────────────────────────────
    if (req.query.year && !req.query.date && !req.query.month) {
      const year = parseInt(req.query.year);
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const holidayDocs = await Holiday.find({ year }).lean();
      return res.json(buildCalendar(logs, holidayDocs, startDate, endDate));
    }

    // ── Day view / fallback ───────────────────────────────────────────────────
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

  const toSeconds = (t) => {
    const [time, periodRaw] = t.trim().split(" ");
    const period = periodRaw.toUpperCase(); // AM / PM

    let [h, m, s] = time.split(":").map(Number);

    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;

    return h * 3600 + m * 60 + (s || 0);
  };

  let diffSeconds = toSeconds(end) - toSeconds(start);

  // handle overnight shift (optional safety)
  if (diffSeconds < 0) diffSeconds += 24 * 3600;

  return Math.floor(diffSeconds / 60);
};

// ─── GET /api/admin/attendance ────────────────────────────────────────────────
// Returns paginated list of all employees with their latest attendance summary
export const getAllEmployeesAttendance = async (req, res) => {
  try {
    const { page = 1, limit = 10, date, search, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const targetDate = date || new Date().toISOString().split("T")[0];

    // ── Fetch OfficeTiming dynamically ─────────────────────────────────
    const timing = await OfficeTiming.findOne({ key: "default" });
    const [startH, startM] = (timing?.startTime ?? "09:00").split(":").map(Number);
    const grace = timing?.graceMinutes ?? 0;
    const cutoffMinutes = startH * 60 + startM + grace;

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
                  vars: { parts: { $split: ["$clockIn", " "] } },
                  in: {
                    $let: {
                      vars: {
                        period: { $toUpper: { $arrayElemAt: ["$$parts", 1] } },
                        timeParts: { $split: [{ $arrayElemAt: ["$$parts", 0] }, ":"] },
                      },
                      in: {
                        $let: {
                          vars: {
                            rawHour: { $toInt: { $arrayElemAt: ["$$timeParts", 0] } },
                            minute: { $toInt: { $arrayElemAt: ["$$timeParts", 1] } },
                          },
                          in: {
                            $let: {
                              vars: {
                                // Correct 12-hour → 24-hour conversion
                                hour: {
                                  $switch: {
                                    branches: [
                                      // 12:xx AM → 0
                                      {
                                        case: { $and: [{ $eq: ["$$period", "AM"] }, { $eq: ["$$rawHour", 12] }] },
                                        then: 0
                                      },
                                      // 12:xx PM → 12 (no change)
                                      {
                                        case: { $and: [{ $eq: ["$$period", "PM"] }, { $eq: ["$$rawHour", 12] }] },
                                        then: 12
                                      },
                                      // 1–11 PM → add 12
                                      {
                                        case: { $eq: ["$$period", "PM"] },
                                        then: { $add: ["$$rawHour", 12] }
                                      },
                                    ],
                                    default: "$$rawHour"  // AM, not 12 → unchanged
                                  }
                                }
                              },
                              in: {
                                $cond: [
                                  {
                                    $lte: [
                                      { $add: [{ $multiply: ["$$hour", 60] }, "$$minute"] },
                                      cutoffMinutes   // ← dynamic, e.g. 610
                                    ]
                                  },
                                  "Present",
                                  "Late"
                                ]
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              "Absent"
            ]
          }
        }
      }
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

    const filter = { employeeId };

    if (month && year) {
      filter.date = { $regex: `^${year}-${String(month).padStart(2, "0")}` };
    } else if (year) {
      filter.date = { $regex: `^${year}` };
    }

    // ── Read OfficeTiming once for violation messages ─────────────────────────
    const timing = await getOfficeTiming();
    const todayStr = new Date().toISOString().split("T")[0];

    // ── Build violations from already-stored fields on the Attendance doc ─────
    //
    // The clockIn / clockOut controllers already compute and persist:
    //   lateLogin, lateByMinutes   (set on clockIn)
    //   earlyLogout, earlyByMinutes (set on clockOut)
    //
    // So we just read those fields — no need to re-parse time strings or
    // re-apply thresholds here.  Missed clock-out is derived at query time
    // because it depends on "is the day over yet".
    //
    const computeViolations = (log) => {
      const violations = [];

      // 1. Late login — already computed and stored by clockIn controller
      if (log.lateLogin) {
        violations.push({
          type: "LATE_LOGIN",
          message: `Late clock-in at ${log.clockIn} — ${log.lateByMinutes}m past ${timing.startTime} (grace: ${timing.graceMinutes}m)`,
          lateByMinutes: log.lateByMinutes ?? null,
        });
      }

      // 2. Missed clock-out — had a clockIn, no clockOut, day is already over
      if (log.clockIn && !log.clockOut && log.date < todayStr) {
        violations.push({
          type: "MISSED_LOGOUT",
          message: "Clock-out not recorded for this day",
        });
      }

      // 3. Early logout — already computed and stored by clockOut controller
      if (log.earlyLogout) {
        violations.push({
          type: "EARLY_LOGOUT",
          message: `Early clock-out at ${log.clockOut} — ${log.earlyByMinutes}m before ${timing.endTime}`,
          earlyByMinutes: log.earlyByMinutes ?? null,
        });
      }

      return violations;
      // A day with late login + no clockOut returns [LATE_LOGIN, MISSED_LOGOUT]
      // A day with late login + early logout returns [LATE_LOGIN, EARLY_LOGOUT]
      // All three are fully independent — no skipping.
    };

    // ── Full calendar view for month/year (no pagination needed) ─────────────
    if (month || year) {
      const resolvedYear = parseInt(year || new Date().getFullYear());
      const resolvedMonth = month ? parseInt(month) : null;

      const startDate = resolvedMonth
        ? `${resolvedYear}-${String(resolvedMonth).padStart(2, "0")}-01`
        : `${resolvedYear}-01-01`;

      const endDate = resolvedMonth
        ? `${resolvedYear}-${String(resolvedMonth).padStart(2, "0")}-${String(
          new Date(resolvedYear, resolvedMonth, 0).getDate()
        ).padStart(2, "0")}`
        : `${resolvedYear}-12-31`;

      // Fetch attendance logs and holidays in parallel
      const [logs, holidayDocs] = await Promise.all([
        Attendance.find(filter).sort({ date: -1 }).lean(),
        Holiday.find({ year: resolvedYear }).lean(),
      ]);

      // Build lookup maps
      const logMap = {};
      for (const log of logs) {
        logMap[log.date] = log;
      }

      const holidayMap = {};
      for (const h of holidayDocs) {
        const key = dayjs.utc(h.date).format("YYYY-MM-DD");
        holidayMap[key] = h;
      }

      const fullCalendar = [];
      const cursor = new Date(startDate + "T00:00:00Z");
      const end = new Date(endDate + "T00:00:00Z");

      while (cursor <= end) {
        const dateStr = cursor.toISOString().split("T")[0];
        const dow = cursor.getUTCDay();

        // Skip future dates
        if (dateStr > todayStr) {
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          continue;
        }

        const isWeekend = dow === 0 || dow === 6;
        const hDoc = holidayMap[dateStr] ?? null;
        const isHoliday = !!hDoc;

        if (logMap[dateStr]) {
          const log = logMap[dateStr];

          const workMinutes = calcDurationMinutes(log.clockIn, log.clockOut);
          const totalBreakMinutes = log.breaks.reduce((acc, b) => {
            return acc + (calcDurationMinutes(b.start, b.end) || 0);
          }, 0);

          const violations = computeViolations(log);

          const attendanceStatus = log.clockOut
            ? "present"
            : log.clockIn
              ? "incomplete"
              : "absent";

          fullCalendar.push({
            _id: log._id,
            date: log.date,
            clockIn: log.clockIn ?? null,
            clockOut: log.clockOut ?? null,
            clockInLocation: log.clockInLocation ?? null,
            clockOutLocation: log.clockOutLocation ?? null,
            breaks: log.breaks.map((b) => ({
              start: b.start,
              end: b.end ?? null,
              startLocation: b.startLocation,
              endLocation: b.endLocation,
              duration: calcDurationMinutes(b.start, b.end),
            })),
            totalBreaks: log.breaks.length,
            workDurationMinutes: workMinutes,
            breakDurationMinutes: totalBreakMinutes,
            netWorkMinutes:
              workMinutes != null ? workMinutes - totalBreakMinutes : null,
            status: attendanceStatus,
            isHoliday,
            holidayName: isHoliday ? hDoc.name : null,
            holidayType: isHoliday ? hDoc.type : null,
            // Raw fields — kept for frontend direct access
            lateLogin: log.lateLogin ?? false,
            lateByMinutes: log.lateByMinutes ?? null,
            earlyLogout: log.earlyLogout ?? false,
            earlyByMinutes: log.earlyByMinutes ?? null,
            // Structured violations array
            violations,
            hasViolations: violations.length > 0,
          });

        } else if (isHoliday || isWeekend) {
          let statusLabel;
          let holidayType;

          if (isHoliday) {
            const typeLabel = {
              GOVERNMENT: "Government Holiday",
              OPTIONAL: "Optional Holiday",
              COMPANY: "Company Holiday",
            }[hDoc.type] ?? "Holiday";

            statusLabel = `${hDoc.name} · ${typeLabel}`;
            holidayType = hDoc.type;
          } else {
            statusLabel = dow === 0 ? "Sunday · Weekend" : "Saturday · Weekend";
            holidayType = "WEEKEND";
          }

          fullCalendar.push({
            _id: `holiday-${dateStr}`,
            employeeId,
            date: dateStr,
            status: "holiday",
            holidayType,
            statusLabel,
            clockIn: null,
            clockOut: null,
            breaks: [],
            totalBreaks: 0,
            workDurationMinutes: null,
            breakDurationMinutes: 0,
            netWorkMinutes: null,
            lateLogin: false,
            lateByMinutes: null,
            earlyLogout: false,
            earlyByMinutes: null,
            violations: [],
            hasViolations: false,
          });

        } else {
          fullCalendar.push({
            _id: `absent-${dateStr}`,
            employeeId,
            date: dateStr,
            status: "absent",
            statusLabel: "No attendance marked for the day",
            clockIn: null,
            clockOut: null,
            breaks: [],
            totalBreaks: 0,
            workDurationMinutes: null,
            breakDurationMinutes: 0,
            netWorkMinutes: null,
            lateLogin: false,
            lateByMinutes: null,
            earlyLogout: false,
            earlyByMinutes: null,
            violations: [],
            hasViolations: false,
          });
        }

        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      // Most recent first
      fullCalendar.sort((a, b) => (a.date > b.date ? -1 : 1));

      // Summary counts — each counter is independent so a day with
      // LATE_LOGIN + MISSED_LOGOUT increments both late AND missedLogout.
      const summary = {
        present: fullCalendar.filter((l) => l.status === "present").length,
        incomplete: fullCalendar.filter((l) => l.status === "incomplete").length,
        absent: fullCalendar.filter((l) => l.status === "absent").length,
        holidays: fullCalendar.filter((l) => l.status === "holiday").length,
        late: fullCalendar.filter((l) => l.lateLogin).length,
        earlyLogout: fullCalendar.filter((l) => l.earlyLogout).length,
        missedLogout: fullCalendar.filter((l) =>
          l.violations?.some((v) => v.type === "MISSED_LOGOUT")
        ).length,
        totalWorkMinutes: fullCalendar.reduce(
          (a, l) => a + (l.netWorkMinutes ?? 0),
          0
        ),
      };

      return res.status(200).json({
        success: true,
        employeeId,
        data: fullCalendar,
        summary,
      });
    }

    // ── Paginated fallback (no month/year filter) ─────────────────────────────
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Attendance.countDocuments(filter);
    const logs = await Attendance.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const enrichedLogs = logs.map((log) => {
      const workMinutes = calcDurationMinutes(log.clockIn, log.clockOut);
      const totalBreakMinutes = log.breaks.reduce((acc, b) => {
        return acc + (calcDurationMinutes(b.start, b.end) || 0);
      }, 0);

      const violations = computeViolations(log);

      return {
        _id: log._id,
        date: log.date,
        clockIn: log.clockIn ?? null,
        clockOut: log.clockOut ?? null,
        clockInLocation: log.clockInLocation,
        clockOutLocation: log.clockOutLocation,
        breaks: log.breaks.map((b) => ({
          start: b.start,
          end: b.end ?? null,
          startLocation: b.startLocation,
          endLocation: b.endLocation,
          duration: calcDurationMinutes(b.start, b.end),
        })),
        totalBreaks: log.breaks.length,
        workDurationMinutes: workMinutes,
        breakDurationMinutes: totalBreakMinutes,
        netWorkMinutes:
          workMinutes != null ? workMinutes - totalBreakMinutes : null,
        status: log.clockOut ? "present" : log.clockIn ? "incomplete" : "absent",
        lateLogin: log.lateLogin ?? false,
        lateByMinutes: log.lateByMinutes ?? null,
        earlyLogout: log.earlyLogout ?? false,
        earlyByMinutes: log.earlyByMinutes ?? null,
        violations,
        hasViolations: violations.length > 0,
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
      Employee.countDocuments({ isActive: true }),
    ]);

    const present = todayLogs.filter((l) => l.clockIn).length;
    const completed = todayLogs.filter((l) => l.clockIn && l.clockOut).length;
    const active = todayLogs.filter((l) => l.clockIn && !l.clockOut).length;
    const onBreak = todayLogs.filter((l) => l.breaks?.some((b) => b.start && !b.end)).length;
    const late = todayLogs.filter((l) => l.lateLogin === true).length; 

    return res.status(200).json({
      success: true,
      date: targetDate,
      summary: {
        total: totalEmployees,
        present,
        completed,
        active,
        onBreak,
        late,
        absent: totalEmployees - present,
      },
    });
  } catch (err) {
    console.error("getAttendanceSummary Error:", err);
    return res.status(500).json({ error: err.message });
  }
};
