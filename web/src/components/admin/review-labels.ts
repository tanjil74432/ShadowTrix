export const REVIEW_LABEL = { NOT_SUBMITTED: "Not submitted", SUBMITTED: "Awaiting review", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REJECTED: "Rejected" } as const;
export const reviewTone = (s: keyof typeof REVIEW_LABEL) => (s === "APPROVED" ? "good" : s === "REJECTED" ? "bad" : s === "SUBMITTED" ? "warn" : "neutral") as "good" | "bad" | "warn" | "neutral";
