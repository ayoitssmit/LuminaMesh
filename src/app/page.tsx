"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "./landing.module.css";

export default function LandingPage() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await signIn("credentials", {
      email,
      password,
      rememberMe: rememberMe ? "true" : "false",
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Invalid email or password. Make sure you have set a password on your profile.");
    } else {
      router.push("/dashboard");
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    setLoading(true);
    await signIn(provider, { callbackUrl: "/dashboard" });
  };

  return (
    <div className={styles.container}>
      <div className={styles.bg} />
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>L</span>
          <span className={styles.logoText}>LuminaMesh</span>
        </div>
        <p className={styles.tagline}>Peer-to-peer file transfers, reimagined</p>

        {/* OAuth Buttons */}
        <div className={styles.oauthRow}>
          <button
            className={`${styles.oauthBtn} ${styles.googleBtn}`}
            onClick={() => handleOAuth("google")}
            disabled={loading}
          >
            <svg className={styles.oauthIcon} viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <button
            className={`${styles.oauthBtn} ${styles.githubBtn}`}
            onClick={() => handleOAuth("github")}
            disabled={loading}
          >
            <svg className={styles.oauthIcon} viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
            </svg>
            Continue with GitHub
          </button>
        </div>

        <div className={styles.divider}>
          <span className={styles.dividerLine} />
          <span className={styles.dividerText}>or sign in with email</span>
          <span className={styles.dividerLine} />
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === "login" ? styles.tabActive : ""}`}
            onClick={() => { setTab("login"); setError(null); }}
          >
            Log In
          </button>
          <button
            className={`${styles.tab} ${tab === "signup" ? styles.tabActive : ""}`}
            onClick={() => { setTab("signup"); setError(null); }}
          >
            Sign Up
          </button>
        </div>

        {tab === "login" ? (
          <form className={styles.form} onSubmit={handleCredentials}>
            <p className={styles.formHint}>
              Email + password login requires first signing in via Google or GitHub and setting a password on your profile.
            </p>
            <input
              className={styles.input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <label className={styles.rememberRow}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className={styles.checkbox}
              />
              <span>Remember me for 30 days</span>
            </label>
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.submitBtn} type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Log In"}
            </button>
          </form>
        ) : (
          <div className={styles.signupInfo}>
            <p>Create your account by signing in with Google or GitHub above. No separate registration needed — your account is created automatically on first login.</p>
            <p>After signing in, you can set an email + password on your profile for future logins.</p>
          </div>
        )}
      </div>
    </div>
  );
}
