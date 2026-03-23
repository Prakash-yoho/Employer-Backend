import Employee from '../../model/Employee.js';
import Document from '../../model/Document.js';
import Ticket from '../../model/Ticket.js';

// Get HR/Admin Dashboard Statistics
export const getDashboardStats = async (req, res) => {
    try {
        // Check if user has permission
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can access dashboard'
            });
        }

        // Fetch all statistics in parallel
        const [
            totalEmployees,
            pendingTickets,
            pendingDocumentVerifications,
            verifiedEmployees,
            onboardingProcessData,
            onboardingProgressOverview,
            departmentDistribution
        ] = await Promise.all([
            getTotalEmployees(),
            getPendingTickets(),
            getPendingDocumentVerifications(),
            getVerifiedEmployees(),
            getOnboardingProcessData(),
            getOnboardingProgressOverview(),
            getDepartmentDistribution()
        ]);
        return res.status(200).json({
            success: true,
            message: 'Dashboard statistics retrieved successfully',
            data: {
                statsCards: {
                    totalEmployees,
                    pendingTickets,
                    pendingDocumentVerifications,
                    verifiedEmployees
                },
                onboardingProgressOverview,
                departmentDistribution
            }
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get detailed onboarding progress for each employee
export const getOnboardingProgress = async (req, res) => {
    try {
        // Check if user has permission
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can access onboarding progress'
            });
        }

        const { page = 1, limit = 10 } = req.query;
        const skip = (page - 1) * limit;

        // Get all employees with their documents
        const [employees, total] = await Promise.all([
            Employee.find({})
                .select('employeeId firstName lastName department designation status isUpdated createdBy createdAt')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Employee.countDocuments({})
        ]);

        // Get documents for all employees
        const employeeIds = employees.map(emp => emp._id);
        const documents = await Document.find({ employee: { $in: employeeIds } })
            .select('employee overallStatus verificationProgress');

        // Create a map for quick document lookup
        const documentMap = {};
        documents.forEach(doc => {
            documentMap[doc.employee.toString()] = doc;
        });

        // Calculate onboarding progress for each employee
        const onboardingProgress = employees.map(employee => {
            const document = documentMap[employee._id.toString()];

            // Calculate step based on isUpdated and document status
            let step = 0;
            let stepLabel = '';

            if (employee.isUpdated) {
                step = 1;
                stepLabel = 'Profile Updated';

                if (document) {
                    if (document.overallStatus === 'in_progress') {
                        step = 2;
                        stepLabel = 'Documents Pending';
                    } else if (document.overallStatus === 'completed') {
                        step = 3;
                        stepLabel = 'Verification Completed';
                    }
                }
            } else {
                step = 1;
                stepLabel = 'Profile Pending';
            }

            return {
                employeeId: employee.employeeId,
                name: `${employee.firstName} ${employee.lastName}`,
                department: employee.department,
                designation: employee.designation,
                status: employee.status,
                isUpdated: employee.isUpdated,
                step,
                stepLabel,
                stepProgress: `${step}/3`,
                documentStatus: document ? document.overallStatus : 'pending',
                verificationProgress: document ? document.verificationProgress : '0/0',
                createdAt: employee.createdAt
            };
        });

        const totalPages = Math.ceil(total / limit);

        return res.status(200).json({
            success: true,
            message: 'Onboarding progress retrieved successfully',
            data: {
                onboardingProgress,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalItems: total,
                    itemsPerPage: parseInt(limit),
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Get onboarding progress error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Helper Functions
const getTotalEmployees = async () => {
    try {
        return await Employee.countDocuments({});
    } catch (error) {
        console.error('Error getting total employees:', error);
        return 0;
    }
};

const getPendingTickets = async () => {
    try {
        return await Ticket.countDocuments({
            status: { $in: ['OPEN', 'IN_PROGRESS'] }
        });
    } catch (error) {
        console.error('Error getting pending tickets:', error);
        return 0;
    }
};

const getPendingDocumentVerifications = async () => {
    try {
        return await Document.countDocuments({
            overallStatus: { $in: ['pending', 'in_progress'] }
        });
    } catch (error) {
        console.error('Error getting pending document verifications:', error);
        return 0;
    }
};

const getVerifiedEmployees = async () => {
    try {
        return await Employee.countDocuments({
            status: 'verified'
        });
    } catch (error) {
        console.error('Error getting verified employees:', error);
        return 0;
    }
};

const getOnboardingProcessData = async () => {
    try {
        // Get total employees
        const totalEmployees = await Employee.countDocuments({});

        if (totalEmployees === 0) {
            return {
                totalEmployees: 0,
                averageStep: '0/3',
                completionRate: '0%',
                byStep: {
                    step1: 0,
                    step2: 0,
                    step3: 0
                }
            };
        }

        // Get all employees with their documents
        const employees = await Employee.find({})
            .select('_id isUpdated status');

        const employeeIds = employees.map(emp => emp._id);
        const documents = await Document.find({ employee: { $in: employeeIds } })
            .select('employee overallStatus');

        // Create a map for quick document lookup
        const documentMap = {};
        documents.forEach(doc => {
            documentMap[doc.employee.toString()] = doc;
        });

        // Count employees at each step
        let step1Count = 0;
        let step2Count = 0;
        let step3Count = 0;
        let totalSteps = 0;

        employees.forEach(employee => {
            const document = documentMap[employee._id.toString()];
            let step = 0;

            if (employee.isUpdated) {
                step = 1;
                step1Count++;

                if (document) {
                    if (document.overallStatus === 'in_progress') {
                        step = 2;
                        step2Count++;
                    } else if (document.overallStatus === 'completed') {
                        step = 3;
                        step3Count++;
                    }
                }
            } else {
                step = 1;
                step1Count++;
            }

            totalSteps += step;
        });

        // Calculate average step
        const averageStep = totalEmployees > 0 ? (totalSteps / totalEmployees) : 0;

        // Calculate completion rate (Step 3 employees)
        const completionRate = totalEmployees > 0 ? (step3Count / totalEmployees) * 100 : 0;

        return {
            totalEmployees,
            averageStep: `${averageStep.toFixed(1)}/3`,
            completionRate: `${completionRate.toFixed(1)}%`,
            byStep: {
                step1: step1Count,
                step2: step2Count,
                step3: step3Count
            }
        };
    } catch (error) {
        console.error('Error getting onboarding process data:', error);
        return {
            totalEmployees: 0,
            averageStep: '0/3',
            completionRate: '0%',
            byStep: {
                step1: 0,
                step2: 0,
                step3: 0
            }
        };
    }
};

const getOnboardingProgressOverview = async () => {
    try {
        // Step 1: Basic Info - Employees who have updated their profile (isUpdated = true)
        const step1Count = await Employee.countDocuments({ isUpdated: true });

        // Step 2: Documents Pending - Employees whose documents are in progress
        const employeesWithDocuments = await Document.aggregate([
            {
                $match: {
                    overallStatus: { $in: ['pending', 'in_progress'] }
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 }
                }
            }
        ]);

        const step2Count = employeesWithDocuments.length > 0 ? employeesWithDocuments[0].count : 0;

        // Step 3: Verification - Employees whose documents are completed
        const employeesWithCompletedDocs = await Document.aggregate([
            {
                $match: {
                    overallStatus: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 }
                }
            }
        ]);

        const step3Count = employeesWithCompletedDocs.length > 0 ? employeesWithCompletedDocs[0].count : 0;

        return {
            step1: {
                name: 'Basic Info',
                description: 'Employees who updated their profile',
                count: step1Count
            },
            step2: {
                name: 'Documents Pending',
                description: 'Employees with pending documents',
                count: step2Count
            },
            step3: {
                name: 'Verification',
                description: 'Employees with verified documents',
                count: step3Count
            },
            totalEmployees: await Employee.countDocuments({})
        };
    } catch (error) {
        console.error('Error getting onboarding progress overview:', error);
        return {
            step1: { name: 'Basic Info', description: 'Employees who updated their profile', count: 0 },
            step2: { name: 'Documents Pending', description: 'Employees with pending documents', count: 0 },
            step3: { name: 'Verification', description: 'Employees with verified documents', count: 0 },
            totalEmployees: 0
        };
    }
};

const getDepartmentDistribution = async () => {
    try {
        const distribution = await Employee.aggregate([
            {
                $group: {
                    _id: '$department',
                    count: { $sum: 1 },
                    employees: {
                        $push: {
                            employeeId: '$employeeId',
                            name: { $concat: ['$firstName', ' ', '$lastName'] },
                            designation: '$designation',
                            status: '$status'
                        }
                    }
                }
            },
            {
                $project: {
                    department: '$_id',
                    count: 1,
                    employees: { $slice: ['$employees', 5] }, // Limit to 5 employees per department
                    percentage: {
                        $multiply: [
                            { $divide: ['$count', { $sum: '$count' }] },
                            100
                        ]
                    }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        // Calculate total employees
        const totalEmployees = distribution.reduce((sum, dept) => sum + dept.count, 0);

        // Format the response
        const formattedDistribution = distribution.map(dept => ({
            department: dept.department || 'Unassigned',
            count: dept.count,
            percentage: `${dept.percentage.toFixed(1)}%`,
            employees: dept.employees
        }));

        return {
            distribution: formattedDistribution,
            totalDepartments: distribution.length,
            totalEmployees
        };
    } catch (error) {
        console.error('Error getting department distribution:', error);
        return {
            distribution: [],
            totalDepartments: 0,
            totalEmployees: 0
        };
    }
};

// Get recent activity (recent tickets, document verifications, employee updates)
export const getRecentActivity = async (req, res) => {
    try {
        // Check if user has permission
        if (!['EMPLOYER_ADMIN', 'EMPLOYER_HR'].includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN or HR can access recent activity'
            });
        }

        const { limit = 10 } = req.query;

        // Get recent tickets
        const recentTickets = await Ticket.find({})
            .populate('raisedBy', 'firstName lastName employeeId')
            .populate('assignedTo', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .limit(5);

        // Get recent document verifications
        const recentDocumentVerifications = await Document.find({
            $or: [
                { verifiedDocuments: { $gt: 0 } },
                { overallStatus: 'completed' }
            ]
        })
            .populate('employee', 'firstName lastName employeeId')
            .populate('lastVerifiedBy', 'firstName lastName email')
            .sort({ updatedAt: -1 })
            .limit(5);

        // Get recent employee profile updates
        const recentProfileUpdates = await Employee.find({
            isUpdated: true,
            lastUpdatedAt: { $ne: null }
        })
            .select('employeeId firstName lastName department designation lastUpdatedAt')
            .populate('lastUpdatedBy', 'firstName lastName email')
            .sort({ lastUpdatedAt: -1 })
            .limit(5);

        // Format recent activity
        const recentActivity = [];

        // Add tickets
        recentTickets.forEach(ticket => {
            recentActivity.push({
                type: 'TICKET',
                action: `New ticket created: ${ticket.subject}`,
                details: {
                    ticketId: ticket.ticketId,
                    priority: ticket.priority,
                    status: ticket.status,
                    raisedBy: ticket.raisedBy ? `${ticket.raisedBy.firstName} ${ticket.raisedBy.lastName}` : 'Unknown'
                },
                timestamp: ticket.createdAt
            });
        });

        // Add document verifications
        recentDocumentVerifications.forEach(doc => {
            recentActivity.push({
                type: 'DOCUMENT',
                action: `Document verification ${doc.overallStatus === 'completed' ? 'completed' : 'updated'}`,
                details: {
                    employee: doc.employee ? `${doc.employee.firstName} ${doc.employee.lastName}` : 'Unknown',
                    progress: doc.verificationProgress,
                    verifiedBy: doc.lastVerifiedBy ? `${doc.lastVerifiedBy.firstName} ${doc.lastVerifiedBy.lastName}` : null
                },
                timestamp: doc.updatedAt
            });
        });

        // Add profile updates
        recentProfileUpdates.forEach(employee => {
            recentActivity.push({
                type: 'PROFILE',
                action: 'Employee profile updated',
                details: {
                    employeeId: employee.employeeId,
                    name: `${employee.firstName} ${employee.lastName}`,
                    department: employee.department,
                    updatedBy: employee.lastUpdatedBy ? `${employee.lastUpdatedBy.firstName} ${employee.lastUpdatedBy.lastName}` : null
                },
                timestamp: employee.lastUpdatedAt
            });
        });

        // Sort by timestamp (most recent first)
        recentActivity.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        // Limit to requested number
        const limitedActivity = recentActivity.slice(0, limit);

        return res.status(200).json({
            success: true,
            message: 'Recent activity retrieved successfully',
            data: {
                recentActivity: limitedActivity,
                activityCounts: {
                    tickets: recentTickets.length,
                    documents: recentDocumentVerifications.length,
                    profiles: recentProfileUpdates.length,
                    total: limitedActivity.length
                }
            }
        });
    } catch (error) {
        console.error('Get recent activity error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};