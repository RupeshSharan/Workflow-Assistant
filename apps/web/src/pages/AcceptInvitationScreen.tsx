import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { Field } from "../components/common/Field";
import type { InvitationDetails, Session } from "../types";

interface AcceptInvitationScreenProps {
  token: string;
  session: Session | null;
  onAccepted: (session: Session) => void;
  onCancel: () => void;
}

export function AcceptInvitationScreen({
  token,
  session,
  onAccepted,
  onCancel
}: AcceptInvitationScreenProps) {
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    api.getInvitationDetails(token)
      .then((res) => {
        setDetails(res.invitation);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || "Failed to load invitation.");
        setLoading(false);
      });
  }, [token]);

  async function handleAccept(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    if (!session) {
      if (!name.trim()) {
        setFormError("Please enter your name.");
        return;
      }
      if (password.length < 8) {
        setFormError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirmPassword) {
        setFormError("Passwords do not match.");
        return;
      }
    }

    setAccepting(true);
    try {
      const newSession = await api.acceptInvitation(
        token,
        session ? undefined : name,
        password || undefined
      );
      onAccepted(newSession);
    } catch (err: any) {
      setFormError(err.message || "Failed to accept invitation.");
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <main className="auth-layout" style={{ justifyContent: "center" }}>
        <article className="auth-card" style={{ textAlign: "center" }}>
          <p>Loading invitation details...</p>
        </article>
      </main>
    );
  }

  if (error || !details) {
    return (
      <main className="auth-layout" style={{ justifyContent: "center" }}>
        <article className="auth-card" style={{ textAlign: "center" }}>
          <h3 className="form-error" style={{ color: "#ef4444" }}>Invalid Invitation</h3>
          <p style={{ margin: "1rem 0" }}>{error || "This invitation link is invalid, expired, or has been revoked."}</p>
          <button className="primary full" onClick={onCancel}>Back to Home</button>
        </article>
      </main>
    );
  }

  const isExistingUser = session !== null;
  const isEmailMatching = isExistingUser && session.user.email.toLowerCase() === details.email.toLowerCase();

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">Workspace Invitation</p>
        <h1>You have been invited!</h1>
        <p className="story-copy">
          <strong>{details.invitedByName}</strong> has invited you to join the organization <strong>{details.orgName}</strong>
          {details.workspaceName && <> and collaborate in the workspace <strong>{details.workspaceName}</strong></>}.
        </p>
        <div className="story-features">
          <span>Invited Role: {details.role}</span>
          <span>Target Email: {details.email}</span>
        </div>
      </section>

      <section className="auth-card">
        <h3>Join the Organization</h3>
        <form onSubmit={handleAccept}>
          {isExistingUser ? (
            isEmailMatching ? (
              <div style={{ marginBottom: "1.5rem" }}>
                <p>
                  You are currently signed in as <strong>{session.user.email}</strong>. Click below to accept the invitation and link your account.
                </p>
              </div>
            ) : (
              <div style={{ marginBottom: "1.5rem" }}>
                <p className="form-error" style={{ color: "#ef4444" }}>
                  Logged-in account (<strong>{session.user.email}</strong>) does not match the invited email address (<strong>{details.email}</strong>).
                </p>
                <p style={{ margin: "0.5rem 0" }}>Please sign out from this account, then open the invitation link again.</p>
                <button type="button" className="secondary full" style={{ marginTop: "1rem" }} onClick={onCancel}>
                  Cancel and Sign Out
                </button>
              </div>
            )
          ) : (
            <>
              <Field label="Your Full Name" value={name} onChange={setName} />
              <Field label="Email Address" type="email" value={details.email} onChange={() => {}} />
              <Field label="New Password (min 8 chars)" type="password" value={password} onChange={setPassword} />
              <Field label="Confirm Password" type="password" value={confirmPassword} onChange={setConfirmPassword} />
            </>
          )}

          {(!isExistingUser || isEmailMatching) && (
            <>
              {formError && <p className="form-error">{formError}</p>}
              <button className="primary full" type="submit" disabled={accepting}>
                {accepting ? "Accepting..." : isExistingUser ? "Accept Invitation" : "Create Account & Join Team"}
              </button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
