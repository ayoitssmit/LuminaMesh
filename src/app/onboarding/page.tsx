"use client";

import { useState, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./onboarding.module.css";

function OnboardingContent() {
  const { update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setError("Username must be at least 2 characters.");
      return;
    }
    if (trimmed.length > 32) {
      setError("Username must be 32 characters or less.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/user/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    setLoading(false);

    if (res.ok) {
      await update({ name: trimmed });
      router.push(callbackUrl);
    } else {
      const data = await res.json();
      setError(data.error || "Failed to save username.");
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.bg} />
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>L</span>
          <span className={styles.logoText}>LuminaMesh</span>
        </div>

        <h1 className={styles.title}>One last step</h1>
        <p className={styles.subtitle}>Choose a username to display on your profile.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <input
            className={styles.input}
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={32}
            autoFocus
            required
          />
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.submitBtn} type="submit" disabled={loading || username.trim().length < 2}>
            {loading ? "Saving..." : "Get Started"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}
