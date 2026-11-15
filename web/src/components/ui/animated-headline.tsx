/**
 * Headline whose words fade in one after another using CSS only.
 *
 * Accessibility: the text exists exactly once in the DOM (no visually-hidden duplicate, no per-letter
 * aria tricks), so screen readers announce it once, crawlers index it once and users can select and
 * copy it. Words are separated by real spaces. Under prefers-reduced-motion the animation is
 * skipped (see globals.css) and the text is simply shown. Works without JavaScript.
 */
export function AnimatedHeadline({ text, stepMs = 90 }: { text: string; stepMs?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className="inline-block animate-reveal" style={{ animationDelay: `${i * stepMs}ms` }}>
            {word}
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}
