import Ticket from '../../model/Ticket.js';
import Asset from '../../model/Asset.js';

// Get comprehensive IT dashboard data (all in one)
export const getComprehensiveITDashboard = async (req, res) => {
    try {
        // Check if user has permission
        if (req.user.role !== 'EMPLOYER_IT') {
            return res.status(403).json({
                success: false,
                message: 'Only IT Support can access IT dashboard'
            });
        }

        // Get current date for today's calculations
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // Fetch ALL data in parallel for maximum performance
        const [
            newTicketsCount,
            inProgressTicketsCount,
            resolvedTodayCount,
            priorityTickets,
            recentlyAssignedAssets,
            assetInventoryOverview,
            recentActivity,
            ticketStats,
            assetStats,
            urgentIssues,
            assetHealth
        ] = await Promise.all([
            // Stats cards data
            getNewTicketsCount(req.user._id),
            getInProgressTicketsCount(req.user._id),
            getResolvedTodayCount(req.user._id, today, tomorrow),

            // Priority tickets
            getPriorityTickets(req.user._id),

            // Recently assigned assets
            getRecentlyAssignedAssets(),

            // Asset inventory
            getAssetInventoryOverview(),

            // Recent activity (last 10 activities)
            getRecentActivityData(req.user._id, 10),

            // Ticket statistics
            getTicketStatistics(req.user._id),

            // Asset statistics
            getAssetStatisticsData(),

            // Urgent issues (high priority + repair assets)
            getUrgentIssues(req.user._id),

            // Asset health status
            getAssetHealthStatus()
        ]);

        // Compile all data into a single comprehensive response
        const comprehensiveData = {
            // Basic stats for quick overview
            quickStats: {
                newTickets: newTicketsCount,
                inProgressTickets: inProgressTicketsCount,
                resolvedToday: resolvedTodayCount,
            },

            // Priority section
            priorityTickets: priorityTickets,

            // Assets section
            assets: {
                recentlyAssigned: recentlyAssignedAssets,
                inventoryOverview: assetInventoryOverview,
                stats: assetStats
            },

            // Activity timeline
            recentActivity: recentActivity.all
        };

        return res.status(200).json({
            success: true,
            message: 'IT dashboard data retrieved successfully',
            data: comprehensiveData
        });
    } catch (error) {
        console.error('Get IT dashboard error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// New helper functions for comprehensive data
const getNewTicketsCount = async (userId) => {
    try {
        // New tickets: Recently forwarded to this IT user (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        return await Ticket.countDocuments({
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                { forwardedTo: userId },
                { status: { $in: ['OPEN', 'IN_PROGRESS'] } },
                { createdAt: { $gte: sevenDaysAgo } }
            ]
        });
    } catch (error) {
        console.error('Error getting new tickets count:', error);
        return 0;
    }
};

const getInProgressTicketsCount = async (userId) => {
    try {
        return await Ticket.countDocuments({
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                {
                    $or: [
                        { forwardedTo: userId },
                        { assignedTo: userId }
                    ]
                },
                { status: 'IN_PROGRESS' }
            ]
        });
    } catch (error) {
        console.error('Error getting in-progress tickets count:', error);
        return 0;
    }
};

const getResolvedTodayCount = async (userId, today, tomorrow) => {
    try {
        return await Ticket.countDocuments({
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                {
                    $or: [
                        { forwardedTo: userId },
                        { assignedTo: userId },
                        { resolvedBy: userId }
                    ]
                },
                { status: 'RESOLVED' },
                { resolvedAt: { $gte: today, $lt: tomorrow } }
            ]
        });
    } catch (error) {
        console.error('Error getting resolved today count:', error);
        return 0;
    }
};

const getPriorityTickets = async (userId) => {
    try {
        // Get high priority tickets first, then medium, limit to 3
        const tickets = await Ticket.find({
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                {
                    $or: [
                        { forwardedTo: userId },
                        { assignedTo: userId },
                        { status: 'OPEN' }
                    ]
                },
                { status: { $in: ['OPEN', 'IN_PROGRESS'] } }
            ]
        })
            .populate('raisedBy', 'firstName lastName employeeId department')
            .populate('forwardedTo', 'firstName lastName email')
            .sort({
                // Sort by priority: HIGH > MEDIUM > LOW
                priority: -1,
                // Then by creation date (newest first)
                createdAt: -1
            })
            .limit(3);

        return tickets;
    } catch (error) {
        console.error('Error getting priority tickets:', error);
        return [];
    }
};

const getRecentlyAssignedAssets = async () => {
    try {
        // Get recently assigned assets (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const assets = await Asset.find({
            status: 'ASSIGNED',
            assignedDate: { $gte: sevenDaysAgo }
        })
            .populate('assignedTo', 'firstName lastName employeeId department designation')
            .populate('assignedBy', 'firstName lastName email')
            .sort({ assignedDate: -1 })
            .limit(5); // Limit to 5 most recent

        return assets;
    } catch (error) {
        console.error('Error getting recently assigned assets:', error);
        return [];
    }
};

const getAssetInventoryOverview = async () => {
    try {
        // Get category-wise asset overview
        const categoryOverview = await Asset.aggregate([
            {
                $group: {
                    _id: '$category',
                    total: { $sum: 1 },
                    available: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$status', 'AVAILABLE'] },
                                        { $eq: ['$condition', 'EXCELLENT'] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    assigned: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'ASSIGNED'] },
                                1,
                                0
                            ]
                        }
                    },
                    repair: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'REPAIR'] },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            {
                $project: {
                    category: '$_id',
                    total: 1,
                    available: 1,
                    assigned: 1,
                    repair: 1,
                    utilization: {
                        $multiply: [
                            { $divide: ['$assigned', '$total'] },
                            100
                        ]
                    },
                    availability: {
                        $multiply: [
                            { $divide: ['$available', '$total'] },
                            100
                        ]
                    }
                }
            },
            {
                $sort: { total: -1 }
            }
        ]);

        // Format the response with category display names
        const categoryDisplayMap = {
            'LAPTOP': 'Laptops',
            'DESKTOP': 'Desktops',
            'MONITOR': 'Monitors',
            'KEYBOARD': 'Keyboards',
            'MOUSE': 'Mice',
            'HEADPHONES': 'Headphones',
            'MOBILE': 'Mobile Phones',
            'TABLET': 'Tablets',
            'SERVER': 'Servers',
            'NETWORK': 'Network Equipment',
            'PRINTER': 'Printers',
            'SCANNER': 'Scanners',
            'PROJECTOR': 'Projectors',
            'OTHER': 'Other Assets'
        };

        const formattedOverview = categoryOverview.map(item => ({
            category: item.category,
            categoryDisplay: categoryDisplayMap[item.category] || item.category,
            total: item.total,
            available: item.available,
            assigned: item.assigned,
            repair: item.repair,
            utilization: `${item.utilization.toFixed(1)}%`,
            availability: `${item.availability.toFixed(1)}%`,
            ratio: `${item.available}/${item.total}`
        }));

        // Calculate overall statistics
        const overallStats = await Asset.aggregate([
            {
                $group: {
                    _id: null,
                    totalAssets: { $sum: 1 },
                    availableAssets: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$status', 'AVAILABLE'] },
                                        { $eq: ['$condition', 'EXCELLENT'] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    },
                    assignedAssets: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'ASSIGNED'] },
                                1,
                                0
                            ]
                        }
                    },
                    repairAssets: {
                        $sum: {
                            $cond: [
                                { $eq: ['$status', 'REPAIR'] },
                                1,
                                0
                            ]
                        }
                    },
                    excellentCondition: {
                        $sum: {
                            $cond: [
                                { $eq: ['$condition', 'EXCELLENT'] },
                                1,
                                0
                            ]
                        }
                    },
                    fairCondition: {
                        $sum: {
                            $cond: [
                                { $eq: ['$condition', 'FAIR'] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const overall = overallStats[0] || {
            totalAssets: 0,
            availableAssets: 0,
            assignedAssets: 0,
            repairAssets: 0,
            excellentCondition: 0,
            fairCondition: 0
        };

        return {
            categoryOverview: formattedOverview,
            overall: {
                totalAssets: overall.totalAssets,
                availableAssets: overall.availableAssets,
                assignedAssets: overall.assignedAssets,
                repairAssets: overall.repairAssets,
                excellentCondition: overall.excellentCondition,
                fairCondition: overall.fairCondition,
                utilizationRate: overall.totalAssets > 0 ?
                    `${((overall.assignedAssets / overall.totalAssets) * 100).toFixed(1)}%` : '0%',
                availabilityRate: overall.totalAssets > 0 ?
                    `${((overall.availableAssets / overall.totalAssets) * 100).toFixed(1)}%` : '0%'
            }
        };
    } catch (error) {
        console.error('Error getting asset inventory overview:', error);
        return {
            categoryOverview: [],
            overall: {
                totalAssets: 0,
                availableAssets: 0,
                assignedAssets: 0,
                repairAssets: 0,
                excellentCondition: 0,
                fairCondition: 0,
                utilizationRate: '0%',
                availabilityRate: '0%'
            }
        };
    }
};

const getRecentActivityData = async (userId, limit = 10) => {
    try {
        // Get recent ticket activities
        const recentTickets = await Ticket.find({
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                {
                    $or: [
                        { forwardedTo: userId },
                        { assignedTo: userId },
                        { resolvedBy: userId }
                    ]
                }
            ]
        })
            .populate('raisedBy', 'firstName lastName employeeId')
            .populate('forwardedTo', 'firstName lastName email')
            .populate('resolvedBy', 'firstName lastName email')
            .sort({ updatedAt: -1 })
            .limit(limit);

        // Get recent asset activities
        const recentAssets = await Asset.find({
            $or: [
                { createdBy: userId },
                { assignedBy: userId },
                { updatedBy: userId }
            ]
        })
            .populate('assignedTo', 'firstName lastName employeeId')
            .populate('createdBy', 'firstName lastName email')
            .sort({ updatedAt: -1 })
            .limit(limit);

        // Format ticket activities
        const ticketActivities = recentTickets.map(ticket => ({
            type: 'TICKET',
            id: ticket.ticketId,
            subject: ticket.subject,
            priority: ticket.priority,
            status: ticket.status,
            raisedBy: ticket.raisedBy ? `${ticket.raisedBy.firstName} ${ticket.raisedBy.lastName}` : 'Unknown',
            timestamp: ticket.updatedAt,
            action: ticket.status === 'RESOLVED' ? 'Resolved' :
                ticket.forwardedTo ? 'Assigned' : 'Created'
        }));

        // Format asset activities
        const assetActivities = recentAssets.map(asset => ({
            type: 'ASSET',
            id: asset.assetId,
            name: asset.assetName,
            status: asset.status,
            condition: asset.condition,
            assignedTo: asset.assignedTo ? `${asset.assignedTo.firstName} ${asset.assignedTo.lastName}` : null,
            timestamp: asset.updatedAt,
            action: asset.status === 'ASSIGNED' ? 'Assigned' :
                asset.createdBy ? 'Created' : 'Updated'
        }));

        // Combine and sort all activities
        const allActivities = [...ticketActivities, ...assetActivities]
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);

        return {
            tickets: ticketActivities,
            assets: assetActivities,
            all: allActivities,
            counts: {
                tickets: ticketActivities.length,
                assets: assetActivities.length,
                total: allActivities.length
            }
        };
    } catch (error) {
        console.error('Error getting recent activity data:', error);
        return {
            tickets: [],
            assets: [],
            all: [],
            counts: { tickets: 0, assets: 0, total: 0 }
        };
    }
};

const getTicketStatistics = async (userId) => {
    try {
        // Define IT ticket filter
        const itTicketFilter = {
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                {
                    $or: [
                        { forwardedTo: userId },
                        { assignedTo: userId },
                        { status: 'OPEN' }
                    ]
                }
            ]
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const lastWeek = new Date(today);
        lastWeek.setDate(lastWeek.getDate() - 7);

        const [
            total,
            open,
            inProgress,
            resolved,
            resolvedToday,
            createdLastWeek,
            byPriority,
            byCategory
        ] = await Promise.all([
            Ticket.countDocuments(itTicketFilter),
            Ticket.countDocuments({ ...itTicketFilter, status: 'OPEN' }),
            Ticket.countDocuments({ ...itTicketFilter, status: 'IN_PROGRESS' }),
            Ticket.countDocuments({ ...itTicketFilter, status: 'RESOLVED' }),
            Ticket.countDocuments({
                ...itTicketFilter,
                status: 'RESOLVED',
                resolvedAt: { $gte: today }
            }),
            Ticket.countDocuments({
                ...itTicketFilter,
                createdAt: { $gte: lastWeek }
            }),
            Ticket.aggregate([
                { $match: itTicketFilter },
                { $group: { _id: '$priority', count: { $sum: 1 } } }
            ]),
            Ticket.aggregate([
                { $match: itTicketFilter },
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ])
        ]);

        // Calculate average resolution time (in hours)
        const resolutionStats = await Ticket.aggregate([
            {
                $match: {
                    ...itTicketFilter,
                    status: 'RESOLVED',
                    resolvedAt: { $ne: null },
                    createdAt: { $ne: null }
                }
            },
            {
                $addFields: {
                    resolutionHours: {
                        $divide: [
                            { $subtract: ['$resolvedAt', '$createdAt'] },
                            1000 * 60 * 60 // Convert to hours
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    avgResolutionTime: { $avg: '$resolutionHours' },
                    minResolutionTime: { $min: '$resolutionHours' },
                    maxResolutionTime: { $max: '$resolutionHours' }
                }
            }
        ]);

        const resolutionTime = resolutionStats[0] || {
            avgResolutionTime: 0,
            minResolutionTime: 0,
            maxResolutionTime: 0
        };

        // Format priority distribution
        const priorityDistribution = {
            HIGH: byPriority.find(p => p._id === 'HIGH')?.count || 0,
            MEDIUM: byPriority.find(p => p._id === 'MEDIUM')?.count || 0,
            LOW: byPriority.find(p => p._id === 'LOW')?.count || 0
        };

        // Format category distribution
        const categoryDistribution = {
            TECHNICAL_ISSUE: byCategory.find(c => c._id === 'TECHNICAL_ISSUE')?.count || 0,
            IT_ASSET: byCategory.find(c => c._id === 'IT_ASSET')?.count || 0
        };

        return {
            total,
            open,
            inProgress,
            resolved,
            resolvedToday,
            createdLastWeek,
            priorityDistribution,
            categoryDistribution,
            avgResponseTime: `${resolutionTime.avgResolutionTime.toFixed(1)} hours`,
            resolutionRate: total > 0 ? `${((resolved / total) * 100).toFixed(1)}%` : '0%',
            dailyResolutionRate: createdLastWeek > 0 ?
                `${((resolvedToday / createdLastWeek) * 100).toFixed(1)}%` : '0%'
        };
    } catch (error) {
        console.error('Error getting ticket statistics:', error);
        return {
            total: 0,
            open: 0,
            inProgress: 0,
            resolved: 0,
            resolvedToday: 0,
            createdLastWeek: 0,
            priorityDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
            categoryDistribution: { TECHNICAL_ISSUE: 0, IT_ASSET: 0 },
            avgResponseTime: '0 hours',
            resolutionRate: '0%',
            dailyResolutionRate: '0%'
        };
    }
};

const getAssetStatisticsData = async () => {
    try {
        const [
            total,
            available,
            assigned,
            repair,
            byCategory,
            byCondition
        ] = await Promise.all([
            Asset.countDocuments({}),
            Asset.countDocuments({ status: 'AVAILABLE', condition: 'EXCELLENT' }),
            Asset.countDocuments({ status: 'ASSIGNED' }),
            Asset.countDocuments({ status: 'REPAIR' }),
            Asset.aggregate([
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]),
            Asset.aggregate([
                { $group: { _id: '$condition', count: { $sum: 1 } } }
            ])
        ]);

        // Calculate utilization and availability rates
        const utilizationRate = total > 0 ? (assigned / total) * 100 : 0;
        const availabilityRate = total > 0 ? (available / total) * 100 : 0;

        // Format category distribution
        const categoryDistribution = {};
        byCategory.forEach(item => {
            categoryDistribution[item._id] = item.count;
        });

        // Format condition distribution
        const conditionDistribution = {};
        byCondition.forEach(item => {
            conditionDistribution[item._id] = item.count;
        });

        return {
            total,
            available,
            assigned,
            repair,
            categoryDistribution,
            conditionDistribution,
            utilizationRate: `${utilizationRate.toFixed(1)}%`,
            availabilityRate: `${availabilityRate.toFixed(1)}%`
        };
    } catch (error) {
        console.error('Error getting asset statistics:', error);
        return {
            total: 0,
            available: 0,
            assigned: 0,
            repair: 0,
            categoryDistribution: {},
            conditionDistribution: {},
            utilizationRate: '0%',
            availabilityRate: '0%'
        };
    }
};

const getUrgentIssues = async (userId) => {
    try {
        // Get high priority tickets
        const highPriorityTickets = await Ticket.find({
            $and: [
                { category: { $in: ['TECHNICAL_ISSUE', 'IT_ASSET'] } },
                { priority: 'HIGH' },
                { status: { $in: ['OPEN', 'IN_PROGRESS'] } },
                {
                    $or: [
                        { forwardedTo: userId },
                        { assignedTo: userId }
                    ]
                }
            ]
        })
            .populate('raisedBy', 'firstName lastName employeeId department')
            .sort({ createdAt: -1 })
            .limit(5);

        // Get assets in repair
        const repairAssets = await Asset.find({
            status: 'REPAIR'
        })
            .populate('assignedTo', 'firstName lastName employeeId')
            .sort({ updatedAt: -1 })
            .limit(5);

        return {
            highPriorityTickets: highPriorityTickets.length,
            repairAssets: repairAssets.length,
            highPriorityTicketList: highPriorityTickets,
            repairAssetList: repairAssets
        };
    } catch (error) {
        console.error('Error getting urgent issues:', error);
        return {
            highPriorityTickets: 0,
            repairAssets: 0,
            highPriorityTicketList: [],
            repairAssetList: []
        };
    }
};

const getAssetHealthStatus = async () => {
    try {
        // Get assets needing attention (fair condition or in repair)
        const assetsNeedingAttention = await Asset.find({
            $or: [
                { condition: 'FAIR' },
                { status: 'REPAIR' }
            ]
        })
            .populate('assignedTo', 'firstName lastName employeeId')
            .sort({ updatedAt: -1 })
            .limit(10);

        // Calculate health score (0-100)
        const totalAssets = await Asset.countDocuments({});
        const excellentAssets = await Asset.countDocuments({ condition: 'EXCELLENT' });
        const healthScore = totalAssets > 0 ? (excellentAssets / totalAssets) * 100 : 100;

        // Get warranty expiring soon (next 30 days)
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
        const warrantyExpiringSoon = await Asset.find({
            warrantyExpiryDate: {
                $gte: new Date(),
                $lte: thirtyDaysFromNow
            }
        })
            .sort({ warrantyExpiryDate: 1 })
            .limit(5);

        return {
            healthScore: `${healthScore.toFixed(1)}%`,
            assetsNeedingAttention: assetsNeedingAttention.length,
            warrantyExpiringSoon: warrantyExpiringSoon.length,
            assetsNeedingAttentionList: assetsNeedingAttention,
            warrantyExpiringSoonList: warrantyExpiringSoon
        };
    } catch (error) {
        console.error('Error getting asset health status:', error);
        return {
            healthScore: '0%',
            assetsNeedingAttention: 0,
            warrantyExpiringSoon: 0,
            assetsNeedingAttentionList: [],
            warrantyExpiringSoonList: []
        };
    }
};