// Generates the PWA / home-screen icon set from a single vector design.
// Run with: node scripts/gen-icons.mjs
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const SIZE = 512;
const C = SIZE / 2; // center
const BALL_R = 150;

// --- geometry helpers ---------------------------------------------------
const rad = (deg) => (deg * Math.PI) / 180;
function polygon(cx, cy, r, rotDeg = 0, n = 5) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rad(-90 + rotDeg + (360 / n) * i);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

const SEAM = "#16310b";
// Classic soccer-ball: white sphere, central pentagon, seams to rim pentagons.
function ball() {
  const seams = [];
  const rimPentagons = [];
  for (let i = 0; i < 5; i++) {
    const a = rad(-90 + i * 72);
    const vx = C + 46 * Math.cos(a); // central pentagon vertex
    const vy = C + 46 * Math.sin(a);
    const ox = C + 140 * Math.cos(a); // rim
    const oy = C + 140 * Math.sin(a);
    seams.push(
      `<line x1="${vx.toFixed(1)}" y1="${vy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="${SEAM}" stroke-width="9" stroke-linecap="round"/>`,
    );
    const px = C + 116 * Math.cos(a);
    const py = C + 116 * Math.sin(a);
    rimPentagons.push(
      `<polygon points="${polygon(px, py, 30, i * 72 + 36)}" fill="${SEAM}"/>`,
    );
  }
  return `
    <g clip-path="url(#ballclip)">
      <circle cx="${C}" cy="${C}" r="${BALL_R}" fill="url(#ballgrad)"/>
      ${rimPentagons.join("\n")}
      ${seams.join("\n")}
      <polygon points="${polygon(C, C, 46, 0)}" fill="${SEAM}"/>
    </g>
    <circle cx="${C}" cy="${C}" r="${BALL_R}" fill="none" stroke="${SEAM}" stroke-width="4" stroke-opacity="0.35"/>`;
}

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#a3e635"/>
      <stop offset="0.55" stop-color="#65a30d"/>
      <stop offset="1" stop-color="#3f6212"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.25" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="0.6" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ballgrad" cx="0.4" cy="0.35" r="0.75">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e7f3d4"/>
    </radialGradient>
    <clipPath id="ballclip"><circle cx="${C}" cy="${C}" r="${BALL_R}"/></clipPath>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#1a2e05" flood-opacity="0.35"/>
    </filter>
  </defs>`;

// rounded = transparent outside the rounded square (manifest "any" + favicon)
// square  = full-bleed (apple-touch-icon + maskable safe zone)
function svg({ rounded }) {
  const bg = rounded
    ? `<rect width="${SIZE}" height="${SIZE}" rx="112" fill="url(#bg)"/><rect width="${SIZE}" height="${SIZE}" rx="112" fill="url(#glow)"/>`
    : `<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/><rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    ${defs}
    ${bg}
    <g filter="url(#shadow)">${ball()}</g>
  </svg>`;
}

const rounded = Buffer.from(svg({ rounded: true }));
const square = Buffer.from(svg({ rounded: false }));

const out = async (buf, size, file) =>
  sharp(buf).resize(size, size).png().toFile(`public/${file}`);

await Promise.all([
  out(rounded, 192, "icon-192x192.png"),
  out(rounded, 512, "icon-512x512.png"),
  out(rounded, 192, "icon.png"), // used by push notifications
  out(square, 512, "icon-maskable-512x512.png"),
  out(square, 180, "apple-touch-icon.png"),
]);

// Keep an editable source of truth in the repo.
writeFileSync("public/icon-source.svg", svg({ rounded: true }));
console.log("✓ icons generated");
