import mongoose from 'mongoose';
import Asset from '../../model/Asset.js';
import Employee from '../../model/Employee.js';
import NotificationService from '../../services/notificationService.js';
import {
    createAssetSchema,
    updateAssetSchema,
    assignAssetSchema,
    removeAssignmentSchema,
    getAssetsQuerySchema
} from '../../validations/Employer/assetValidation.js';

// Create new asset (IT only)
export const createAsset = async (req, res) => {
    try {
        // Check if user has permission
        if (req.user.role !== 'EMPLOYER_IT') {
            return res.status(403).json({
                success: false,
                message: 'Only IT Support can create assets'
            });
        }

        // Validate request body
        const { error, value } = createAssetSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Check if serial number already exists
        const existingAsset = await Asset.findOne({ serialNumber: value?.serialNumber });
        if (existingAsset) {
            return res.status(400).json({
                success: false,
                message: 'Serial number already exists'
            });
        }

        // Generate asset ID
        const assetId = await Asset.generateAssetId(value?.category);

        // Create asset
        const asset = new Asset({
            assetId,
            ...value,
            createdBy: req.user._id
        });

        await asset.save();

        // Populate createdBy details
        await asset.populate('createdBy', 'firstName lastName email role');

        return res.status(201).json({
            success: true,
            message: 'Asset created successfully',
            data: {
                asset: asset.toObject()
            }
        });
    } catch (error) {
        console.error('Create asset error:', error);

        if (error.code === 11000) {
            if (error.keyPattern.assetId) {
                return res.status(400).json({
                    success: false,
                    message: 'Asset ID already exists'
                });
            }
            if (error.keyPattern.serialNumber) {
                return res.status(400).json({
                    success: false,
                    message: 'Serial number already exists'
                });
            }
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update asset (IT only)
export const updateAsset = async (req, res) => {
    try {
        // Check if user has permission
        if (req.user.role !== 'EMPLOYER_IT') {
            return res.status(403).json({
                success: false,
                message: 'Only IT Support can update assets'
            });
        }

        const { assetId } = req.params;

        // Validate request body
        const { error, value } = updateAssetSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        // Find asset
        const asset = await Asset.findOne({ assetId });
        if (!asset) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        // Check if updating serial number to an existing one
        if (value?.serialNumber && value?.serialNumber !== asset.serialNumber) {
            const existingAsset = await Asset.findOne({
                serialNumber: value.serialNumber,
                _id: { $ne: asset._id }
            });
            if (existingAsset) {
                return res.status(400).json({
                    success: false,
                    message: 'Serial number already exists'
                });
            }
        }

        // Update asset
        Object.keys(value).forEach(key => {
            if (value[key] !== undefined) {
                asset[key] = value[key];
            }
        });

        asset.updatedBy = req.user._id;
        await asset.save();

        // Populate details
        await asset.populate('createdBy', 'firstName lastName email role');
        await asset.populate('updatedBy', 'firstName lastName email role');
        await asset.populate('assignedTo', 'firstName lastName employeeId department officialEmail');
        await asset.populate('assignedBy', 'firstName lastName email role');

        return res.status(200).json({
            success: true,
            message: 'Asset updated successfully',
            data: {
                asset: asset.toObject()
            }
        });
    } catch (error) {
        console.error('Update asset error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all assets (Admin, HR, IT)
export const getAllAssets = async (req, res) => {
    try {
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only ADMIN, HR, or IT Support can view assets'
            });
        }
        const { error, value } = getAssetsQuerySchema.validate(req.query);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(d => d.message)
            });
        }

        const {
            page,
            limit,
            category,
            status,
            condition,
            brand,
            search,
            sortBy,
            sortOrder
        } = value;

        const skip = (page - 1) * limit;

        const baseFilter = { isActive: true };
        const listFilter = { ...baseFilter };

        if (category) listFilter.category = category;
        if (status) listFilter.status = status;
        if (condition) listFilter.condition = condition;
        if (brand) listFilter.brand = { $regex: brand, $options: 'i' };

        if (search) {
            listFilter.$or = [
                { assetId: { $regex: search, $options: 'i' } },
                { assetName: { $regex: search, $options: 'i' } },
                { brand: { $regex: search, $options: 'i' } },
                { model: { $regex: search, $options: 'i' } },
                { serialNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
        const [assets, totalItems] = await Promise.all([
            Asset.find(listFilter)
                .populate('createdBy', 'firstName lastName email role')
                .populate('updatedBy', 'firstName lastName email role')
                .populate('assignedTo', 'firstName lastName employeeId department designation officialEmail')
                .populate('assignedBy', 'firstName lastName email role')
                .populate('assignmentHistory.assignedTo', 'firstName lastName employeeId officialEmail')
                .populate('assignmentHistory.assignedBy', 'firstName lastName email')
                .sort(sort)
                .skip(skip)
                .limit(limit),
            Asset.countDocuments(listFilter)
        ]);

        const totalPages = Math.ceil(totalItems / limit);
        const statsAggregation = await Asset.aggregate([
            { $match: baseFilter },
            {
                $facet: {
                    total: [{ $count: 'count' }],
                    statusStats: [
                        { $group: { _id: '$status', count: { $sum: 1 } } }
                    ],
                    conditionStats: [
                        { $group: { _id: '$condition', count: { $sum: 1 } } }
                    ],
                    byCategory: [
                        { $group: { _id: '$category', count: { $sum: 1 } } },
                        { $sort: { count: -1 } }
                    ]
                }
            }
        ]);

        const statsData = statsAggregation[0] || {};

        const stats = {
            total: statsData.total?.[0]?.count || 0,
            available: statsData.statusStats?.find(s => s._id === 'AVAILABLE')?.count || 0,
            assigned: statsData.statusStats?.find(s => s._id === 'ASSIGNED')?.count || 0,
            repair: statsData.statusStats?.find(s => s._id === 'REPAIR')?.count || 0,
            excellent: statsData.conditionStats?.find(c => c._id === 'EXCELLENT')?.count || 0,
            fair: statsData.conditionStats?.find(c => c._id === 'FAIR')?.count || 0,
            byCategory: statsData.byCategory || []
        };

        return res.status(200).json({
            success: true,
            message: 'Assets retrieved successfully',
            data: {
                assets,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                },
                stats
            }
        });

    } catch (error) {
        console.error('Get all assets error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// Get asset by ID (Admin, HR, IT)
export const getAssetById = async (req, res) => {
    try {
        // Check if user has permission
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only ADMIN, HR, or IT Support can view assets'
            });
        }

        const { assetId } = req.params;

        // Find asset
        const asset = await Asset.findOne({ assetId, isActive: true })
            .populate('createdBy', 'firstName lastName email role')
            .populate('updatedBy', 'firstName lastName email role')
            .populate('assignedTo', 'firstName lastName employeeId department designation officialEmail')
            .populate('assignedBy', 'firstName lastName email role')
            .populate('assignmentHistory.assignedTo', 'firstName lastName employeeId department officialEmail')
            .populate('assignmentHistory.assignedBy', 'firstName lastName email role');

        if (!asset) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Asset retrieved successfully',
            data: {
                asset: asset.toObject()
            }
        });
    } catch (error) {
        console.error('Get asset by ID error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Assign asset to employee (Admin, HR, IT)
export const assignAssetToEmployee = async (req, res) => {
    try {
        // Check if user has permission
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN, HR, or IT Support can assign assets'
            });
        }

        const { assetId } = req.params;

        // Validate request body
        const { error, value } = assignAssetSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { employeeId, notes } = value;

        // Find asset
        const asset = await Asset.findOne({ assetId, isActive: true });
        if (!asset) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        // Check if asset can be assigned
        if (!asset.canBeAssigned()) {
            return res.status(400).json({
                success: false,
                message: `Asset cannot be assigned. Status: ${asset.status}, Condition: ${asset.condition}`
            });
        }

        // Check if asset is already assigned
        if (asset.assignedTo) {
            return res.status(400).json({
                success: false,
                message: 'Asset is already assigned to an employee'
            });
        }

        // Check if employee exists
        const employee = await Employee.findOne({ employeeId: employeeId });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: 'Employee not found'
            });
        }

        // Assign asset to employee
        await asset.assignToEmployee(employee._id, req.user._id, notes);

        // Notify employee about asset assignment
        await NotificationService.createAssetAssignedNotification(
            asset,
            employee,
            req.user
        );

        // Populate details
        await asset.populate('assignedTo', 'firstName lastName employeeId department designation');
        await asset.populate('assignedBy', 'firstName lastName email role');
        await asset.populate('assignmentHistory.assignedTo', 'firstName lastName employeeId');

        return res.status(200).json({
            success: true,
            message: 'Asset assigned successfully',
            data: {
                asset: asset.toObject(),
                employee: {
                    employeeId: employee.employeeId,
                    name: `${employee.firstName} ${employee.lastName}`,
                    department: employee.department,
                    designation: employee.designation
                }
            }
        });
    } catch (error) {
        console.error('Assign asset error:', error);

        // Handle validation errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: Object.values(error.errors).map(err => err.message)
            });
        }

        // Handle custom errors from assignToEmployee method
        if (error.message.includes('Asset cannot be assigned') ||
            error.message.includes('Asset is already assigned')) {
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Remove asset assignment (Admin, HR, IT)
export const removeAssetAssignment = async (req, res) => {
    try {
        // Check if user has permission
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN, HR, or IT Support can remove asset assignments'
            });
        }

        const { assetId } = req.params;

        // Validate request body
        const { error, value } = removeAssignmentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: error.details.map(detail => detail.message)
            });
        }

        const { notes } = value;

        // Find asset
        const asset = await Asset.findOne({ assetId });
        if (!asset) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }

        // Check if asset is assigned
        if (!asset.assignedTo) {
            return res.status(400).json({
                success: false,
                message: 'Asset is not assigned to anyone'
            });
        }

        // Get employee details before removing assignment
        const employee = await Employee.findById(asset.assignedTo);

        // Remove assignment
        await asset.removeAssignment(req.user._id, notes);

        // Notify employee about asset unassignment
        await NotificationService.createAssetUnassignedNotification(
            asset,
            employee,
            req.user
        );

        // Populate details
        await asset.populate('updatedBy', 'firstName lastName email role');

        return res.status(200).json({
            success: true,
            message: 'Asset assignment removed successfully',
            data: {
                asset: asset.toObject(),
                previousEmployee: employee ? {
                    employeeId: employee.employeeId,
                    name: `${employee.firstName} ${employee.lastName}`,
                    department: employee.department,
                    designation: employee.designation
                } : null
            }
        });
    } catch (error) {
        console.error('Remove asset assignment error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get assets assigned to current employee (for employee view)
export const getMyAssets = async (req, res) => {
    try {
        // Find assets assigned to this employee
        const assets = await Asset.find({ assignedTo: req.user._id })
            .populate('assignedBy', 'firstName lastName email role')
            .sort({ assignedDate: -1 });

        return res.status(200).json({
            success: true,
            message: 'Your assets retrieved successfully',
            data: {
                assets,
                count: assets.length
            }
        });
    } catch (error) {
        console.error('Get my assets error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get asset statistics (Admin, HR, IT)
export const getAssetStatistics = async (req, res) => {
    try {
        // Check if user has permission
        const allowedRoles = ['EMPLOYER_ADMIN', 'EMPLOYER_HR', 'EMPLOYER_IT'];
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only ADMIN, HR, or IT Support can view asset statistics'
            });
        }

        const [
            totalAssets,
            availableAssets,
            assignedAssets,
            repairAssets,
            excellentCondition,
            fairCondition,
            categoryDistribution,
            recentlyAssigned,
            topEmployees
        ] = await Promise.all([
            Asset.countDocuments({}),
            Asset.countDocuments({ status: 'AVAILABLE', condition: 'EXCELLENT' }),
            Asset.countDocuments({ status: 'ASSIGNED' }),
            Asset.countDocuments({ status: 'REPAIR' }),
            Asset.countDocuments({ condition: 'EXCELLENT' }),
            Asset.countDocuments({ condition: 'FAIR' }),
            Asset.aggregate([
                { $group: { _id: '$category', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 }
            ]),
            Asset.find({ status: 'ASSIGNED' })
                .populate('assignedTo', 'firstName lastName employeeId department')
                .populate('assignedBy', 'firstName lastName email')
                .sort({ assignedDate: -1 })
                .limit(5),
            Asset.aggregate([
                { $match: { assignedTo: { $ne: null } } },
                { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 },
                {
                    $lookup: {
                        from: 'employees',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'employee'
                    }
                },
                { $unwind: '$employee' },
                {
                    $project: {
                        employeeId: '$employee.employeeId',
                        name: { $concat: ['$employee.firstName', ' ', '$employee.lastName'] },
                        department: '$employee.department',
                        assetCount: '$count'
                    }
                }
            ])
        ]);

        const stats = {
            overview: {
                total: totalAssets,
                available: availableAssets,
                assigned: assignedAssets,
                repair: repairAssets,
                utilizationRate: totalAssets > 0 ? ((assignedAssets / totalAssets) * 100).toFixed(1) + '%' : '0%'
            },
            condition: {
                excellent: excellentCondition,
                fair: fairCondition
            },
            categoryDistribution,
            recentAssignments: recentlyAssigned,
            topEmployees
        };

        return res.status(200).json({
            success: true,
            message: 'Asset statistics retrieved successfully',
            data: stats
        });
    } catch (error) {
        console.error('Get asset statistics error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Hard delete asset (IT only)
export const HardDeleteAsset = async (req, res) => {
    try {
        if (req.user.role !== 'EMPLOYER_IT') {
            return res.status(403).json({
                success: false,
                message: 'Only IT Support can delete assets'
            });
        }

        const { assetId } = req.params;
        const asset = await Asset.findOne({ assetId });

        if (!asset) {
            return res.status(404).json({
                success: false,
                message: 'Asset not found'
            });
        }
        if (asset.assignedTo) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete an assigned asset'
            });
        }

        await Asset.deleteOne({ _id: asset._id });

        return res.status(200).json({
            success: true,
            message: 'Asset permanently deleted'
        });

    } catch (error) {
        console.error('Hard delete asset error:', error);
        return res.status(500).json({
            success: false,
            message: 'Server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


