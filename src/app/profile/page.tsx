"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "./profile.module.css";

function EyeOn() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

export default function ProfilePage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [name, setName] = useState(session?.user?.name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [confirmPw, setConfirmPw] = useState("");
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const avatarInitial = session?.user?.name?.[0]?.toUpperCase() || session?.user?.email?.[0]?.toUpperCase() || "?";

  const handleNameSave = async () => {
    if (!name.trim()) return;
    setNameSaving(true); setNameMsg(null);
    const res = await fetch("/api/user/name", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setNameSaving(false);
    if (res.ok) { await update({ name: name.trim() }); setNameMsg("Name updated."); }
    else setNameMsg("Failed to update name.");
  };

  const handlePasswordSave = async () => {
    setPwError(null); setPwMsg(null);
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters."); return; }
    if (newPw !== confirmPw) { setPwError("Passwords do not match."); return; }
    setPwSaving(true);
    const res = await fetch("/api/user/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
    });
    const data = await res.json();
    setPwSaving(false);
    if (res.ok) { setPwMsg("Password saved successfully."); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }
    else setPwError(data.error || "Failed to save password.");
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button className={styles.back} onClick={() => router.push("/dashboard")}>
          ← Back to Dashboard
        </button>
      </div>

      <div className={styles.card}>
        {/* Avatar */}
        <div className={styles.avatarSection}>
          <div className={styles.avatar}>{avatarInitial}</div>
          <div>
            <p className={styles.displayName}>{session?.user?.name || "No name set"}</p>
            <p className={styles.email}>{session?.user?.email}</p>
          </div>
        </div>

        <div className={styles.divider} />

        {/* Change Name */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Display Name</h3>
          <div className={styles.row}>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your display name"
            />
            <button className={styles.saveBtn} onClick={handleNameSave} disabled={nameSaving}>
              {nameSaving ? "Saving..." : "Save"}
            </button>
          </div>
          {nameMsg && <p className={styles.successMsg}>{nameMsg}</p>}
        </div>

        <div className={styles.divider} />

        {/* Set / Change Password */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Email + Password Login</h3>
          <p className={styles.sectionHint}>
            Set a password so you can also log in with your email and password in addition to Google/GitHub.
          </p>
          <div className={styles.fieldGroup}>
            <div className={styles.pwWrapper}>
              <input
                className={styles.input}
                type={showCurrentPw ? "text" : "password"}
                placeholder="Current password (leave blank if not set yet)"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowCurrentPw((v) => !v)} tabIndex={-1}>
                {showCurrentPw ? <EyeOff /> : <EyeOn />}
              </button>
            </div>
            <div className={styles.pwWrapper}>
              <input
                className={styles.input}
                type={showNewPw ? "text" : "password"}
                placeholder="New password (min 8 characters)"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowNewPw((v) => !v)} tabIndex={-1}>
                {showNewPw ? <EyeOff /> : <EyeOn />}
              </button>
            </div>
            <div className={styles.pwWrapper}>
              <input
                className={styles.input}
                type={showConfirmPw ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowConfirmPw((v) => !v)} tabIndex={-1}>
                {showConfirmPw ? <EyeOff /> : <EyeOn />}
              </button>
            </div>
          </div>
          {pwError && <p className={styles.errorMsg}>{pwError}</p>}
          {pwMsg && <p className={styles.successMsg}>{pwMsg}</p>}
          <button className={styles.saveBtnFull} onClick={handlePasswordSave} disabled={pwSaving}>
            {pwSaving ? "Saving..." : "Save Password"}
          </button>
        </div>
      </div>
    </div>
  );
}
