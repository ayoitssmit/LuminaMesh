"use client";

import ShaderBackground from "@/components/ui/shader-background";

const DemoOne = () => {
  return <ShaderBackground />;
};

export { DemoOne };

export default function DemoPage() {
  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <ShaderBackground />
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          color: "#ffffff",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h1
          style={{
            fontSize: "3rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "1rem",
          }}
        >
          ShaderBackground Demo
        </h1>
        <p
          style={{
            fontSize: "1.125rem",
            opacity: 0.7,
            maxWidth: "480px",
          }}
        >
          A WebGL plasma shader rendered in real-time as a full-screen
          background. Black &amp; white theme.
        </p>
      </div>
    </div>
  );
}
