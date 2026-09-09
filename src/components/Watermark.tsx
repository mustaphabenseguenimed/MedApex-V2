const LABEL = "Med Apex";
const SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='170'><text x='10' y='100' transform='rotate(-30 170 85)' font-family='sans-serif' font-size='14' fill='rgba(120,120,120,0.35)'>${LABEL}</text></svg>`;
const BACKGROUND_IMAGE = `url("data:image/svg+xml,${encodeURIComponent(SVG)}")`;

/**
 * Fixed, semi-transparent, tiled "Med Apex" overlay on protected content.
 * Best-effort like the rest of the content-protection layer: it doesn't and
 * can't prevent a screenshot — nothing on the web layer sees the OS
 * compositor — it's a brand mark, not a per-student trace.
 */
export function Watermark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40"
      style={{ backgroundImage: BACKGROUND_IMAGE, backgroundRepeat: "repeat" }}
    />
  );
}
