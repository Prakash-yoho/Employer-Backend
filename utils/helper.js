export function generateOfferCode(offerSendDate, location, jobTitle, lastSequence = 0) {
    // 1. Prefix
    const prefix = "KIAQ";

    // 2. Date => DDMM
    const dateObj = new Date(offerSendDate);
    const day = String(dateObj.getDate()).padStart(2, "0");
    const month = String(dateObj.getMonth() + 1).padStart(2, "0");
    const ddmm = day + month;

    // 3. Sequence counter => 001, 002 ...
    const newSequence = String(lastSequence + 1).padStart(3, "0");

    // 4. Location => First 3 chars uppercase
    const locCode = location.substring(0, 3).toUpperCase();

    // 5. Job title => First letter of each word, uppercase
    const jobCode = jobTitle
        .split(" ")
        .map(word => word[0])
        .join("")
        .toUpperCase();

    // 6. Final code
    return `${prefix}/${ddmm}${newSequence}/${locCode}/${jobCode}`;
}
