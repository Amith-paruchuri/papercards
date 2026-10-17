import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PaperCards",
    short_name: "PaperCards",
    description: "Every paper you read, and what you made of it.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3ead8",
    theme_color: "#13305a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
