import Employee from '../model/Employee.js';
import Document from '../model/Document.js';
import Asset from '../model/Asset.js';
import Ticket from '../model/Ticket.js';
import Notification from '../model/Notification.js';

// Dashboard for Employee
export const getEmployeeDashboard = async (req, res) => {
    try {
        const user = req.user;
        const employeeId = user._id;

        // console.log('Fetching dashboard for employee:', employeeId);

        // Get employee details
        const employee = await Employee.findById(employeeId)
            .select('firstName lastName employeeId status isUpdated department designation')
            .lean();

        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // console.log(employee)

        // Get all data in parallel for better performance
        const [
            documentData,
            assignedAssets,
            openTickets,
            recentNotifications,
            totalUnreadNotifications
        ] = await Promise.all([
            // 1. Get document data
            Document.findOne({ employee: employeeId })
                .select('overallStatus totalDocuments submittedDocuments verifiedDocuments pendingDocuments')
                .lean(),

            // 2. Get assigned assets count
            Asset.countDocuments({
                assignedTo: employeeId,
                status: 'ASSIGNED'
            }),

            // 3. Get open tickets count
            Ticket.countDocuments({
                raisedBy: employeeId,
                status: { $in: ['OPEN', 'IN_PROGRESS'] }
            }),

            // 4. Get recent notifications (last 3)
            Notification.find({
                $or: [
                    { recipientType: 'EMPLOYEE', recipientId: employeeId },
                    { recipientType: 'ALL' }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(3)
                .select('title description type status updatedAt')
                .lean(),

            // 5. Get total unread notifications count
            Notification.countDocuments({
                $or: [
                    {
                        recipientType: 'EMPLOYEE',
                        recipientId: employeeId,
                        status: 'unread'
                    },
                    {
                        recipientType: 'ALL',
                        status: 'unread'
                    }
                ]
            })
        ]);

        // Calculate onboarding progress
        const onboardingProgress = calculateOnboardingProgress(employee, documentData);

        // Prepare stats cards
        const statsCards = {
            pendingDocuments: documentData?.pendingDocuments || 0,
            assignedAssets: assignedAssets || 0,
            openTickets: openTickets || 0,
            notifications: totalUnreadNotifications || 0
        };

        // console.log(recentNotifications,"Recent")

        // Format recent notifications
        const formattedNotifications = recentNotifications.map(notification => ({
            id: notification._id,
            title: notification.title,
            description: notification.description,
            type: notification.type,
            status: notification.status,
            time: formatTimeAgo(notification.updatedAt),
            isNew: isNotificationNew(notification.updatedAt)
        }));

        // Prepare response
        const dashboardData = {
            employee: {
                id: employee._id,
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`,
                department: employee.department,
                designation: employee.designation,
                profileStatus: employee.status
            },
            onboarding: onboardingProgress,
            stats: statsCards,
            recentNotifications: formattedNotifications
        };

        res.json({
            success: true,
            message: 'Dashboard data fetched successfully',
            data: dashboardData
        });

    } catch (error) {
        console.error('Error fetching dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard data',
            error: error.message
        });
    }
};

// Dashboard for Employer (HR/Admin/IT)
export const getEmployerDashboard = async (req, res) => {
    try {
        const user = req.user;
        const userId = user._id;
        const userRole = user.role;

        // console.log('Fetching dashboard for employer:', userId, 'Role:', userRole);

        // Get all data in parallel
        const [
            totalEmployees,
            pendingDocuments,
            openTickets,
            recentNotifications,
            totalUnreadNotifications,
            pendingOnboarding
        ] = await Promise.all([
            // 1. Total employees count
            Employee.countDocuments({ isActive: true }),

            // 2. Pending documents count (documents with pending or doc_submitted status)
            Document.aggregate([
                {
                    $project: {
                        pendingCount: {
                            $size: {
                                $filter: {
                                    input: {
                                        $objectToArray: "$$ROOT"
                                    },
                                    as: "field",
                                    cond: {
                                        $and: [
                                            { $ne: ["$$field.k", "_id"] },
                                            { $ne: ["$$field.k", "employee"] },
                                            { $ne: ["$$field.k", "employeeId"] },
                                            { $ne: ["$$field.k", "overallStatus"] },
                                            { $ne: ["$$field.k", "createdAt"] },
                                            { $ne: ["$$field.k", "updatedAt"] },
                                            { $eq: ["$$field.v.status", "doc_submitted"] }
                                        ]
                                    }
                                }
                            }
                        }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalPending: { $sum: "$pendingCount" }
                    }
                }
            ]),

            // 3. Open tickets count
            Ticket.countDocuments({
                status: { $in: ['OPEN', 'IN_PROGRESS'] }
            }),

            // 4. Recent notifications (last 5)
            Notification.find({
                $or: [
                    { recipientType: userRole, recipientId: userId },
                    { recipientType: 'ALL' }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(5)
                .select('title description type status createdAt')
                .lean(),

            // 5. Total unread notifications count
            Notification.countDocuments({
                $or: [
                    {
                        recipientType: userRole,
                        recipientId: userId,
                        status: 'unread'
                    },
                    {
                        recipientType: 'ALL',
                        status: 'unread'
                    }
                ]
            }),

            // 6. Employees with pending onboarding (status not verified)
            Employee.countDocuments({
                isActive: true,
                status: { $ne: 'verified' }
            })
        ]);

        // Prepare stats based on user role
        let statsCards = {};

        if (userRole === 'EMPLOYER_HR' || userRole === 'EMPLOYER_ADMIN') {
            statsCards = {
                totalEmployees: totalEmployees || 0,
                pendingDocuments: pendingDocuments[0]?.totalPending || 0,
                pendingOnboarding: pendingOnboarding || 0,
                openTickets: openTickets || 0,
                notifications: totalUnreadNotifications || 0
            };
        } else if (userRole === 'EMPLOYER_IT') {
            statsCards = {
                assignedTickets: await Ticket.countDocuments({
                    assignedTo: userId,
                    status: { $in: ['OPEN', 'IN_PROGRESS'] }
                }),
                totalOpenTickets: openTickets || 0,
                assignedAssets: await Asset.countDocuments({
                    assignedTo: { $ne: null },
                    status: 'ASSIGNED'
                }),
                notifications: totalUnreadNotifications || 0
            };
        }

        // Format recent notifications
        const formattedNotifications = recentNotifications.map(notification => ({
            id: notification._id,
            title: notification.title,
            description: notification.description,
            type: notification.type,
            status: notification.status,
            time: formatTimeAgo(notification.updatedAt),
            isNew: isNotificationNew(notification.updatedAt)
        }));

        // Prepare response
        const dashboardData = {
            user: {
                id: user._id,
                name: `${user.firstName} ${user.lastName}`,
                role: userRole,
                email: user.email
            },
            stats: statsCards,
            recentNotifications: formattedNotifications
        };

        res.json({
            success: true,
            message: 'Dashboard data fetched successfully',
            data: dashboardData
        });

    } catch (error) {
        console.error('Error fetching employer dashboard:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard data',
            error: error.message
        });
    }
};

// Helper function to calculate onboarding progress
function calculateOnboardingProgress(employee, documentData) {
    const steps = [
        {
            step: 1,
            title: 'Basic Information',
            description: 'Complete your profile details',
            status: 'pending',
            completed: false,
            unlocked: true
        },
        {
            step: 2,
            title: 'Upload Documents',
            description: 'Submit required documents',
            status: 'pending',
            completed: false,
            unlocked: false
        },
        {
            step: 3,
            title: 'Document Verification',
            description: 'HR verification of documents',
            status: 'pending',
            completed: false,
            unlocked: false
        }
    ];

    // Step 1: Basic Information
    if (employee.isUpdated && employee.status !== 'pending') {
        steps[0].status = 'completed';
        steps[0].completed = true;
        steps[1].unlocked = true; // Unlock step 2
    }

    // Step 2: Upload Documents
    if (documentData) {
        if (documentData.submittedDocuments > 0) {
            steps[1].status = 'completed';
            steps[1].completed = true;
            steps[2].unlocked = true; // Unlock step 3
        } else {
            steps[1].status = 'pending';
        }
    }

    // Step 3: Document Verification
    if (documentData) {
        if (documentData.overallStatus === 'completed') {
            steps[2].status = 'completed';
            steps[2].completed = true;
        } else if (documentData.overallStatus === 'in_progress') {
            steps[2].status = 'in_progress';
        } else {
            steps[2].status = 'pending';
        }
    }

    // Calculate overall progress percentage
    const completedSteps = steps.filter(step => step.completed).length;
    const progressPercentage = Math.round((completedSteps / steps.length) * 100);

    return {
        steps,
        completedSteps,
        totalSteps: steps.length,
        progressPercentage,
        overallStatus: steps[2].completed ? 'completed' : 'in_progress'
    };
}


// Helper function to format time ago
function formatTimeAgo(date) {
    // console.log(date,"date")
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) {
        return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    } else if (diffDays < 7) {
        return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    } else {
        return new Date(date).toLocaleDateString();
    }
}

// Helper function to check if notification is new (within 24 hours)
function isNotificationNew(createdAt) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return new Date(createdAt) > oneDayAgo;
}

// Get dashboard statistics for admin overview
export const getAdminOverview = async (req, res) => {
    try {
        const user = req.user;

        if (user.role !== 'EMPLOYER_ADMIN') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Admin only.'
            });
        }

        // Get all statistics in parallel
        const [
            totalEmployees,
            activeEmployees,
            pendingVerification,
            totalDocuments,
            verifiedDocuments,
            totalTickets,
            resolvedTickets,
            totalAssets,
            assignedAssets
        ] = await Promise.all([
            Employee.countDocuments({}),
            Employee.countDocuments({ isActive: true }),
            Employee.countDocuments({ status: { $ne: 'verified' } }),
            Document.countDocuments({}),
            Document.countDocuments({ overallStatus: 'completed' }),
            Ticket.countDocuments({}),
            Ticket.countDocuments({ status: 'RESOLVED' }),
            Asset.countDocuments({}),
            Asset.countDocuments({ status: 'ASSIGNED' })
        ]);

        // Calculate percentages
        const verificationRate = totalEmployees > 0
            ? Math.round(((totalEmployees - pendingVerification) / totalEmployees) * 100)
            : 0;

        const documentCompletionRate = totalDocuments > 0
            ? Math.round((verifiedDocuments / totalDocuments) * 100)
            : 0;

        const ticketResolutionRate = totalTickets > 0
            ? Math.round((resolvedTickets / totalTickets) * 100)
            : 0;

        const assetAssignmentRate = totalAssets > 0
            ? Math.round((assignedAssets / totalAssets) * 100)
            : 0;

        // Get recent activities (last 5 of each)
        const recentActivities = await Promise.all([
            Employee.find()
                .sort({ createdAt: -1 })
                .limit(5)
                .select('firstName lastName employeeId department createdAt')
                .lean(),

            Document.find({ overallStatus: 'completed' })
                .sort({ completedAt: -1 })
                .limit(5)
                .populate('employee', 'firstName lastName employeeId')
                .select('employee overallStatus completedAt')
                .lean(),

            Ticket.find({ status: 'RESOLVED' })
                .sort({ resolvedAt: -1 })
                .limit(5)
                .populate('raisedBy', 'firstName lastName')
                .select('ticketId subject category resolvedAt')
                .lean()
        ]);

        const overviewData = {
            statistics: {
                employees: {
                    total: totalEmployees,
                    active: activeEmployees,
                    pendingVerification: pendingVerification,
                    verificationRate: `${verificationRate}%`
                },
                documents: {
                    total: totalDocuments,
                    verified: verifiedDocuments,
                    completionRate: `${documentCompletionRate}%`
                },
                tickets: {
                    total: totalTickets,
                    resolved: resolvedTickets,
                    resolutionRate: `${ticketResolutionRate}%`
                },
                assets: {
                    total: totalAssets,
                    assigned: assignedAssets,
                    assignmentRate: `${assetAssignmentRate}%`
                }
            },
            recentActivities: {
                newEmployees: recentActivities[0],
                verifiedDocuments: recentActivities[1],
                resolvedTickets: recentActivities[2]
            }
        };

        res.json({
            success: true,
            message: 'Admin overview fetched successfully',
            data: overviewData
        });

    } catch (error) {
        console.error('Error fetching admin overview:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching admin overview',
            error: error.message
        });
    }
};