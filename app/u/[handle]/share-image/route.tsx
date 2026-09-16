import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getBuilderDnaExample } from "@/lib/builder-dna-local";
import { clipShareText, founderShareData } from "@/lib/founder-share";
import { getProfileFounderReadOnly } from "@/lib/profile-founder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const font = readFile(
  path.join(
    process.cwd(),
    "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff",
  ),
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ handle: string }> },
) {
  const { handle } = await params;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle))
    return new Response("Not found", { status: 404 });
  const example = await getBuilderDnaExample(handle);
  const founder = example
    ? null
    : await getProfileFounderReadOnly(handle).catch(() => null);
  const data = founderShareData(example, founder);
  if (!data) return new Response("Not found", { status: 404 });
  const fontData = await font;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "44px 56px",
        background: "#0c0d0b",
        color: "#f4f1e8",
        fontFamily: "IBM Plex Sans",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", fontSize: 25 }}>
          Founder{" "}
          <span
            style={{ color: "#d8ff3e", marginLeft: 7, fontStyle: "italic" }}
          >
            Directory
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 18, color: "#9a978c" }}>
          foundersdirectory.app
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "#161714",
          border: "1px solid #2c2e28",
          borderRadius: 24,
          padding: "30px 36px",
          marginTop: 24,
          flex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 88,
              height: 88,
              flexShrink: 0,
              borderRadius: "50%",
              background: "#2c2e28",
              color: "#d8ff3e",
              fontSize: 32,
            }}
          >
            {clipShareText(data.initials, 3)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontSize: data.name.length > 26 ? 40 : 52,
                letterSpacing: -1.5,
                lineHeight: 1.1,
              }}
            >
              {clipShareText(data.name, 43)}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                color: "#9a978c",
                marginTop: 9,
              }}
            >
              @{clipShareText(data.handle, 15)}
            </div>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            color: "#d8ff3e",
            fontSize: data.product ? 44 : 34,
            letterSpacing: -1,
            lineHeight: 1.15,
            marginTop: 27,
          }}
        >
          {clipShareText(data.headline, data.product ? 65 : 115)}
        </div>
        {data.product && (
          <div
            style={{
              display: "flex",
              fontSize: 25,
              marginTop: 15,
              color: "#c8c4b8",
            }}
          >
            Building{" "}
            <span style={{ color: "#f4f1e8", marginLeft: 8 }}>
              {clipShareText(data.product, 45)}
            </span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: "auto",
            paddingTop: 24,
          }}
        >
          {data.tags.map((tag) => (
            <div
              key={tag}
              style={{
                display: "flex",
                border: "1px solid #414438",
                borderRadius: 40,
                padding: "8px 15px",
                fontSize: 18,
                color: "#c8c4b8",
              }}
            >
              {clipShareText(tag, 28)}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 22,
          fontSize: 16,
          color: "#9a978c",
        }}
      >
        <div style={{ display: "flex" }}>{clipShareText(data.note, 64)}</div>
        <div style={{ display: "flex", color: "#d8ff3e" }}>
          Meet the builder &gt;
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "IBM Plex Sans",
          data: fontData.buffer.slice(
            fontData.byteOffset,
            fontData.byteOffset + fontData.byteLength,
          ) as ArrayBuffer,
          weight: 700,
          style: "normal",
        },
      ],
      headers: {
        "Cache-Control":
          process.env.BUILDER_DNA_PREVIEW === "1"
            ? "no-store"
            : "public, max-age=300, s-maxage=3600",
      },
    },
  );
}
