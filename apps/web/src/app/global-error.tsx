"use client";

import { useEffect } from "react";
import { Aperture } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    // No ThemeProvider here (globals.css/tokens aren't loaded outside the root
    // layout), so nothing mutates <html> client-side — no hydration mismatch to
    // suppress, unlike the root layout.
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "1.5rem",
          textAlign: "center",
          backgroundColor: "#0a0a0a",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <Aperture
          width={28}
          height={28}
          strokeWidth={1.6}
          color="#a1a1aa"
          aria-hidden
        />

        <div
          aria-hidden
          style={{
            fontSize: "7rem",
            lineHeight: 1,
            fontWeight: 600,
            letterSpacing: "-0.05em",
            color: "rgba(250,250,250,0.12)",
          }}
        >
          500
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            maxWidth: "28rem",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Lumio hit a snag.
          </h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#a1a1aa" }}>
            Something went wrong on our end. Reloading usually clears it up.
          </p>
        </div>

        <button
          onClick={reset}
          style={{
            marginTop: "0.5rem",
            height: "2.5rem",
            padding: "0 1.25rem",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            backgroundColor: "#fafafa",
            color: "#0a0a0a",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
