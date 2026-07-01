// cron/appraisalEffectiveJob.js
import Employee from "../model/Employee.js";

/**
 * Called by the 00:05 IST cron in server.js.
 * Finds all pending appraisals whose effectiveDate has arrived,
 * updates annualSalary, and marks them isEffective: true.
 */
export const applyEffectiveAppraisals = async () => {
    console.log("[AppraisalCron] Running appraisal effective-date check…");

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const employees = await Employee.find({
            isActive: true,
            appraisals: {
                $elemMatch: {
                    isEffective: false,
                    effectiveDate: { $lte: today },
                },
            },
        });

        if (employees.length === 0) {
            console.log("[AppraisalCron] No appraisals to apply today.");
            return;
        }

        let appliedCount = 0;

        for (const employee of employees) {
            const dueAppraisals = employee.appraisals
                .filter(
                    (a) =>
                        !a.isEffective &&
                        new Date(a.effectiveDate).setHours(0, 0, 0, 0) <= today.getTime()
                )
                .sort((a, b) => new Date(a.effectiveDate) - new Date(b.effectiveDate));

            if (dueAppraisals.length === 0) continue;

            // Latest due appraisal wins for annualSalary
            const latestDue = dueAppraisals[dueAppraisals.length - 1];

            // Mark all due ones as applied
            const dueIds = dueAppraisals.map((a) => a._id.toString());
            employee.appraisals.forEach((a) => {
                if (dueIds.includes(a._id.toString())) {
                    a.isEffective = true;
                }
            });

            employee.annualSalary  = latestDue.newAnnualSalary;
            employee.lastUpdatedAt = new Date();

            await employee.save();
            appliedCount++;

            console.log(
                `[AppraisalCron] Applied → ${employee.firstName} ${employee.lastName} ` +
                `(${employee.employeeId}) annualSalary = ${latestDue.newAnnualSalary}`
            );
        }

        console.log(`[AppraisalCron] Done. Applied for ${appliedCount} employee(s).`);
    } catch (err) {
        console.error("[AppraisalCron] Error:", err.message);
    }
};