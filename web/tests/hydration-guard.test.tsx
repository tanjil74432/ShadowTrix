import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

import { ApiButton } from "@/components/common/api-button";
import { RegistrationPanel } from "@/components/event/registration-panel";

/**
 * A server-rendered action button must be DISABLED in the HTML the server sends: a tap before React has attached its handlers would be
 * lost silently (slow phones, busy machines). The browser suites click these buttons and only succeed because Playwright waits for
 * the button to become enabled, which happens when hydration completes.
 */
describe("action buttons are disabled in the server-rendered HTML (no lost taps before hydration)", () => {
  const buttonOf = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0] ?? "";

  it("Register for this event / Join the waiting list", () => {
    for (const [full, label] of [[false, "Register for this event"], [true, "Join the waiting list"]] as const) {
      const html = renderToString(<RegistrationPanel eventId="e" view={{ kind: "open", full }} />);
      const b = buttonOf(html, label);
      expect(b, label).not.toBe("");
      expect(b).toMatch(/\sdisabled(=""|\s|>)/);
      expect(b).toMatch(/aria-disabled="true"/);
    }
  });

  it("Cancel my registration", () => {
    const html = renderToString(<RegistrationPanel eventId="e" view={{ kind: "registered", status: "CONFIRMED", canCancel: true }} />);
    expect(buttonOf(html, "Cancel my registration")).toMatch(/\sdisabled(=""|\s|>)/);
  });

  it("the shared ApiButton (remove file, publish, cancel, and every other API action)", () => {
    const html = renderToString(<ApiButton url="/api/v1/x">Do it</ApiButton>);
    expect(buttonOf(html, "Do it")).toMatch(/\sdisabled(=""|\s|>)/);
  });

  it("links are not affected: a login link is still a plain link", () => {
    const html = renderToString(<RegistrationPanel eventId="e" view={{ kind: "anonymous", loginHref: "/login" }} />);
    expect(html).toContain('href="/login"');
    expect(/<a[^>]*\sdisabled(=""|\s|>)/.test(html)).toBe(false); // an attribute, not a Tailwind "disabled:" class
  });
});
