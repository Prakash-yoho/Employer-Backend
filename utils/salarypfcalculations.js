export function calculateSalaryFromCTC(ctcMonthly) {
    // Basic = CTC / 2.5
    const basic = ctcMonthly / 2.5;

    const hra = basic * 0.50;          // 50%
    const conveyance = basic * 0.25;   // 25%
    const medical = basic * 0.05;      // 5%
    const lta = basic * 0.05;          // 5%
    const performance = basic * 0.10;  // 10%

    // PF contributions
    const pfEmployee = basic * 0.12;
    const pfEmployer = basic * 0.12;

    // Gratuity
    const gratuity = basic * 0.0481;

    // Earnings required to maintain CTC formula
    const totalEarnings = ctcMonthly - pfEmployer - gratuity;

    // Balancing figure
    const special = basic * 0.2619;

    // Helper function to format numbers to 2 decimals (as string)
    const format2 = (num) => num.toFixed(2);

    const monthly = {
        basic: format2(basic),
        hra: format2(hra),
        conveyance: format2(conveyance),
        medical: format2(medical),
        lta: format2(lta),
        performance: format2(performance),
        special: format2(special),
        totalEarnings: format2(totalEarnings),
        pfEmployee: format2(pfEmployee),
        pfEmployer: format2(pfEmployer),
        gratuity: format2(gratuity),
        ctc: format2(ctcMonthly),
    };

    // Annual = monthly × 12, rounded to 2 decimals
    const annual = {
        basic: format2(basic * 12),
        hra: format2(hra * 12),
        conveyance: format2(conveyance * 12),
        medical: format2(medical * 12),
        lta: format2(lta * 12),
        performance: format2(performance * 12),
        special: format2(special * 12),
        totalEarnings: format2(totalEarnings * 12),
        pfEmployee: format2(pfEmployee * 12),
        pfEmployer: format2(pfEmployer * 12),
        gratuity: format2(gratuity * 12),
        ctc: format2(ctcMonthly * 12),
    };

    return { monthly, annual };
}
