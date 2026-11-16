/** First focusable element on every page. Hidden until focused, then jumps past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="fixed top-3 left-3 z-[100] -translate-y-20 rounded-md bg-accent px-4 py-2.5 font-medium text-on-accent shadow-overlay transition-transform focus:translate-y-0 motion-reduce:transition-none"
    >
      Skip to main content
    </a>
  );
}
