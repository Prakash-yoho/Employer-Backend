import mongoose, { Schema } from "mongoose";

// Schema for Sibling Details
const siblingSchema = new Schema({
    siblingName: {
        type: String,
    },
    relationship: {
        type: String,
        enum: ['Brother', 'Sister'],
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other'],
    },
    dateOfBirth: {
        type: Date,
    },
    maritalStatus: {
        type: String,
        enum: ['Single', 'Married', 'Divorced', 'Widowed']
    },
    education: String,
    occupation: String,
    companyName: String,
    mobileNumber: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    }
}, { _id: false });

// Schema for Education Details
const educationSchema = new Schema({
    tenthStandard: {
        schoolName: String,
        board: String,
        year: Number,
        percentage: Number
    },
    eleventhStandard: {
        schoolName: String,
        board: String,
        year: Number,
        percentage: Number
    },
    twelfthStandard: {
        schoolName: String,
        board: String,
        year: Number,
        percentage: Number
    },
    higherEducation: {
        highestQualification: String,
        diplomaCompleted: {
            type: Boolean,
            default: false
        },
        diplomaCourse: String,
        diplomaPercentage: Number,
        diplomaGraduationYear: Number,
        diplomaInstitution: String,
        graduationCompleted: {
            type: Boolean,
            default: false
        },
        degree: String,
        graduationYear: Number,
        percentage: Number,
        college: String,
        university: String,
        postGraduationCompleted: {
            type: Boolean,
            default: false
        },
        pgDegree: String,
        pgPercentage: Number,
        pgGraduationYear: Number,
        pgCollege: String,
        pgUniversity: String,
        certificationsAvailable: {
            type: Boolean,
            default: false
        },
        certificationDetails: String
    }
}, { _id: false });

// Schema for Address Details
const addressSchema = new Schema({
    currentAddressLine1: {
        type: String,
    },
    currentAddressLine2: String,
    city: {
        type: String,
    },
    district: {
        type: String,
    },
    state: {
        type: String,
    },
    country: {
        type: String,
    },
    pincode: {
        type: Number,
    },
    landmark: String,
    residenceType: {
        type: String,
        enum: ['Owned', 'Rented', 'Other']
    },
    stayingSince: Date,
    permanentAddressSameAsCurrent: {
        type: Boolean,
    },
    permanentAddressLine1: {
        type: String,
    },
    permanentAddressLine2: String,
    permanentCity: {
        type: String,
    },
    permanentDistrict: {
        type: String,
    },
    permanentState: {
        type: String,
    },
    permanentCountry: {
        type: String,
    },
    permanentPincode: {
        type: Number,
    },
}, { _id: false });

// Schema for Bank Details
const bankDetailsSchema = new Schema({
    bankName: {
        type: String,
    },
    accountNumber: {
        type: String,
    },
    ifscCode: {
        type: String,
        match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC code"]
    },
    pfApplicable: {
        type: Boolean,
        default: true
    },
    uanNumber: String
}, { _id: false });

// Schema for Emergency Contact
const emergencyContactSchema = new Schema({
    name: {
        type: String,
    },
    relationship: {
        type: String,
    },
    mobileNumber: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    },
    address: String
}, { _id: false });

// Main Employee Schema
const employeeSchema = new Schema({
    // SECTION 1: EMPLOYEE BASIC DETAILS
    employeeId: {
        type: String,
        required: true,
        unique: true,
    },
    firstName: {
        type: String,
        required: true,
        trim: true
    },
    lastName: {
        type: String,
        required: true,
        trim: true
    },
    gender: {
        type: String,
        enum: ['Male', 'Female', 'Other'],
    },
    dateOfBirth: {
        type: Date,
    },
    bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
        default: null
    },
    maritalStatus: {
        type: String,
        enum: ['Single', 'Married', 'Divorced', 'Widowed'],
    },
    spouseName: String,
    spouseDateOfBirth: Date,
    spouseOccupation: String,
    nationality: {
        type: String,
    },
    motherTongue: String,
    languagesKnown: [{
        type: String,
        trim: true
    }],
    physicallyDisabled: {
        type: Boolean,
        default: false
    },
    disabilityType: String,
    placeOfBirth: String,
    personalEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        unique: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"]
    },
    officialEmail: {
        type: String,
        lowercase: true,
        trim: true,
        unique: true,
        required: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"]
    },
    officialPassword: {
        type: String,
        required: true
    },
    personalMobile: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    },
    alternateMobile: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    },
    whatsappNumber: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    },
    aadhaarNumber: {
        type: String,
        match: [/^\d{12}$/, "Invalid Aadhaar number"],
    },
    panNumber: {
        type: String,
        match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN number"],
    },
    passportNumber: String,
    drivingLicenseAvailable: {
        type: Boolean,
        default: false
    },
    drivingLicenseNumber: {
        type: String,
    },

    // SECTION 2: ADDRESS DETAILS
    address: addressSchema,

    // Emergency Contact
    emergencyContact: emergencyContactSchema,

    // SECTION 3: FAMILY & SIBLING DETAILS
    fatherName: {
        type: String,
    },
    fatherDateOfBirth: Date,
    fatherOccupation: String,
    fatherMobile: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    },
    motherName: {
        type: String,
    },
    motherDateOfBirth: Date,
    motherOccupation: String,
    motherMobile: {
        type: String,
        match: [/^[6-9]\d{9}$/, "Invalid mobile number"]
    },
    hasSiblings: {
        type: Boolean,
        default: false
    },
    numberOfBrothers: {
        type: Number,
        default: 0,
        min: 0
    },
    numberOfSisters: {
        type: Number,
        default: 0,
        min: 0
    },
    totalSiblings: {
        type: Number,
        default: 0,
        min: 0
    },
    siblings: [siblingSchema],

    // SECTION 4: EDUCATION DETAILS
    education: educationSchema,

    // SECTION 5: EMPLOYMENT HISTORY
    employmentType: {
        type: String,
        enum: ['Fresher', 'Experienced'],
        required: true
    },

    totalExperience: {
        type: Number,
        default: 0
    },

    previousEmployers: [{
        companyName: String,
        designation: String,
        startDate: Date,
        endDate: Date,
    }],

    // SECTION 6: BANK DETAILS
    bankDetails: bankDetailsSchema,

    department: {
        type: String,
        required: true
    },

    designation: {
        type: String,
        required: true
    },

    profileImage: {
        type: String,
        default: null,
        validate: {
            validator: function (v) {
                if (!v) return true;
                return /\.(jpg|jpeg|png)$/i.test(v);
            },
            message: 'Profile image must be a JPG, JPEG, or PNG file'
        }
    },

    profileImageKey: {
        type: String,
        default: null
    },

    // Account Status
    isActive: {
        type: Boolean,
        default: true
    },
    // ✅ KEEP ONLY THIS ONE
    role: {
        type: String,
        enum: ['Employee', 'TL'],
        default: 'Employee'
    },

    status: {
        type: String,
        enum: ['pending', 'in_progress', 'verified'],
        default: 'pending'
    },

    createdBy: {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'EmployerUser'
        },
        userEmail: String,
        role: String,
        createdAt: {
            type: Date,
            default: Date.now
        }
    },
    // TL flag
    isTL: {
        type: Boolean,
        default: false,
        index: true,
    },

    // Which team this employee currently belongs to (only 1 team at a time)
    currentTeam: {
        teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
        teamName: { type: String, default: null },
        joinedAt: { type: Date, default: null },
    },
    // Profile update tracking
    isUpdated: {
        type: Boolean,
        default: false
    },

    updateRequested: {
        type: Boolean,
        default: false,
    },

    updateRequestReason: {
        type: String,
        trim: true,
        default: null
    },

    lastUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmployerUser',
        default: null
    },

    lastUpdatedAt: {
        type: Date,
        default: null
    },



    // Add this INSIDE employeeSchema, before the closing }
    currentSchedule: {
        scheduleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Schedule",
            default: null,
        },
        scheduleGroupId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        scheduleName: {
            type: String,
            default: null,
        },
        phaseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Phase",
            default: null,
        },
        phaseName: {
            type: String,
            default: null,
        },
        fromDate: {
            type: Date,
            default: null,
        },
        toDate: {
            type: Date,
            default: null,
        },
        assignedAt: {
            type: Date,
            default: null,
        },
    },

    // Derived flag — true when currentSchedule is set AND today <= toDate
    isAssigned: {
        type: Boolean,
        default: false,
        index: true,   // <-- lets you do Employee.find({ isAssigned: false }) fast
    },
}, {
    timestamps: true
});

// Remove password from JSON output
employeeSchema.methods.toJSON = function () {
    const user = this.toObject();
    delete user.officialPassword;
    return user;
};


export default mongoose.model("Employee", employeeSchema);