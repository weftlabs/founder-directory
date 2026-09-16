import { ImageResponse } from "next/og";

export const alt = "Founder Directory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0c0d0b",
        padding: 72,
        color: "#f4f1e8",
      }}
    >
      <div style={{ fontSize: 28, color: "#9a978c" }}>
        foundersdirectory.app
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -2,
            display: "flex",
          }}
        >
          Founder{" "}
          <span
            style={{ color: "#d8ff3e", fontStyle: "italic", marginLeft: 16 }}
          >
            Directory
          </span>
        </div>
        <div style={{ fontSize: 28, color: "#9a978c", marginTop: 20 }}>
          Discover founders and what they are building.
        </div>
      </div>
      <div style={{ fontSize: 22, color: "#9a978c" }}>
        Built by Nittarab · Weft Labs
      </div>
    </div>,
    { ...size },
  );
}
