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
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
// import { getNow } from "../utils/trueTime.js";
import { getNow, correctedDate } from "../utils/trueTime.js";
import {
  getApprovedPermissions, getApprovedPermissionMap, classifyPermissions,
  evalLogin, evalLogout, buildPermissionView, hhmm, clockMins,
} from "../utils/permissionAttendance.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const IST = "Asia/Kolkata";

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
    const startTimeMins = hhmmToMinutes(timing.startTime);
    const cutoffMins = startTimeMins + timing.graceMinutes;
    const clockInMin = timeStrToMinutes(time);

    // Approved permissions move the effective shift start (e.g. 09:30-10:30
    // permission → no late warning until 10:30 + grace).
    const perms = await getApprovedPermissions(employeeId, date);
    const { lateLogin, lateByMinutes } = evalLogin({
      clockInMins: clockInMin, startMins: startTimeMins,
      endMins: hhmmToMinutes(timing.endTime), graceMinutes: timing.graceMinutes, perms,
    });

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
    if ((attendance.permissionEntries ?? []).some((x) => !x.end))
      return res.status(409).json({ error: "You are out on permission — mark yourself back first" });

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

    const startImage = await uploadImage(image, "break-start");
    const startLocation = parseLocation(location);

    attendance.breaks.push({
      start: time,
      end: null,
      startImage,
      startLocation,
      breakType,
      allowedMinutes: slot?.allowedMinutes ?? null,
      overByMinutes: null,
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

    const endImage = await uploadImage(image, "break-end");
    const endLocation = parseLocation(location);

    // ── Compute duration & violation ─────────────────────────────────────────
    const durationMins = calcDurationMinutes(lastBreak.start, time);
    const allowed = lastBreak.allowedMinutes;
    const overByMinutes =
      allowed != null && durationMins != null && durationMins > allowed
        ? Math.round(durationMins - allowed)
        : null;

    lastBreak.end = time;
    lastBreak.endImage = endImage;
    lastBreak.endLocation = endLocation;
    lastBreak.overByMinutes = overByMinutes;
    lastBreak.isBreakViolation = overByMinutes != null && overByMinutes > 0;

    attendance.markModified("breaks");
    await attendance.save();

    return res.json({
      ...attendance.toObject(),
      _breakFeedback: {
        breakType: lastBreak.breakType,
        durationMins,
        allowedMinutes: allowed,
        overByMinutes,
        isViolation: lastBreak.isBreakViolation,
      },
    });
  } catch (err) {
    console.error("End Break Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ─── Mid-shift permission (Out / In) ─────────────────────────────────────────
function closePermissionEntry(entry, time, graceMinutes) {
  entry.end = time;
  const endMin = timeStrToMinutes(time);
  const approvedEnd = hhmmToMinutes(entry.toTime);
  const over = endMin != null && endMin > approvedEnd ? Math.round(endMin - approvedEnd) : 0;
  entry.overByMinutes = over > 0 ? over : null;
  entry.isViolation = over > (graceMinutes ?? 0);
}

// GET /api/attendance/permission/today  (employee) – today's approved permissions + state
export const getTodayPermissions = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { date, time } = getNow();
    const timing = await getOfficeTiming();
    const [perms, att] = await Promise.all([
      getApprovedPermissions(employeeId, date),
      Attendance.findOne({ employeeId, date }).lean(),
    ]);
    const view = buildPermissionView(
      att ?? { date },
      perms,
      {
        startMins: hhmmToMinutes(timing.startTime), endMins: hhmmToMinutes(timing.endTime),
        graceMinutes: timing.graceMinutes, permGrace: timing.permissionGraceMinutes ?? 5,
        nowDate: date, nowMins: timeStrToMinutes(time),
      },
    );
    return res.json({
      success: true,
      data: { permissions: view, permissionGraceMinutes: timing.permissionGraceMinutes ?? 5 },
    });
  } catch (err) {
    console.error("getTodayPermissions error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/attendance/permission/start  (employee) – stepping out for an approved permission
export const startPermission = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { date, time } = getNow();
    if (!req.body?.image) return res.status(400).json({ error: "Face photo is required to step out" });
    const attendance = await Attendance.findOne({ employeeId, date });
    if (!attendance) return res.status(404).json({ error: "Clock in first" });
    if (attendance.clockOut) return res.status(409).json({ error: "You have already clocked out" });
    const lastBreak = attendance.breaks.at(-1);
    if (lastBreak && !lastBreak.end) return res.status(409).json({ error: "End your break first" });
    if ((attendance.permissionEntries ?? []).some((x) => !x.end))
      return res.status(409).json({ error: "Permission already in progress" });

    const timing = await getOfficeTiming();
    const nowMins = timeStrToMinutes(time);
    const perms = await getApprovedPermissions(employeeId, date);
    const { list } = classifyPermissions(perms, hhmmToMinutes(timing.startTime), hhmmToMinutes(timing.endTime));
    const recorded = new Set((attendance.permissionEntries ?? []).map((x) => x.requestId));

    const wanted = req.body?.requestId;
    const match = list.find(({ p, pf, pt, kind, ids }) =>
      kind === "MID" && !ids.some((i) => recorded.has(i)) &&
      (!wanted || p.requestId === wanted) &&
      nowMins >= pf && nowMins < pt,
    );
    if (!match) {
      return res.status(400).json({
        error: "No approved permission is active right now. You can step out only during your approved permission time.",
      });
    }
    // Face photo + location are captured on the client (same as breaks)
    const { image, location } = req.body ?? {};
    const startImage = await uploadImage(image, "permission-start");
    attendance.permissionEntries.push({
      requestId: match.p.requestId, fromTime: match.p.fromTime, toTime: match.p.toTime,
      allowedMinutes: match.pt - match.pf, start: time,
      startImage, startLocation: parseLocation(location),
    });
    await attendance.save();
    return res.json({ success: true, message: "Permission started", data: attendance.toObject() });
  } catch (err) {
    console.error("startPermission error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// POST /api/attendance/permission/end  (employee) – back from permission
export const endPermission = async (req, res) => {
  try {
    const employeeId = req.user.employeeId;
    const { date, time } = getNow();
    if (!req.body?.image) return res.status(400).json({ error: "Face photo is required to mark yourself back" });
    const attendance = await Attendance.findOne({ employeeId, date });
    if (!attendance) return res.status(404).json({ error: "No clock-in found for today" });
    const entry = (attendance.permissionEntries ?? []).find((x) => !x.end);
    if (!entry) return res.status(404).json({ error: "No permission in progress" });

    const timing = await getOfficeTiming();
    // Back-to-back approved permissions count as one → measure against the chain end
    const { list: chains } = classifyPermissions(
      await getApprovedPermissions(employeeId, date),
      hhmmToMinutes(timing.startTime), hhmmToMinutes(timing.endTime),
    );
    const chain = chains.find((c) => c.kind === "MID" && c.ids.includes(entry.requestId));
    if (chain) {
      entry.toTime = chain.p.toTime;
      entry.allowedMinutes = chain.pt - chain.pf;
    }
    closePermissionEntry(entry, time, timing.permissionGraceMinutes ?? 5);
    entry.endImage = await uploadImage(req.body?.image, "permission-end");
    entry.endLocation = parseLocation(req.body?.location);
    attendance.markModified("permissionEntries");
    await attendance.save();
    return res.json({
      success: true,
      message: entry.isViolation ? `Back ${entry.overByMinutes} min after your permission ended` : "Welcome back",
      _permissionFeedback: {
        requestId: entry.requestId,
        overByMinutes: entry.overByMinutes ?? 0,
        isViolation: entry.isViolation,
        allowedMinutes: entry.allowedMinutes,
      },
      data: attendance.toObject(),
    });
  } catch (err) {
    console.error("endPermission error:", err);
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

    // Out on a permission → must mark "I'm back" before clocking out
    if ((attendance.permissionEntries ?? []).some((x) => !x.end)) {
      return res.status(409).json({
        error: "You are out on permission. Mark yourself back (I'm back) before clocking out.",
      });
    }

    // Approved permissions move the effective shift end (e.g. 17:30-18:30
    // permission → clock out at 17:30 with no early-logout warning).
    const perms = await getApprovedPermissions(employeeId, date);
    const { earlyLogout, earlyByMinutes } = evalLogout({
      clockOutMins, startMins: hhmmToMinutes(timing.startTime), endMins: endTimeMins, perms,
    });

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
      const today = getNow().date;

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
    // Attach the office timing snapshot so the client can show the correct
    // late-login cutoff (startTime + grace) after a page refresh. Without this
    // the frontend has no startTime and renders "NaN:NaN".
    const timing = await getOfficeTiming();
    const officeTimingPayload = {
      startTime: timing.startTime,
      endTime: timing.endTime,
      graceMinutes: timing.graceMinutes,
    };

    const enriched = logs.map((l) => {
      const obj = l.toObject ? l.toObject() : { ...l };
      obj._officeTiming = {
        ...officeTimingPayload,
        lateLogin: obj.lateLogin ?? false,
        lateByMinutes: obj.lateByMinutes ?? null,
        earlyLogout: obj.earlyLogout ?? false,
        earlyByMinutes: obj.earlyByMinutes ?? null,
      };
      return obj;
    });

    res.json(enriched);

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

    const signedUrl = await getSignedUrl(s3, command, {
      expiresIn: 60 * 5,
      signingDate: correctedDate(),   // ← true time, overrides presigner default
    });
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
        return await getSignedUrl(s3, cmd, { expiresIn: 300, signingDate: correctedDate() });
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

    const permissionsSigned = await Promise.all(
      (log.permissionEntries ?? []).map(async (x) => ({
        requestId: x.requestId, start: x.start, end: x.end,
        startImage: await sign(x.startImage),
        endImage: await sign(x.endImage),
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
      permissionEntries: permissionsSigned,
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
    return await getSignedUrl(s3, cmd, {
      expiresIn: 300,
      signingDate: correctedDate(),
    });
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

// ─── Break status per configured break slot (for the HR attendance view) ───────
// status: TAKEN (within allowed time) | VIOLATED (over allowed time) |
//         NOT_TAKEN (day finished and the break was never taken) |
//         PENDING   (today, still working — the break may still come)
async function getBreakSlots() {
  const doc = await BreakPolicy.findOne({ key: "default" }).lean();
  const slots = doc?.slots?.length
    ? doc.slots
    : [
        { type: "MORNING", label: "Morning Break", allowedMinutes: 15, isActive: true },
        { type: "LUNCH",   label: "Lunch Break",   allowedMinutes: 60, isActive: true },
        { type: "EVENING", label: "Evening Break", allowedMinutes: 15, isActive: true },
      ];
  return slots.filter((s) => s.isActive !== false);
}

const buildBreakStatus = (log, slots) => {
  if (!log?.clockIn) return null; // absent / holiday — nothing to show
  const pendingDay = log.date === getNow().date && !log.clockOut;
  return slots.map((s) => {
    const taken = (log.breaks ?? []).filter((b) => b.breakType === s.type);
    if (taken.length === 0) {
      return {
        type: s.type, label: s.label || s.type, allowedMinutes: s.allowedMinutes,
        status: pendingDay ? "PENDING" : "NOT_TAKEN",
        takenMinutes: 0, overByMinutes: 0,
      };
    }
    const violated = taken.some((b) => b.isBreakViolation);
    const takenMinutes = taken.reduce((a, b) => a + (calcDurationMinutes(b.start, b.end) || 0), 0);
    const overByMinutes = taken.reduce((a, b) => a + (b.overByMinutes || 0), 0);
    return {
      type: s.type, label: s.label || s.type, allowedMinutes: s.allowedMinutes,
      status: violated ? "VIOLATED" : "TAKEN", takenMinutes, overByMinutes,
    };
  });
};


// Context for permission views (office hours + "now" in IST)
const makePermCtx = (timing) => {
  const { date, time } = getNow();
  return {
    startMins: hhmmToMinutes(timing.startTime),
    endMins: hhmmToMinutes(timing.endTime),
    graceMinutes: timing.graceMinutes ?? 0,
    permGrace: timing.permissionGraceMinutes ?? 5,
    nowDate: date,
    nowMins: timeStrToMinutes(time),
  };
};

// ─── Shared per-employee calendar builder ─────────────────────────────────────
// Called for both ?month/year and the new ?startDate/endDate (salary cycle) mode
const buildEmployeeCalendarRange = async ({
  employeeId, startDate, endDate, timing, todayStr, computeViolations,
}) => {
  const capEnd = endDate > todayStr ? todayStr : endDate;
  const breakSlots = await getBreakSlots();

  const years = [
    ...new Set([
      parseInt(startDate.split("-")[0]),
      parseInt(capEnd.split("-")[0]),
    ]),
  ];

  const [logs, holidayDocs] = await Promise.all([
    Attendance.find({ employeeId, date: { $gte: startDate, $lte: capEnd } })
      .sort({ date: -1 }).lean(),
    Holiday.find({ year: { $in: years } }).lean(),
  ]);

  const logMap = Object.fromEntries(logs.map(l => [l.date, l]));
  const holidayMap = {};
  for (const h of holidayDocs)
    holidayMap[dayjs.utc(h.date).format("YYYY-MM-DD")] = h;
  const permCtx = makePermCtx(timing);
  const permMap = await getApprovedPermissionMap([employeeId], startDate, capEnd);

  const fullCalendar = [];
  const cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(capEnd + "T00:00:00Z");

  while (cursor <= end) {
    const dateStr = cursor.toISOString().split("T")[0];
    const dow = cursor.getUTCDay();

    if (dateStr > todayStr) { cursor.setUTCDate(cursor.getUTCDate() + 1); continue; }

    const isWeekend = dow === 0 || dow === 6;
    const hDoc = holidayMap[dateStr] ?? null;
    const isHoliday = !!hDoc;

    if (logMap[dateStr]) {
      const log = logMap[dateStr];
      const workMinutes = calcDurationMinutes(log.clockIn, log.clockOut);
      const breakMinutes = log.breaks.reduce(
        (acc, b) => acc + (calcDurationMinutes(b.start, b.end) || 0), 0,
      );
      const violations = computeViolations(log);

      fullCalendar.push({
        _id: log._id, date: log.date,
        clockIn: log.clockIn ?? null, clockOut: log.clockOut ?? null,
        clockInLocation: log.clockInLocation ?? null,
        clockOutLocation: log.clockOutLocation ?? null,
        breaks: log.breaks.map(b => ({
          start: b.start, end: b.end ?? null,
          startLocation: b.startLocation, endLocation: b.endLocation,
          duration: calcDurationMinutes(b.start, b.end),
        })),
        totalBreaks: log.breaks.length,
        breakStatus: buildBreakStatus(log, breakSlots),
        permissions: buildPermissionView(log, permMap.get(`${employeeId}|${dateStr}`), permCtx),
        workDurationMinutes: workMinutes,
        breakDurationMinutes: breakMinutes,
        netWorkMinutes: workMinutes != null ? workMinutes - breakMinutes : null,
        status: log.clockOut ? "present" : log.clockIn ? "incomplete" : "absent",
        isHoliday, holidayName: hDoc?.name ?? null, holidayType: hDoc?.type ?? null,
        lateLogin: log.lateLogin ?? false, lateByMinutes: log.lateByMinutes ?? null,
        earlyLogout: log.earlyLogout ?? false, earlyByMinutes: log.earlyByMinutes ?? null,
        violations, hasViolations: violations.length > 0,
      });

    } else if (isHoliday || isWeekend) {
      let statusLabel, holidayType;
      if (isHoliday) {
        const lbl = { GOVERNMENT: "Government Holiday", OPTIONAL: "Optional Holiday", COMPANY: "Company Holiday" }[hDoc.type] ?? "Holiday";
        statusLabel = `${hDoc.name} · ${lbl}`; holidayType = hDoc.type;
      } else {
        statusLabel = dow === 0 ? "Sunday · Weekend" : "Saturday · Weekend";
        holidayType = "WEEKEND";
      }
      fullCalendar.push({
        _id: `holiday-${dateStr}`, employeeId, date: dateStr,
        status: "holiday", holidayType, statusLabel,
        clockIn: null, clockOut: null, breaks: [], totalBreaks: 0,
        workDurationMinutes: null, breakDurationMinutes: 0, netWorkMinutes: null,
        lateLogin: false, lateByMinutes: null, earlyLogout: false, earlyByMinutes: null,
        violations: [], hasViolations: false,
      });

    } else {
      fullCalendar.push({
        _id: `absent-${dateStr}`, employeeId, date: dateStr,
        status: "absent", statusLabel: "No attendance marked for the day",
        clockIn: null, clockOut: null, breaks: [], totalBreaks: 0,
        workDurationMinutes: null, breakDurationMinutes: 0, netWorkMinutes: null,
        lateLogin: false, lateByMinutes: null, earlyLogout: false, earlyByMinutes: null,
        violations: [], hasViolations: false,
      });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  fullCalendar.sort((a, b) => (a.date > b.date ? -1 : 1));

  const summary = {
    present: fullCalendar.filter(l => l.status === "present").length,
    incomplete: fullCalendar.filter(l => l.status === "incomplete").length,
    absent: fullCalendar.filter(l => l.status === "absent").length,
    holidays: fullCalendar.filter(l => l.status === "holiday").length,
    late: fullCalendar.filter(l => l.lateLogin).length,
    earlyLogout: fullCalendar.filter(l => l.earlyLogout).length,
    missedLogout: fullCalendar.filter(l =>
      l.violations?.some(v => v.type === "MISSED_LOGOUT")
    ).length,
    totalWorkMinutes: fullCalendar.reduce((a, l) => a + (l.netWorkMinutes ?? 0), 0),
  };

  return { fullCalendar, summary };
};


// ─── GET /api/admin/attendance ────────────────────────────────────────────────
// Returns paginated list of all employees with their latest attendance summary
export const getAllEmployeesAttendance = async (req, res) => {
  try {
    const breakSlots = await getBreakSlots();
    const { page = 1, limit = 10, date, search, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const targetDate = date || getNow().date;

    // ── Fetch OfficeTiming dynamically ─────────────────────────────────
    const timing = await OfficeTiming.findOne({ key: "default" });
    const [startH, startM] = (timing?.startTime ?? "09:00").split(":").map(Number);
    const grace = timing?.graceMinutes ?? 0;
    const cutoffMinutes = startH * 60 + startM + grace;

    // Build employee search filter
    const employeeMatch = {};
    if (search && String(search).trim()) {
      // Search runs on the whole employee collection (not just the current page).
      const rx = String(search).trim().split(/\s+/)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      employeeMatch.$or = [
        { firstName: { $regex: rx, $options: "i" } },
        { lastName: { $regex: rx, $options: "i" } },
        { officialEmail: { $regex: rx, $options: "i" } },
        { employeeId: { $regex: rx, $options: "i" } },
        {
          $expr: {
            $regexMatch: {
              input: { $concat: [{ $ifNull: ["$firstName", ""] }, " ", { $ifNull: ["$lastName", ""] }] },
              regex: rx,
              options: "i",
            },
          },
        },
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
          permissionEntries: { $ifNull: ["$attendanceRecord.permissionEntries", []] },
          hasRecord: { $cond: [{ $ifNull: ["$attendanceRecord", false] }, true, false] },
        },
      },
      {
        $addFields: {
          // Uses the flag stored at clock-in, which already accounts for approved
          // permissions (a login inside a start-of-shift permission is not Late).
          attendanceStatus: {
            $cond: [
              { $ifNull: ["$clockIn", false] },
              { $cond: [{ $eq: ["$attendanceRecord.lateLogin", true] }, "Late", "Present"] },
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

    const listCtx = makePermCtx(timing ?? { startTime: "09:30", endTime: "19:00" });
    const listPermMap = await getApprovedPermissionMap(records.map((r) => r.employeeId), targetDate, targetDate);

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
      totalBreaks: emp.breaks?.length ?? 0,
      hasActiveBreak: (emp.breaks ?? []).some((b) => b.start && !b.end),
      breakStatus: buildBreakStatus(
        { date: targetDate, clockIn: emp.clockIn, clockOut: emp.clockOut, breaks: emp.breaks },
        breakSlots,
      ),
      permissions: buildPermissionView(
        { date: targetDate, clockIn: emp.clockIn, clockOut: emp.clockOut, permissionEntries: emp.permissionEntries },
        listPermMap.get(`${emp.employeeId}|${targetDate}`),
        listCtx,
      ),
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
    const breakSlots = await getBreakSlots();
    const { employeeId } = req.params;
    const { page = 1, limit = 20, month, year, startDate, endDate } = req.query;

    const filter = { employeeId };

    if (month && year) {
      filter.date = { $regex: `^${year}-${String(month).padStart(2, "0")}` };
    } else if (year) {
      filter.date = { $regex: `^${year}` };
    }

    // ── Read OfficeTiming once for violation messages ─────────────────────────
    const timing = await getOfficeTiming();
    const todayStr = getNow().date;

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

      // 2b. Late return from a mid-shift permission
      for (const pe of log.permissionEntries ?? []) {
        if (pe.isViolation) {
          violations.push({
            type: "PERMISSION_OVERRUN",
            message: `Returned ${pe.overByMinutes}m after permission ended (${pe.fromTime}–${pe.toTime}, grace: ${timing.permissionGraceMinutes ?? 5}m)`,
            overByMinutes: pe.overByMinutes ?? null,
          });
        }
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
      const permCtx = makePermCtx(timing);
      const permMap = await getApprovedPermissionMap([employeeId], startDate, endDate);

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
            breakStatus: buildBreakStatus(log, breakSlots),
            permissions: buildPermissionView(log, permMap.get(`${employeeId}|${log.date}`), permCtx),
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


    // ─── Salary-cycle / custom date-range view ────────────────────────────────────
    // Triggered by ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
    if (startDate && endDate) {
      const { fullCalendar, summary } = await buildEmployeeCalendarRange({
        employeeId, startDate, endDate, timing, todayStr, computeViolations,
      });

      return res.status(200).json({
        success: true,
        employeeId,
        cycleRange: { startDate, endDate },  // echo back so frontend can display it
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

    const pageCtx = makePermCtx(timing);
    const pageDates = logs.map((l) => l.date).sort();
    const pagePermMap = pageDates.length
      ? await getApprovedPermissionMap([employeeId], pageDates[0], pageDates[pageDates.length - 1])
      : new Map();

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
        breakStatus: buildBreakStatus(log, breakSlots),
        permissions: buildPermissionView(log, pagePermMap.get(`${employeeId}|${log.date}`), pageCtx),
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
    const permissionEntriesSigned = await Promise.all(
      (log.permissionEntries ?? []).map(async (x) => ({
        requestId: x.requestId, fromTime: x.fromTime, toTime: x.toTime,
        start: x.start, end: x.end ?? null,
        overByMinutes: x.overByMinutes ?? null, isViolation: !!x.isViolation,
        startLocation: x.startLocation, endLocation: x.endLocation,
        startImage: await signUrl(x.startImage),
        endImage: await signUrl(x.endImage),
        duration: calcDurationMinutes(x.start, x.end),
      }))
    );
    const detailPerms = await getApprovedPermissions(log.employeeId, log.date);
    const permissions = buildPermissionView(log.toObject(), detailPerms, makePermCtx(await getOfficeTiming()));

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
        permissions,
        permissionEntries: permissionEntriesSigned,
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
    const targetDate = date || getNow().date;

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