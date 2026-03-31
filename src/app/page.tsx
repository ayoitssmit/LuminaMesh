"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./landing.module.css";
import ShaderBackground from "@/components/ui/shader-background";

/* ── Scroll-triggered fade-in hook ── */
function useScrollFade() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true); },
      { threshold: 0.15 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, className: `${styles.fadeUp} ${visible ? styles.fadeUpVisible : ""}` };
}

function LandingContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  // "hero" | "login" | "signup"
  const [view, setView] = useState<"hero" | "login" | "signup">("hero");
  const [animating, setAnimating] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [signupConfirm, setSignupConfirm] = useState("");
  const [showSignupConfirm, setShowSignupConfirm] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const router = useRouter();

  /* Speed bars animation */
  const speedRef = useRef<HTMLDivElement>(null);
  const [speedVisible, setSpeedVisible] = useState(false);
  useEffect(() => {
    const node = speedRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setSpeedVisible(true); },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const switchTo = (next: "hero" | "login" | "signup") => {
    if (animating || next === view) return;
    setAnimating(true);
    setTimeout(() => {
      setView(next);
      setAnimating(false);
    }, 220);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && view !== "hero") switchTo("hero");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);
    const res = await signIn("credentials", {
      email: loginEmail,
      password: loginPassword,
      rememberMe: rememberMe ? "true" : "false",
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setLoginError("Invalid credentials. Try Google/GitHub if you haven't set a password.");
    } else {
      router.push(callbackUrl);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError(null);
    if (signupPassword.length < 8) {
      setSignupError("Password must be at least 8 characters.");
      return;
    }
    if (signupPassword !== signupConfirm) {
      setSignupError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: signupEmail, password: signupPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSignupError(data.error || "Registration failed.");
      setLoading(false);
      return;
    }
    const signInRes = await signIn("credentials", {
      email: signupEmail,
      password: signupPassword,
      redirect: false,
    });
    setLoading(false);
    if (signInRes?.error) {
      setSignupError("Account created but auto-login failed. Please log in manually.");
    } else {
      const onboardingUrl =
        callbackUrl && callbackUrl !== "/dashboard"
          ? `/onboarding?callbackUrl=${encodeURIComponent(callbackUrl)}`
          : "/onboarding";
      router.push(onboardingUrl);
    }
  };

  const handleOAuth = async (provider: "google" | "github") => {
    setLoading(true);
    await signIn(provider, { callbackUrl });
  };

  /* Scroll fade refs for new sections */
  const howFade = useScrollFade();
  const step1Fade = useScrollFade();
  const step2Fade = useScrollFade();
  const step3Fade = useScrollFade();
  const meshFade = useScrollFade();
  const bentoFade = useScrollFade();
  const speedFade = useScrollFade();
  const footerFade = useScrollFade();

  return (
    <div className={styles.container}>
      {/* ═══════════════════════════════════
          SECTION 1 — Hero / Auth
          ═══════════════════════════════════ */}
      <div className={styles.heroSection}>
        <ShaderBackground />
        {/* Navbar */}
        <nav className={styles.navbar}>
          <div className={styles.navInner}>
            <div
              className={styles.navLogoText}
              style={{ cursor: view !== "hero" ? "pointer" : "default", display: 'flex', alignItems: 'center', gap: '0.6rem' }}
              onClick={() => {
                switchTo("hero");
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <Image src="/FinalLogo.png" alt="LuminaMesh Logo" width={36} height={36} />
              LuminaMesh
            </div>
            
            {view === "hero" && (
              <div className={styles.navLinks}>
                <button onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })} className={styles.navLink}>How It Works</button>
                <button onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })} className={styles.navLink}>Demo</button>
                <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} className={styles.navLink}>Features</button>
                <button onClick={() => document.getElementById('performance')?.scrollIntoView({ behavior: 'smooth' })} className={styles.navLink}>Performance</button>
              </div>
            )}

            <button
              className={styles.navAuthBtn}
              onClick={() => switchTo(view === "hero" ? "login" : "hero")}
              id="landing-auth-trigger"
            >
              {view !== "hero" ? "← Back" : "Login / Sign Up"}
            </button>
          </div>
        </nav>

        {/* Main card — hero or auth */}
        <div className={`${styles.cardSlot} ${animating ? styles.cardSlotOut : styles.cardSlotIn}`}>

          {/* HERO */}
          {view === "hero" && (
            <div className={styles.heroCard}>
              <h1 className={styles.heroTitle}>LuminaMesh</h1>
              <p className={styles.heroTagline}>
                The mesh that moves at the speed of light.
              </p>
              <p className={styles.heroSub}>
                Encrypted peer-to-peer transfers, straight from your browser —{" "}
                <br className={styles.heroBr} />
                no servers, no limits, no trace.
              </p>
              <div className={styles.heroCta}>
                <button
                  className={styles.heroBtn}
                  onClick={() => switchTo("signup")}
                  id="landing-get-started"
                >
                  Get Started
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  className={styles.heroSecondaryBtn}
                  onClick={() => switchTo("login")}
                  id="landing-login"
                >
                  Log In
                </button>
              </div>
            </div>
          )}

          {/* AUTH CARD */}
          {(view === "login" || view === "signup") && (
            <div className={styles.authCard}>
              <button
                className={styles.closeBtn}
                onClick={() => switchTo("hero")}
                aria-label="Back"
                id="auth-close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
              </button>

              <div className={styles.logo}>
                <span className={styles.logoText}>LuminaMesh</span>
              </div>
              <p className={styles.tagline}>Peer-to-peer file transfers, reimagined</p>

              <div className={styles.tabs}>
                <button
                  className={`${styles.tab} ${view === "login" ? styles.tabActive : ""}`}
                  onClick={() => { setView("login"); setLoginError(null); }}
                >
                  Log In
                </button>
                <button
                  className={`${styles.tab} ${view === "signup" ? styles.tabActive : ""}`}
                  onClick={() => { setView("signup"); setSignupError(null); }}
                >
                  Sign Up
                </button>
              </div>

              {view === "login" ? (
                <div className={styles.loginContent}>
                  <div className={styles.oauthRow}>
                    <button className={`${styles.oauthBtn} ${styles.googleBtn}`} onClick={() => handleOAuth("google")} disabled={loading}>
                      <svg className={styles.oauthIcon} viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      Continue with Google
                    </button>
                    <button className={`${styles.oauthBtn} ${styles.githubBtn}`} onClick={() => handleOAuth("github")} disabled={loading}>
                      <svg className={styles.oauthIcon} viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                      </svg>
                      Continue with GitHub
                    </button>
                  </div>

                  <div className={styles.divider}>
                    <span className={styles.dividerLine} />
                    <span className={styles.dividerText}>or use email</span>
                    <span className={styles.dividerLine} />
                  </div>

                  <form className={styles.form} onSubmit={handleLogin}>
                    <input className={styles.input} type="email" placeholder="Email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required />
                    <div className={styles.pwWrapper}>
                      <input className={styles.input} type={showLoginPw ? "text" : "password"} placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required />
                      <button type="button" className={styles.eyeBtn} onClick={() => setShowLoginPw((v) => !v)} tabIndex={-1}>
                        {showLoginPw ? <EyeOff /> : <EyeOn />}
                      </button>
                    </div>
                    <label className={styles.rememberRow}>
                      <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className={styles.checkbox} />
                      <span>Remember me for 30 days</span>
                    </label>
                    {loginError && <p className={styles.error}>{loginError}</p>}
                    <button className={styles.submitBtn} type="submit" disabled={loading}>
                      {loading ? "Signing in..." : "Log In"}
                    </button>
                  </form>
                </div>
              ) : (
                <form className={styles.form} onSubmit={handleSignup}>
                  <input className={styles.input} type="email" placeholder="Email address" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required />
                  <div className={styles.pwWrapper}>
                    <input className={styles.input} type={showSignupPw ? "text" : "password"} placeholder="Password (min 8 characters)" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required />
                    <button type="button" className={styles.eyeBtn} onClick={() => setShowSignupPw((v) => !v)} tabIndex={-1}>
                      {showSignupPw ? <EyeOff /> : <EyeOn />}
                    </button>
                  </div>
                  <div className={styles.pwWrapper}>
                    <input className={styles.input} type={showSignupConfirm ? "text" : "password"} placeholder="Confirm password" value={signupConfirm} onChange={(e) => setSignupConfirm(e.target.value)} required />
                    <button type="button" className={styles.eyeBtn} onClick={() => setShowSignupConfirm((v) => !v)} tabIndex={-1}>
                      {showSignupConfirm ? <EyeOff /> : <EyeOn />}
                    </button>
                  </div>
                  {signupError && <p className={styles.error}>{signupError}</p>}
                  <button className={styles.submitBtn} type="submit" disabled={loading}>
                    {loading ? "Creating account..." : "Sign Up"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>{/* end heroSection */}

      {/* ═══════════════════════════════════
          SECTION 2 — How It Works
          ═══════════════════════════════════ */}
      <div className={styles.sectionDivider} />
      <section id="how" className={styles.section}>
        <div ref={howFade.ref} className={howFade.className}>
          <p className={styles.sectionLabel}>How It Works</p>
          <h2 className={styles.sectionTitle}>Three steps. Zero servers.</h2>
          <p className={styles.sectionSub}>
            LuminaMesh connects browsers directly through encrypted WebRTC channels.
            Your files never touch a server.
          </p>
        </div>

        <div className={styles.stepsRow}>
          <div ref={step1Fade.ref} className={`${styles.stepCard} ${step1Fade.className} ${styles.stepDelay1}`}>
            <p className={styles.stepNumber}>01</p>
            <div className={styles.stepIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <h3 className={styles.stepTitle}>Select a File</h3>
            <p className={styles.stepDesc}>
              Drop any file into LuminaMesh. It is split into encrypted chunks and hashed locally on your device.
            </p>
          </div>

          <div ref={step2Fade.ref} className={`${styles.stepCard} ${step2Fade.className} ${styles.stepDelay2}`}>
            <p className={styles.stepNumber}>02</p>
            <div className={styles.stepIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <h3 className={styles.stepTitle}>Share the Link</h3>
            <p className={styles.stepDesc}>
              A unique room link is generated. Send it to anyone — they join the mesh instantly through their browser.
            </p>
          </div>

          <div ref={step3Fade.ref} className={`${styles.stepCard} ${step3Fade.className} ${styles.stepDelay3}`}>
            <p className={styles.stepNumber}>03</p>
            <div className={styles.stepIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <h3 className={styles.stepTitle}>Peer Downloads</h3>
            <p className={styles.stepDesc}>
              Chunks stream directly between peers. Multiple receivers cross-seed automatically, accelerating the transfer.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION 3 — Live Mesh Demo
          ═══════════════════════════════════ */}
      <div className={styles.sectionDivider} />
      <section id="demo" className={styles.section}>
        <div className={styles.meshDemoLayout}>
          <div ref={meshFade.ref} className={`${styles.meshDemoText} ${meshFade.className}`}>
            <p className={styles.sectionLabel}>Real-Time Visualization</p>
            <h2 className={styles.sectionTitle}>Watch the mesh in action</h2>
            <p className={styles.sectionSub} style={{ marginBottom: 0 }}>
              Every transfer is visualized as a live network graph. Nodes represent connected peers,
              and data flows through encrypted channels in real time. The more peers join, the faster the mesh becomes.
            </p>
          </div>
          <div className={styles.meshDemoCanvas}>
            <svg className={styles.meshDemoSvg} viewBox="0 0 400 400">
              {/* Connection lines */}
              <line x1="200" y1="200" x2="100" y2="80" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <line x1="200" y1="200" x2="320" y2="100" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <line x1="200" y1="200" x2="80" y2="300" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <line x1="200" y1="200" x2="330" y2="310" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <line x1="100" y1="80" x2="320" y2="100" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              <line x1="80" y1="300" x2="330" y2="310" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

              {/* Data flow streaks */}
              <line x1="200" y1="200" x2="100" y2="80" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="6 24" style={{ animation: 'dataFlow 2s linear infinite' }} />
              <line x1="200" y1="200" x2="320" y2="100" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="6 24" style={{ animation: 'dataFlow 2.5s linear infinite' }} />
              <line x1="200" y1="200" x2="80" y2="300" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="6 24" style={{ animation: 'dataFlow 3s linear infinite' }} />
              <line x1="200" y1="200" x2="330" y2="310" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="6 24" style={{ animation: 'dataFlow 1.8s linear infinite' }} />

              {/* Center node (sender) */}
              <circle cx="200" cy="200" r="18" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
              <circle cx="200" cy="200" r="5" fill="#ffffff" opacity="0.8" />
              <text x="200" y="235" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10" fontFamily="var(--font-chakra)">Sender</text>

              {/* Peer nodes */}
              <circle cx="100" cy="80" r="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <circle cx="100" cy="80" r="3" fill="rgba(255,255,255,0.5)" />
              <text x="100" y="105" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="var(--font-chakra)">Peer 1</text>

              <circle cx="320" cy="100" r="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <circle cx="320" cy="100" r="3" fill="rgba(255,255,255,0.5)" />
              <text x="320" y="125" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="var(--font-chakra)">Peer 2</text>

              <circle cx="80" cy="300" r="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <circle cx="80" cy="300" r="3" fill="rgba(255,255,255,0.5)" />
              <text x="80" y="325" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="var(--font-chakra)">Peer 3</text>

              <circle cx="330" cy="310" r="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
              <circle cx="330" cy="310" r="3" fill="rgba(255,255,255,0.5)" />
              <text x="330" y="335" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="9" fontFamily="var(--font-chakra)">Peer 4</text>

              {/* Progress ring around sender */}
              <circle cx="200" cy="200" r="28" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1.5" />
              <circle cx="200" cy="200" r="28" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5"
                strokeDasharray="175.9" strokeDashoffset="44" strokeLinecap="round"
                transform="rotate(-90 200 200)" />
            </svg>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION 4 — Bento Feature Grid
          ═══════════════════════════════════ */}
      <div className={styles.sectionDivider} />
      <section id="features" className={styles.section}>
        <div ref={bentoFade.ref} className={bentoFade.className}>
          <p className={styles.sectionLabel}>Built Different</p>
          <h2 className={styles.sectionTitle}>Designed for speed and privacy</h2>
          <p className={styles.sectionSub}>
            Every architectural decision in LuminaMesh prioritizes your privacy and transfer performance.
          </p>
        </div>

        <div className={styles.bentoGrid}>
          {/* Large card — 2 rows */}
          <div className={`${styles.bentoCard} ${styles.bentoLarge}`}>
            <div className={styles.bentoIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
            </div>
            <h3 className={styles.bentoTitle}>End-to-End Encrypted</h3>
            <p className={styles.bentoDesc}>
              All data transfers are encrypted using DTLS within WebRTC channels.
              No intermediary — including LuminaMesh — can read your files.
              The encryption keys are negotiated directly between peers.
            </p>
          </div>

          {/* Standard cards */}
          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <h3 className={styles.bentoTitle}>No Size Limits</h3>
            <p className={styles.bentoDesc}>
              Transfer files of any size. Large files stream directly to disk using the File System Access API.
            </p>
          </div>

          <div className={styles.bentoCard}>
            <div className={styles.bentoIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
              </svg>
            </div>
            <h3 className={styles.bentoTitle}>Zero Server Storage</h3>
            <p className={styles.bentoDesc}>
              Files are never uploaded to any server. Chunks exist only in browser memory during the transfer.
            </p>
          </div>

          {/* Wide card — 2 columns */}
          <div className={`${styles.bentoCard} ${styles.bentoWide}`}>
            <div className={styles.bentoIcon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <h3 className={styles.bentoTitle}>One-Click Sharing</h3>
            <p className={styles.bentoDesc}>
              Generate a shareable link instantly. Anyone with the link joins the mesh — no accounts, no apps, no plugins required. Just a browser.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION 5 — Speed Comparison
          ═══════════════════════════════════ */}
      <div className={styles.sectionDivider} />
      <section id="performance" className={styles.section}>
        <div ref={speedFade.ref} className={speedFade.className}>
          <p className={styles.sectionLabel}>Performance</p>
          <h2 className={styles.sectionTitle}>Direct transfers are faster</h2>
          <p className={styles.sectionSub}>
            Traditional cloud services upload to a server, then download to the receiver.
            LuminaMesh eliminates the middleman entirely.
          </p>
        </div>

        <div className={styles.speedBars} ref={speedRef}>
          <div className={styles.speedRow}>
            <span className={`${styles.speedLabel} ${styles.speedLabelHighlight}`}>LuminaMesh</span>
            <div className={styles.speedTrack}>
              <div className={`${styles.speedFill} ${styles.speedFillHighlight}`} style={{ width: speedVisible ? "95%" : "0%" }} />
            </div>
            <span className={`${styles.speedValue} ${styles.speedValueHighlight}`}>Direct</span>
          </div>
          <div className={styles.speedRow}>
            <span className={styles.speedLabel}>Google Drive</span>
            <div className={styles.speedTrack}>
              <div className={styles.speedFill} style={{ width: speedVisible ? "45%" : "0%", transitionDelay: "0.15s" }} />
            </div>
            <span className={styles.speedValue}>Upload + DL</span>
          </div>
          <div className={styles.speedRow}>
            <span className={styles.speedLabel}>WeTransfer</span>
            <div className={styles.speedTrack}>
              <div className={styles.speedFill} style={{ width: speedVisible ? "35%" : "0%", transitionDelay: "0.3s" }} />
            </div>
            <span className={styles.speedValue}>Upload + DL</span>
          </div>
          <div className={styles.speedRow}>
            <span className={styles.speedLabel}>Dropbox</span>
            <div className={styles.speedTrack}>
              <div className={styles.speedFill} style={{ width: speedVisible ? "40%" : "0%", transitionDelay: "0.45s" }} />
            </div>
            <span className={styles.speedValue}>Upload + DL</span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════
          SECTION 6 — Footer CTA
          ═══════════════════════════════════ */}
      <div className={styles.sectionDivider} />
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div ref={footerFade.ref} className={footerFade.className}>
            <h2 className={styles.footerTitle}>Start sharing. No limits.</h2>
            <p className={styles.footerSub}>
              Encrypted, peer-to-peer, and completely free.
              No file size restrictions. No server uploads. Just you and your peers.
            </p>
            <button className={styles.footerCta} onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => switchTo("signup"), 400); }}>
              Get Started
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className={styles.footerDivider} />

          <div className={styles.footerContact}>
            <p className={styles.footerContactTitle}>Contact Us</p>
            <div className={styles.footerGithubRow}>
              {/* Smit GitHub */}
              <a href="https://github.com/ayoitssmit" target="_blank" rel="noopener noreferrer" className={styles.footerGithubLink} title="GitHub: ayoitssmit">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
              {/* Smit Email */}
              <a href="mailto:smitshah3005@gmail.com" className={styles.footerGithubLink} title="smitshah3005@gmail.com">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </a>
              
              {/* Jalpan GitHub */}
              <a href="https://github.com/Jalpan04" target="_blank" rel="noopener noreferrer" className={styles.footerGithubLink} title="GitHub: Jalpan04">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
              {/* Jalpan Email */}
              <a href="mailto:jalpan2104@gmail.com" className={styles.footerGithubLink} title="jalpan2104@gmail.com">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </a>
            </div>
          </div>

          <p className={styles.footerBottom}>LuminaMesh. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}

export default function LandingPage() {
  return (
    <Suspense>
      <LandingContent />
    </Suspense>
  );
}

function EyeOn() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

