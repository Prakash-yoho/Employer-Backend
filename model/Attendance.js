import  mongoose,{Schema} from "mongoose";

const locationSchema = new Schema({
  latitude:  { type: Number, default: null },
  longitude: { type: Number, default: null },
  accuracy:  { type: Number, default: null },
}, { _id: false });

const breakSchema = new Schema({
  start:         { type: String, default: null },   // HH:mm:ss
  end:           { type: String, default: null },   // HH:mm:ss
  startImage:    { type: String, default: null },   // S3 URL at break start
  endImage:      { type: String, default: null },   // S3 URL at break end
  startLocation: { type: locationSchema, default: null },
  endLocation:   { type: locationSchema, default: null },
}, { _id: false });

const attendanceSchema = new Schema({
  employeeId: { type: String, required: true },
  date:       { type: String, required: true },     // YYYY-MM-DD

  clockIn:         { type: String, default: null }, // HH:mm:ss
  clockInImage:    { type: String, default: null }, // S3 URL
  clockInLocation: { type: locationSchema, default: null },

  breaks: { type: [breakSchema], default: [] },

  clockOut:         { type: String, default: null },
  clockOutImage:    { type: String, default: null },
  clockOutLocation: { type: locationSchema, default: null },
}, { timestamps: true });

export default mongoose.model("Attendance", attendanceSchema);