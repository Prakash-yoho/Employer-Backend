import Announcements from "../model/Announcements.js";
import Employee from "../model/Employee.js";


// GET All Announcements
export const getAllAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcements.find().sort({ createdAt: -1 });

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
    const { id } = req.params;

    const announcement = await Announcements.findById(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    res.status(200).json({
      success: true,
      data: announcement,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching announcement",
      error: error.message,
    });
  }
};


// Helper to resolve employeeIds based on audience
const resolveEmployeeIds = async (data) => {
  if (data.audience === "all") {
    const allEmployees = await Employee.find({ isActive: true }, { _id: 1 });
    data.employeeIds = allEmployees.map((e) => e._id);
    data.department  = "";
  }

  return data;
};


// CREATE Announcement
export const createAnnouncement = async (req, res) => {
  try {
    let data = req.body;

    data = await resolveEmployeeIds(data);

    // Validation: at least one employee must be targeted
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
    let data = req.body;

    data = await resolveEmployeeIds(data);

    // Validation: at least one employee must be targeted
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

    const updated = await Announcements.findByIdAndUpdate(
      id,
      data,
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Announcement updated successfully",
      data: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error updating announcement",
      error: error.message,
    });
  }
};


// DELETE Announcement
export const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Announcements.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Announcement not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error deleting announcement",
      error: error.message,
    });
  }
};


// GET All Unique Departments from Employees
export const getDepartments = async (req, res) => {
  try {
    const departments = await Employee.distinct("department", {
      isActive: true,
      department: { $exists: true, $ne: null, $ne: "" },
    });

    res.status(200).json({
      success: true,
      count: departments.length,
      data: departments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching departments",
      error: error.message,
    });
  }
};


// GET Employees by Department
export const getEmployeesByDepartment = async (req, res) => {
  try {
    const { department } = req.params;

    if (!department) {
      return res.status(400).json({
        success: false,
        message: "Department name is required",
      });
    }

    const employees = await Employee.find(
      {
        department: department,
        isActive: true,
      },
      {
        _id: 1,
        firstName: 1,
        lastName: 1,
        employeeId: 1,
        designation: 1,
        officialEmail: 1,
      }
    ).sort({ firstName: 1 });

    res.status(200).json({
      success: true,
      count: employees.length,
      department: department,
      data: employees,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching employees by department",
      error: error.message,
    });
  }
};

// GET All Employees (for "Specific Employees" audience)
export const getAllEmployeesForAnnouncement = async (req, res) => {
  try {
    const employees = await Employee.find(
      { isActive: true },
      {
        _id: 1,
        firstName: 1,
        lastName: 1,
        employeeId: 1,
        designation: 1,
        department: 1,
        officialEmail: 1,
      }
    ).sort({ firstName: 1 });

    res.status(200).json({
      success: true,
      count: employees.length,
      data: employees,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching employees",
      error: error.message,
    });
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

    // Fetch the employee to get their department
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

    const announcements = await Announcements.find({
      status: "active",

      // Not expired — either no expiryDate or expiryDate is in the future
      $and: [
        {
          $or: [
            { expiryDate: { $exists: false } },
            { expiryDate: null },
            { expiryDate: { $gte: now } },
          ],
        },

        // Audience targeting:
        // "all"        → everyone
        // "department" → employee's department matches
        // "employee"   → employee's _id is in employeeIds array
        {
          $or: [
            { audience: "all" },
            { audience: "department", department: employee.department },
            { audience: "employee",   employeeIds: employeeId },
          ],
        },
      ],
    }).sort({ isPinned: -1, createdAt: -1 });

    res.status(200).json({
      success: true,
      count: announcements.length,
      data: announcements,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching announcements for employee",
      error: error.message,
    });
  }
};