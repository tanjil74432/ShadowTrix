/** Public site identity. Safe to import anywhere (no secrets, no database). */
export const site = {
  name: "ShadowTrix",
  tagline: "Enter the Matrix of Innovation.",
  description:
    "Discover competitions, connect with innovators, and turn your ideas into reality. Hackathons, datathons, AI/ML competitions, programming contests, workshops and tech summits on one platform.",
  operator: "Team EU Shadow",
  /** Canonical origin. Set APP_URL per environment; falls back to local development. */
  url: process.env.APP_URL ?? "http://localhost:3010",
  logo: { src: "/brand/logo-mark.png", width: 679, height: 679, alt: "ShadowTrix logo: a network globe inside a hexagon" },
} as const;

export const nav = {
  primary: [
    { label: "Events", href: "/events" },
    { label: "Community", href: "/community" },
    { label: "Contact", href: "/contact" },
  ],
  about: {
    label: "About Us",
    items: [
      { label: "About ShadowTrix", href: "/about", description: "Our mission and how the platform works" },
      { label: "Our Team", href: "/about/team", description: "Leadership board and working teams" },
    ],
  },
  account: { login: { label: "Login", href: "/login" }, register: { label: "Register", href: "/register" } },
} as const;
