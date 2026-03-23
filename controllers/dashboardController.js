import Application from "../model/Application.js";
import User from "../model/User.js";
import Job from "../model/Job.js";
import mongoose from "mongoose";

// Dashboard Statistics and Analytics
export const getDashboardStats = async (req, res) => {
    try {
        const userId = req.user._id;
        const userRole = req.user.role;

        // For HR dashboard - get all statistics
        if (userRole === "hr" || 'admin') {
            const [
                totalCandidates,
                totalApplications,
                interviewScheduledCount,
                offerAcceptedCount,
                statusWiseCounts,
                topPerformingJobs,
                recentApplications,
                hrDetails
            ] = await Promise.all([
                // Total candidates count
                User.countDocuments({ role: "candidate", isActive: true }),

                // Total applications with status "applied" or "reviewed"
                Application.countDocuments({
                    status: { $in: ["applied", "reviewed"] }
                }),

                // Interview scheduled applications count
                Application.countDocuments({
                    status: { $in: ["interview scheduled", "interview rescheduled"] }
                }),

                // Offer accepted applications count
                Application.countDocuments({ status: "offer accepted" }),

                // Hiring pipeline counts
                getHiringPipelineStats(),

                // Top performing jobs
                getTopPerformingJobs(),

                // Recent 6 applications
                Application.find()
                    .populate({
                        path: 'job',
                        select: 'title department'
                    })
                    .populate({
                        path: 'user',
                        select: 'fullName email'
                    })
                    .sort({ createdAt: -1 })
                    .limit(6)
                    .select('status createdAt'),

                // HR details
                User.find({ role: "hr" })
                    .select('fullName email phoneNumber lastLogin designation')
                    .sort({ createdAt: 1 })
            ]);

            const dashboardData = {
                success: true,
                message: "Dashboard data retrieved successfully",
                data: {
                    statistics: {
                        totalCandidates,
                        totalApplications,
                        interviewScheduledCount,
                        offerAcceptedCount
                    },
                    hiringPipeline: statusWiseCounts,
                    topPerformingJobs,
                    recentApplications,
                    hrDetails,
                    user: req?.user
                }
            };

            return res.status(200).json(dashboardData);
        }

        // For candidate dashboard - limited statistics
        else if (userRole === "candidate") {
            const [
                totalApplications,
                interviewScheduledCount,
                offerAcceptedCount,
                candidateStats,
                recentApplications
            ] = await Promise.all([
                // Total applications by this candidate
                Application.countDocuments({ user: userId }),

                // Interview scheduled applications by this candidate
                Application.countDocuments({
                    user: userId,
                    status: { $in: ["interview scheduled", "interview rescheduled"] }
                }),

                // Offer accepted applications by this candidate
                Application.countDocuments({
                    user: userId,
                    status: "offer accepted"
                }),

                // Application status counts for this candidate
                Application.aggregate([
                    { $match: { user: new mongoose.Types.ObjectId(userId) } },
                    {
                        $group: {
                            _id: '$status',
                            count: { $sum: 1 }
                        }
                    }
                ]),

                // Recent 6 applications by this candidate
                Application.find({ user: userId })
                    .populate({
                        path: 'job',
                        select: 'title department location employmentType'
                    })
                    .sort({ createdAt: -1 })
                    .limit(6)
                    .select('status createdAt interviewDetails.date')
            ]);

            // Format candidate statistics
            const candidateStatistics = {
                applied: 0,
                reviewed: 0,
                shortlisted: 0,
                "interview scheduled": 0,
                "interview rescheduled": 0,
                "interview selected": 0,
                "interview rejected": 0,
                "offer sent": 0,
                "offer accepted": 0,
                "offer rejected": 0,
                rejected: 0
            };

            candidateStats.forEach(stat => {
                candidateStatistics[stat._id] = stat.count;
            });

            const dashboardData = {
                success: true,
                message: "Candidate dashboard data retrieved successfully",
                data: {
                    statistics: {
                        totalApplications,
                        interviewScheduledCount,
                        offerAcceptedCount
                    },
                    applicationStatus: candidateStatistics,
                    recentApplications
                }
            };

            return res.status(200).json(dashboardData);
        }

        // For employee dashboard (if needed)
        else {
            return res.status(200).json({
                success: true,
                message: "Employee dashboard",
                data: {
                    welcomeMessage: "Welcome to the employee dashboard",
                    user: {
                        fullName: req.user.fullName,
                        email: req.user.email,
                        role: req.user.role
                    }
                }
            });
        }

    } catch (error) {
        console.error("Dashboard stats error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Helper function to get hiring pipeline stats
const getHiringPipelineStats = async () => {
    const pipelineStats = await Application.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 }
            }
        }
    ]);

    // Define the hiring pipeline stages we want to track
    const pipelineStages = {
        applied: 0,
        "interview scheduled": 0,
        "offer sent": 0,
        onboarded: 0,
        total: await Application.countDocuments()
    };

    pipelineStats.forEach(stat => {
        if (pipelineStages.hasOwnProperty(stat._id)) {
            pipelineStages[stat._id] = stat.count;
        }
    });

    return pipelineStages;
};

// Helper function to get top performing jobs
const getTopPerformingJobs = async () => {
    const topJobs = await Job.aggregate([
        { $match: { isActive: true } },
        { $sort: { applicantsCount: -1 } },
        { $limit: 5 },
        {
            $lookup: {
                from: 'applications',
                localField: '_id',
                foreignField: 'job',
                as: 'applications'
            }
        },
        {
            $project: {
                title: 1,
                department: 1,
                location: 1,
                applicantsCount: 1,
                salaryRange: 1,
                employmentType: 1,
                experienceRequired: 1,
                totalApplications: { $size: '$applications' },
                interviewSelectedCount: {
                    $size: {
                        $filter: {
                            input: '$applications',
                            as: 'app',
                            cond: { $eq: ['$$app.status', 'interview selected'] }
                        }
                    }
                },
                offerAcceptedCount: {
                    $size: {
                        $filter: {
                            input: '$applications',
                            as: 'app',
                            cond: { $eq: ['$$app.status', 'offer accepted'] }
                        }
                    }
                }
            }
        }
    ]);

    return topJobs;
};

// Advanced Dashboard Analytics (HR only)
export const getAdvancedAnalytics = async (req, res) => {
    try {
        if (req.user.role !== "hr") {
            return res.status(403).json({
                success: false,
                message: "Access denied. HR role required."
            });
        }

        const { period = "30d" } = req.query; // 7d, 30d, 90d, 1y

        // Calculate date range based on period
        const dateRange = calculateDateRange(period);

        const [
            applicationTrends,
            departmentWiseStats,
            locationWiseStats,
            conversionRates,
            upcomingInterviews
        ] = await Promise.all([
            getApplicationTrends(dateRange),
            getDepartmentWiseStats(),
            getLocationWiseStats(),
            getConversionRates(),
            getUpcomingInterviewsStats()
        ]);

        res.status(200).json({
            success: true,
            message: "Advanced analytics retrieved successfully",
            data: {
                period,
                dateRange,
                applicationTrends,
                departmentWiseStats,
                locationWiseStats,
                conversionRates,
                upcomingInterviews
            }
        });

    } catch (error) {
        console.error("Advanced analytics error:", error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Helper function to calculate date range
const calculateDateRange = (period) => {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
        case "7d":
            startDate.setDate(startDate.getDate() - 7);
            break;
        case "30d":
            startDate.setDate(startDate.getDate() - 30);
            break;
        case "90d":
            startDate.setDate(startDate.getDate() - 90);
            break;
        case "1y":
            startDate.setFullYear(startDate.getFullYear() - 1);
            break;
        default:
            startDate.setDate(startDate.getDate() - 30);
    }

    return { startDate, endDate };
};

// Helper function to get application trends
const getApplicationTrends = async (dateRange) => {
    const { startDate, endDate } = dateRange;

    return await Application.aggregate([
        {
            $match: {
                createdAt: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                },
                count: { $sum: 1 },
                statusCounts: {
                    $push: "$status"
                }
            }
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                date: "$_id",
                totalApplications: "$count",
                applied: {
                    $size: {
                        $filter: {
                            input: "$statusCounts",
                            as: "status",
                            cond: { $eq: ["$$status", "applied"] }
                        }
                    }
                },
                interviewed: {
                    $size: {
                        $filter: {
                            input: "$statusCounts",
                            as: "status",
                            cond: { $in: ["$$status", ["interview scheduled", "interview rescheduled"]] }
                        }
                    }
                },
                offered: {
                    $size: {
                        $filter: {
                            input: "$statusCounts",
                            as: "status",
                            cond: { $eq: ["$$status", "offer sent"] }
                        }
                    }
                }
            }
        }
    ]);
};

// Helper function to get department-wise statistics
const getDepartmentWiseStats = async () => {
    return await Job.aggregate([
        { $match: { isActive: true } },
        {
            $lookup: {
                from: 'applications',
                localField: '_id',
                foreignField: 'job',
                as: 'applications'
            }
        },
        {
            $group: {
                _id: '$department',
                totalJobs: { $sum: 1 },
                totalApplications: { $sum: { $size: '$applications' } },
                totalApplicants: { $sum: '$applicantsCount' },
                avgApplicantsPerJob: { $avg: '$applicantsCount' }
            }
        },
        { $sort: { totalApplications: -1 } }
    ]);
};

// Helper function to get location-wise statistics
const getLocationWiseStats = async () => {
    return await Job.aggregate([
        { $match: { isActive: true } },
        {
            $lookup: {
                from: 'applications',
                localField: '_id',
                foreignField: 'job',
                as: 'applications'
            }
        },
        {
            $group: {
                _id: '$location',
                totalJobs: { $sum: 1 },
                totalApplications: { $sum: { $size: '$applications' } },
                activeJobs: {
                    $sum: {
                        $cond: [{ $eq: ['$isActive', true] }, 1, 0]
                    }
                }
            }
        },
        { $sort: { totalApplications: -1 } }
    ]);
};

// Helper function to get conversion rates
const getConversionRates = async () => {
    const totalStats = await Application.aggregate([
        {
            $group: {
                _id: null,
                totalApplications: { $sum: 1 },
                totalInterviewed: {
                    $sum: {
                        $cond: [{ $in: ["$status", ["interview scheduled", "interview rescheduled", "interview selected", "interview rejected"]] }, 1, 0]
                    }
                },
                totalOffered: {
                    $sum: {
                        $cond: [{ $in: ["$status", ["offer sent", "offer accepted", "offer rejected"]] }, 1, 0]
                    }
                },
                totalHired: {
                    $sum: {
                        $cond: [{ $eq: ["$status", "onboarded"] }, 1, 0]
                    }
                }
            }
        }
    ]);

    if (totalStats.length === 0) {
        return {
            applicationToInterview: 0,
            interviewToOffer: 0,
            offerToHire: 0,
            overallConversion: 0
        };
    }

    const stats = totalStats[0];

    return {
        applicationToInterview: stats.totalApplications > 0 ?
            (stats.totalInterviewed / stats.totalApplications * 100).toFixed(2) : 0,
        interviewToOffer: stats.totalInterviewed > 0 ?
            (stats.totalOffered / stats.totalInterviewed * 100).toFixed(2) : 0,
        offerToHire: stats.totalOffered > 0 ?
            (stats.totalHired / stats.totalOffered * 100).toFixed(2) : 0,
        overallConversion: stats.totalApplications > 0 ?
            (stats.totalHired / stats.totalApplications * 100).toFixed(2) : 0
    };
};

// Helper function to get upcoming interviews stats
const getUpcomingInterviewsStats = async () => {
    const today = new Date();
    const next7Days = new Date();
    next7Days.setDate(today.getDate() + 7);

    return await Application.aggregate([
        {
            $match: {
                status: { $in: ["interview scheduled", "interview rescheduled"] },
                "interviewDetails.date": { $gte: today, $lte: next7Days }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$interviewDetails.date" }
                },
                count: { $sum: 1 },
                onlineCount: {
                    $sum: {
                        $cond: [{ $eq: ["$interviewDetails.mode", "online"] }, 1, 0]
                    }
                },
                offlineCount: {
                    $sum: {
                        $cond: [{ $eq: ["$interviewDetails.mode", "offline"] }, 1, 0]
                    }
                }
            }
        },
        { $sort: { _id: 1 } },
        {
            $project: {
                date: "$_id",
                totalInterviews: "$count",
                onlineInterviews: "$onlineCount",
                offlineInterviews: "$offlineCount"
            }
        }
    ]);
};