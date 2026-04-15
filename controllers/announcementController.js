import Announcements from "../model/Announcements.js";
import Employee from "../model/Employee.js";
import { uploadToS3, deleteFromS3, getPresignedUrl, getPresignedDownloadUrl } from "../utils/saveAnnouncementAttachmentsInS3.js";

// ── Helper ───
const resolveEmployeeIds = async (data) => {
  if (data.audience === "all") {
    const allEmployees = await Employee.find({ isActive: true }, { _id: 1 });
    data.employeeIds = allEmployees.map((e) => e._id);
    data.department = "";
  }
  return data;
};

// ── Parse JSON fields sent as FormData strings ──────
const parseFormData = (body) => {
  const fields = ["employeeIds", "attachments"];
  fields.forEach((f) => {
    if (typeof body[f] === "string") {
      try { body[f] = JSON.parse(body[f]); } catch { body[f] = []; }
    }
  });
  return body;
};


// GET All Announcements
export const getAllAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcements.find()
      .populate("createdBy", "firstName lastName email role")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: announcements.length,
      data: announcements,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching announcements",
      error: error.message,
    });
  }
};

// GET Single Announcement
export const getAnnouncementById = async (req, res) => {
  try {
    const announcement = await Announcements.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found" });
    res.status(200).json({ success: true, data: announcement });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching announcement", error: error.message });
  }
};


// CREATE Announcement
export const createAnnouncement = async (req, res) => {
  try {
    let data = parseFormData({ ...req.body });
    if (req.user?._id) {
      data.createdBy = req.user._id;
    } else if (data.createdBy) {
      // already set from frontend
    }

    const uploadedAttachments = req.files?.length
      ? await Promise.all(req.files.map((f) => uploadToS3(f)))
      : [];

    data.attachments = uploadedAttachments;

    data = await resolveEmployeeIds(data);

    if (!data.employeeIds || data.employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          data.audience === "all"
            ? "No active employees found to send the announcement to."
            : data.audience === "department"
              ? `No employees selected in the "${data.department}" department.`
              : "Please select at least one employee before creating the announcement.",
      });
    }

    const announcement = new Announcements(data);
    await announcement.save();
    await announcement.populate("createdBy", "firstName lastName email role");

    res.status(201).json({
      success: true,
      message: "Announcement created successfully",
      data: announcement,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating announcement",
      error: error.message,
    });
  }
};


// UPDATE Announcement
export const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    let data = parseFormData({ ...req.body });

    // Upload any new files to S3
    const newAttachments = req.files?.length
      ? await Promise.all(req.files.map((f) => uploadToS3(f)))
      : [];

    let existingAttachments = [];
    if (data.existingAttachments) {
      try {
        existingAttachments =
          typeof data.existingAttachments === "string"
            ? JSON.parse(data.existingAttachments)
            : data.existingAttachments;
      } catch { existingAttachments = []; }
    }

    data.attachments = [...existingAttachments, ...newAttachments];
    delete data.existingAttachments;

    // Resolve employeeIds
    data = await resolveEmployeeIds(data);

    // Validation
    if (!data.employeeIds || data.employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          data.audience === "all"
            ? "No active employees found to send the announcement to."
            : data.audience === "department"
              ? `No employees selected in the "${data.department}" department.`
              : "Please select at least one employee before updating the announcement.",
      });
    }

    // Delete removed attachments from S3
    const existing = await Announcements.findById(id, { attachments: 1 });
    if (existing) {
      const newKeys = new Set(data.attachments.map((a) => a.key).filter(Boolean));
      const removedKeys = existing.attachments
        .filter((a) => a.key && !newKeys.has(a.key))
        .map((a) => a.key);

      if (removedKeys.length) {
        await Promise.allSettled(removedKeys.map((key) => deleteFromS3(key)));
      }
    }

    const updated = await Announcements.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });

    if (!updated) return res.status(404).json({ success: false, message: "Announcement not found" });

    res.status(200).json({ success: true, message: "Announcement updated successfully", data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error updating announcement", error: error.message });
  }
};


// DELETE Announcement — also removes S3 attachments
export const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    const announcement = await Announcements.findById(id);
    if (!announcement) return res.status(404).json({ success: false, message: "Announcement not found" });

    // Delete all S3 attachments
    if (announcement.attachments?.length) {
      await Promise.allSettled(
        announcement.attachments
          .filter((a) => a.key)
          .map((a) => deleteFromS3(a.key))
      );
    }

    await Announcements.findByIdAndDelete(id);

    res.status(200).json({ success: true, message: "Announcement deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error deleting announcement", error: error.message });
  }
};


// GET All Unique Departments from Employees
export const getDepartments = async (req, res) => {
  try {
    const departments = await Employee.distinct("department", {
      isActive: true,
      department: { $exists: true, $ne: null, $ne: "" },
    });
    res.status(200).json({ success: true, count: departments.length, data: departments });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching departments", error: error.message });
  }
};


// GET Employees by Department
export const getEmployeesByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    if (!department) return res.status(400).json({ success: false, message: "Department name is required" });

    const employees = await Employee.find(
      { department, isActive: true },
      { _id: 1, firstName: 1, lastName: 1, employeeId: 1, designation: 1, officialEmail: 1 }
    ).sort({ firstName: 1 });

    res.status(200).json({ success: true, count: employees.length, department, data: employees });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching employees by department", error: error.message });
  }
};


// GET All Employees (for "Specific Employees" audience)
export const getAllEmployeesForAnnouncement = async (req, res) => {
  try {
    const employees = await Employee.find(
      { isActive: true },
      { _id: 1, firstName: 1, lastName: 1, employeeId: 1, designation: 1, department: 1, officialEmail: 1 }
    ).sort({ firstName: 1 });

    res.status(200).json({ success: true, count: employees.length, data: employees });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error fetching employees", error: error.message });
  }
};


// GET Announcements for a specific employee
export const getAnnouncementsForEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const employee = await Employee.findById(employeeId, {
      department: 1,
      isActive: 1,
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    if (!employee.isActive) {
      return res.status(403).json({
        success: false,
        message: "Employee account is inactive",
      });
    }

    const now = new Date();

    const announcements = await Announcements.find(
      {
        status: "active",
        $and: [
          {
            $or: [
              { expiryDate: { $exists: false } },
              { expiryDate: null },
              { expiryDate: { $gte: now } },
            ],
          },
          { employeeIds: employeeId },
        ],
      },
      {
        employeeIds: 0,
      }
    ).sort({ isPinned: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: announcements.length,
      data: announcements,
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error fetching announcements for employee",
      error: error.message,
    });
  }
};


// GET Presigned URL for preview
export const getAttachmentPreviewUrl = async (req, res) => {
  try {
    const { key } = req.query;

    if (!key) {
      return res.status(400).json({ success: false, message: "Key is required" });
    }

    const url = await getPresignedUrl(decodeURIComponent(key));

    res.status(200).json({ success: true, url });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error generating preview URL",
      error: error.message,
    });
  }
};

// GET Presigned URL for download
export const getAttachmentDownloadUrl = async (req, res) => {
  try {
    const { key, filename } = req.query;

    if (!key) {
      return res.status(400).json({ success: false, message: "Key is required" });
    }

    const url = await getPresignedDownloadUrl(
      decodeURIComponent(key),
      filename ? decodeURIComponent(filename) : "download"
    );

    res.status(200).json({ success: true, url });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error generating download URL",
      error: error.message,
    });
  }
};



// GET Announcement count for employee sidebar badge
export const getAnnouncementCountForEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    if (!employeeId) {
      return res.status(400).json({ success: false, message: "Employee ID is required" });
    }

    const employee = await Employee.findById(employeeId, { isActive: 1 });
    if (!employee || !employee.isActive) {
      return res.status(404).json({ success: false, message: "Employee not found or inactive" });
    }

    const now     = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

    const baseQuery = {
      status: "active",
      employeeIds: employeeId,
      $or: [
        { expiryDate: { $exists: false } },
        { expiryDate: null },
        { expiryDate: { $gte: now } },
      ],
    };

    // Total active announcements for this employee
    const total = await Announcements.countDocuments(baseQuery);

    // New = created within last 2 days
    const newCount = await Announcements.countDocuments({
      ...baseQuery,
      createdAt: { $gte: twoDaysAgo },
    });

    // Pinned
    const pinnedCount = await Announcements.countDocuments({
      ...baseQuery,
      isPinned: true,
    });

    res.status(200).json({
      success:     true,
      total,
      newCount,
      pinnedCount,
      badgeCount:  newCount, // what the sidebar badge shows
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching announcement count",
      error: error.message,
    });
  }
};