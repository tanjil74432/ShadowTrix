/** Keys mirror the Prisma EventCategory enum (parity is asserted in tests/event-categories.test.ts). */
export const EVENT_CATEGORIES = {
  HACKATHON: { label: "Hackathon", description: "Build a working project against the clock, solo or in a team." },
  DATATHON: { label: "Datathon", description: "Analyze real datasets and present evidence-backed insights." },
  AI_ML: { label: "AI/ML Competition", description: "Train, evaluate and ship models on defined benchmarks." },
  PROGRAMMING_CONTEST: { label: "Programming Contest", description: "Solve algorithmic problems with timed, scored submissions." },
  WORKSHOP: { label: "Workshop", description: "Hands-on sessions led by practitioners." },
  SUMMIT: { label: "Tech Summit", description: "Talks, panels and networking across the community." },
  INNOVATION_CHALLENGE: { label: "Innovation Challenge", description: "Open-ended problem statements and pitch-ready solutions." },
  OTHER: { label: "Other", description: "Events that do not fit the standard formats." },
} as const;

export type EventCategoryKey = keyof typeof EVENT_CATEGORIES;

/** Technology domains for browsing, grouped by theme (not a flat tag cloud). Slugs feed the Events filter in Milestone 5. */
export const FOCUS_AREA_GROUPS = [
  {
    title: "AI & Data",
    areas: [
      { slug: "machine-learning", label: "Machine Learning" },
      { slug: "data-science", label: "Data Science" },
      { slug: "nlp", label: "Natural Language Processing" },
      { slug: "computer-vision", label: "Computer Vision" },
    ],
  },
  {
    title: "Software & Web",
    areas: [
      { slug: "web-development", label: "Web Development" },
      { slug: "mobile", label: "Mobile Apps" },
      { slug: "cloud-devops", label: "Cloud & DevOps" },
      { slug: "open-source", label: "Open Source" },
    ],
  },
  {
    title: "Systems & Security",
    areas: [
      { slug: "cybersecurity", label: "Cybersecurity" },
      { slug: "iot-embedded", label: "IoT & Embedded" },
      { slug: "robotics", label: "Robotics" },
    ],
  },
  {
    title: "Emerging Tech",
    areas: [
      { slug: "blockchain", label: "Blockchain" },
      { slug: "ar-vr", label: "AR & VR" },
      { slug: "quantum", label: "Quantum Computing" },
    ],
  },
] as const;
