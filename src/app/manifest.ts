import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sunday League",
    short_name: "Sunday League",
    description: "Sort the weekly Sunday football — signups, teams and payments.",
    start_url: "/home",
    display: "standalone",
    background_color: "#0b1020",
    theme_color: "#0f1729",
    categories: ["sports", "lifestyle"],
    icons: [
      { src: "/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Maskable: full-bleed so Android can crop to any shape without clipping the ball.
      { src: "/icon-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
