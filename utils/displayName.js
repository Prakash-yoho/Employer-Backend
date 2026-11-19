// utils/displayName.js
//
// Single source of truth for "what name do we print for this person?".
// Rule: the name as per the Aadhaar card wins; if HR / the employee has not
// filled it in yet, fall back to "firstName lastName" exactly as before.

const clean = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export const getDisplayName = (person) => {
    if (!person) return '';
    const aadhaarName = clean(person.nameAsPerAadhaar);
    if (aadhaarName) return aadhaarName;
    return clean(`${clean(person.firstName)} ${clean(person.lastName)}`);
};

export default getDisplayName;
