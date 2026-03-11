"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "./profile.module.css";

export default function ProfilePage() {
  const { data: session, update } = useSession();
  const router = useRouter();

  const [name, setName] = useState(session?.user?.name || "");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
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
            <input
              className={styles.input}
              type="password"
              placeholder="Current password (leave blank if not set yet)"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
            />
            <input
              className={styles.input}
              type="password"
              placeholder="New password (min 8 characters)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
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
