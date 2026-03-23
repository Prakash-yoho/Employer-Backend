import mongoose, { Schema } from "mongoose";

// Schema for assignment history
const assignmentHistorySchema = new Schema({
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        required: true
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        required: true
    },
    assignedDate: {
        type: Date,
        required: true
    },
    returnedDate: {
        type: Date,
        default: null
    },
    notes: {
        type: String,
        trim: true
    }
}, { _id: false });

// Main Asset Schema
const assetSchema = new Schema({
    // BASIC INFO
    assetId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    assetName: {
        type: String,
        required: true,
        trim: true
    },
    category: {
        type: String,
        required: true,
        enum: [
            'LAPTOP', 'DESKTOP', 'CHARGER', 'MONITOR', 'KEYBOARD', 'MOUSE',
            'HEADPHONES', 'MOBILE', 'TABLET', 'SERVER', 'NETWORK',
            'PRINTER', 'SCANNER', 'PROJECTOR', 'OTHER'
        ]
    },
    brand: {
        type: String,
        required: true,
        trim: true
    },
    model: {
        type: String,
        required: true,
        trim: true
    },
    serialNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    // STATUS & CONDITION
    status: {
        type: String,
        required: true,
        enum: ['AVAILABLE', 'ASSIGNED', 'REPAIR'],
        default: 'AVAILABLE'
    },
    condition: {
        type: String,
        required: true,
        enum: ['EXCELLENT', 'FAIR'],
        default: 'EXCELLENT'
    },

    // ADDITIONAL DETAILS
    specifications: {
        type: String,
        trim: true,
        default: null
    },
    notes: {
        type: String,
        trim: true,
        default: null
    },
    purchaseDate: {
        type: Date,
        default: null
    },
    purchaseRate: {
        type: Number,
        default: null
    },
    warrantyExpiryDate: {
        type: Date,
        default: null
    },

    // ASSIGNMENT DETAILS
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Employee',
        default: null
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },
    assignedDate: {
        type: Date,
        default: null
    },

    // ASSIGNMENT HISTORY
    assignmentHistory: [assignmentHistorySchema],

    // TRACKING
    createdAt: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        required: true
    },
    updatedAt: {
        type: Date,
        default: Date.now
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser'
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// In Asset model, update the assignToEmployee method
assetSchema.methods.assignToEmployee = async function (employeeIdOrEmployeeIdString, assignedBy, notes = null) {
    if (!this.canBeAssigned()) {
        throw new Error('Asset cannot be assigned. Check status and condition.');
    }

    if (this.assignedTo) {
        throw new Error('Asset is already assigned to an employee');
    }

    // Determine if we have an ObjectId or employeeId string
    let employeeObjectId;

    // Check if it's a valid ObjectId
    if (mongoose.Types.ObjectId.isValid(employeeIdOrEmployeeIdString)) {
        // It might be an ObjectId
        employeeObjectId = new mongoose.Types.ObjectId(employeeIdOrEmployeeIdString);
    } else {
        // It's an employeeId string, need to find the employee
        const employee = await mongoose.model('Employee').findOne({
            employeeId: employeeIdOrEmployeeIdString
        });

        if (!employee) {
            throw new Error('Employee not found');
        }

        employeeObjectId = employee._id;
    }

    // Add to assignment history
    this.assignmentHistory.push({
        assignedTo: employeeObjectId,
        assignedBy: assignedBy,
        assignedDate: new Date(),
        notes: notes
    });

    // Update current assignment
    this.assignedTo = employeeObjectId;
    this.assignedBy = assignedBy;
    this.assignedDate = new Date();
    this.status = 'ASSIGNED';
    this.updatedBy = assignedBy;
    this.updatedAt = new Date();

    return await this.save();
};

// Method to check if asset can be assigned
assetSchema.methods.canBeAssigned = function () {
    return this.status === 'AVAILABLE' && this.condition === 'EXCELLENT';
};

// Method to assign asset to employee
assetSchema.methods.assignToEmployee = async function (employeeId, assignedBy, notes = null) {
    if (!this.canBeAssigned()) {
        throw new Error('Asset cannot be assigned. Check status and condition.');
    }

    if (this.assignedTo) {
        throw new Error('Asset is already assigned to an employee');
    }

    // Add to assignment history
    this.assignmentHistory.push({
        assignedTo: employeeId,
        assignedBy: assignedBy,
        assignedDate: new Date(),
        notes: notes
    });

    // Update current assignment
    this.assignedTo = employeeId;
    this.assignedBy = assignedBy;
    this.assignedDate = new Date();
    this.status = 'ASSIGNED';
    this.updatedBy = assignedBy;

    return await this.save();
};

// Method to remove assignment
assetSchema.methods.removeAssignment = async function (removedBy, notes = null) {
    if (!this.assignedTo) {
        throw new Error('Asset is not assigned to anyone');
    }

    // Update the last assignment history entry
    const lastAssignment = this.assignmentHistory[this.assignmentHistory.length - 1];
    if (lastAssignment && !lastAssignment.returnedDate) {
        lastAssignment.returnedDate = new Date();
        lastAssignment.notes = notes ? `${lastAssignment.notes || ''} | Returned: ${notes}` : lastAssignment.notes;
    }

    // Clear current assignment
    this.assignedTo = null;
    this.assignedBy = null;
    this.assignedDate = null;
    this.status = 'AVAILABLE';
    this.updatedBy = removedBy;
    this.updatedAt = new Date();

    return await this.save();
};

// Virtual for formatted category
assetSchema.virtual('categoryDisplay').get(function () {
    const categories = {
        'LAPTOP': 'Laptop',
        'DESKTOP': 'Desktop',
        'MONITOR': 'Monitor',
        'CHARGER': 'Charger',
        'KEYBOARD': 'Keyboard',
        'MOUSE': 'Mouse',
        'HEADPHONES': 'Headphones',
        'MOBILE': 'Mobile Phone',
        'TABLET': 'Tablet',
        'SERVER': 'Server',
        'NETWORK': 'Network Equipment',
        'PRINTER': 'Printer',
        'SCANNER': 'Scanner',
        'PROJECTOR': 'Projector',
        'OTHER': 'Other'
    };
    return categories[this.category] || this.category;
});

// Virtual for formatted status
assetSchema.virtual('statusDisplay').get(function () {
    const statuses = {
        'AVAILABLE': 'Available',
        'ASSIGNED': 'Assigned',
        'REPAIR': 'In Repair'
    };
    return statuses[this.status] || this.status;
});

// Virtual for formatted condition
assetSchema.virtual('conditionDisplay').get(function () {
    const conditions = {
        'EXCELLENT': 'Excellent',
        'FAIR': 'Fair'
    };
    return conditions[this.condition] || this.condition;
});

// Indexes for better performance
assetSchema.index({ category: 1 });
assetSchema.index({ status: 1 });
assetSchema.index({ assignedTo: 1 });
assetSchema.index({ brand: 1, model: 1 });
assetSchema.index({ createdAt: -1 });

// Static method to generate asset ID
assetSchema.statics.generateAssetId = async function (category) {
    try {
        const prefix = category ? category.substring(0, 3).toUpperCase() : 'AST';

        // Find the last asset with similar prefix
        const lastAsset = await this.findOne(
            { assetId: new RegExp(`^${prefix}\\d+`) },
            { assetId: 1 },
            { sort: { createdAt: -1 } }
        );

        let newNumber = 1;
        if (lastAsset && lastAsset.assetId) {
            const match = lastAsset.assetId.match(new RegExp(`${prefix}(\\d+)`));
            if (match && match[1]) {
                newNumber = parseInt(match[1]) + 1;
            }
        }

        return `${prefix}${newNumber.toString().padStart(4, '0')}`;
    } catch (error) {
        console.error('Error generating asset ID:', error);
        // Fallback using timestamp
        return `AST${Date.now().toString().slice(-6)}`;
    }
};

assetSchema.methods.softDelete = async function (deletedBy) {
    if (!this.isActive) {
        throw new Error('Asset is already deleted');
    }

    // Do not allow deleting assigned assets
    if (this.assignedTo) {
        throw new Error('Cannot delete an assigned asset');
    }

    this.isActive = false;
    this.updatedBy = deletedBy;
    this.updatedAt = new Date();
    return await this.save();
};

export default mongoose.model("Asset", assetSchema);