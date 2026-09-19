import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FounderDnaResult } from "./founder-dna";
import { clipShareText } from "./founder-share";
import { fitShareName, fitShareRoast } from "./founder-share-layout";

export async function respondFounderShareImage(
  request: Request,
  result: FounderDnaResult,
): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (result.status !== "ready")
    return new Response(
      result.status === "unavailable"
        ? "Profile temporarily unavailable"
        : "Not found",
      { status: result.status === "unavailable" ? 503 : 404, headers },
    );
  const profile = result.profile;
  const revision = new URL(request.url).searchParams.get("revision");
  if (revision !== null && revision !== profile.revision)
    return new Response("Not found", { status: 404, headers });
  const font = await readFile(
    path.join(
      process.cwd(),
      "node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff",
    ),
  );
  const roast = fitShareRoast(profile.portrait.roast.lines[0].text, font);
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
          fontSize: 22,
          color: "#b7b6ad",
        }}
      >
        <span>Founder Directory</span>
        <span>THE FRIENDLY ROAST</span>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: roast.fontSize,
          flexDirection: "column",
          lineHeight: 1.13,
          letterSpacing: -1.5,
          color: "#d8ff3e",
          flexShrink: 0,
        }}
      >
        {roast.lines.map((line, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              whiteSpace: "pre",
              height: roast.lineHeight,
            }}
          >
            {line}
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            width: 640,
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 68,
              height: 68,
              borderRadius: 34,
              background: "#26291f",
              color: "#d8ff3e",
              fontSize: 25,
              flexShrink: 0,
            }}
          >
            {clipShareText(profile.name, 40, profile.handle)
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 5,
              width: 535,
            }}
          >
            <span style={{ fontSize: 26 }}>
              {fitShareName(profile.name, font, `@${profile.handle}`)}
            </span>
            <span style={{ fontSize: 21, color: "#b7b6ad" }}>
              @{profile.handle}
            </span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 7,
            fontSize: 18,
            flexShrink: 0,
          }}
        >
          <span>
            {roast.truncated
              ? "Full roast and connections on the profile."
              : "Meet the founder. Find your connections."}
          </span>
          <span style={{ color: "#d8ff3e" }}>foundersdirectory.app</span>
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "IBM Plex Sans",
          data: font.buffer.slice(
            font.byteOffset,
            font.byteOffset + font.byteLength,
          ) as ArrayBuffer,
          weight: 700,
          style: "normal",
        },
      ],
      headers,
    },
  );
}
