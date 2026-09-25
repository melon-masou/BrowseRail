// Shared label-width measurement for popup columns. Used by BOTH the bar
// surface (window sizing + positioning) and the popup surface (rendered column
// width); they MUST agree or the popup window and its content drift apart.
//
// Measures with a hidden DOM span using the same `var(--desktop-font-family)`
// the labels render with, rather than a canvas: canvas measureText can pick a
// different fallback font than the DOM for glyphs missing from the chosen font
// (e.g. non-Latin scripts in a Latin font), under-measuring and clipping labels.
// A real span measures exactly what renders. Each surface (window) has its own
// document, so the span is created per-document on first use.

let measureSpan: HTMLSpanElement | undefined;

export function measureTextWidth(text: string, fontSize: number): number {
  if (!measureSpan) {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.style.position = "absolute";
    span.style.left = "-9999px";
    span.style.top = "0";
    span.style.visibility = "hidden";
    span.style.whiteSpace = "nowrap";
    span.style.pointerEvents = "none";
    span.style.fontFamily = "var(--desktop-font-family)";
    document.body.appendChild(span);
    measureSpan = span;
  }
  measureSpan.style.fontSize = `${fontSize}px`;
  measureSpan.textContent = text;
  return measureSpan.getBoundingClientRect().width;
}
