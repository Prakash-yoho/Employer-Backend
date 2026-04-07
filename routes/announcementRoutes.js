import express from "express";
import { 
  createAnnouncement, 
  updateAnnouncement, 
  deleteAnnouncement,
  getAllAnnouncements,
  getAnnouncementById,
  getEmployeesByDepartment,
  getDepartments,
  getAllEmployeesForAnnouncement,
  getAnnouncementsForEmployee
} from "../controllers/announcementController.js";

const router = express.Router();

// CREATE
router.post('/createAnnouncement', createAnnouncement);

// READ (GET)
router.get('/getAnnouncements', getAllAnnouncements);        // Get all
router.get('/getAnnouncement/:id', getAnnouncementById);     // Get one by ID

// UPDATE
router.put('/updateAnnouncement/:id', updateAnnouncement);

// DELETE
router.delete('/deleteAnnouncement/:id', deleteAnnouncement);


router.get("/departments", getDepartments);
router.get("/departments/:department/employees", getEmployeesByDepartment);
router.get("/employees", getAllEmployeesForAnnouncement);



router.get("/employee/:employeeId", getAnnouncementsForEmployee);
export default router;