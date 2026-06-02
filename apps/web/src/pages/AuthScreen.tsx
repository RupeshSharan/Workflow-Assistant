import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api";
import { Field } from "../components/common/Field";
import type { Session } from "../types";

interface AuthScreenProps {
  onAuthenticated: (session: Session) => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    organizationName: "",
    workspaceName: "General Workspace"
  });

  const authMutation = useMutation({
    mutationFn: () =>
      mode === "register"
        ? api.register(form)
        : api.login({ email: form.email, password: form.password }),
    onSuccess: onAuthenticated
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    authMutation.mutate();
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <p className="eyebrow">AI Workflow Assistant Platform</p>
        <h1>One flexible workflow home for every kind of team.</h1>
        <p className="story-copy">
          Configure stages, manage shared knowledge, and prepare for AI actions without locking
          your workspace into a single business process.
        </p>
        <div className="story-features">
          <span>Configurable workflows</span>
          <span>Tenant-isolated workspaces</span>
          <span>AI knowledge and automation ready</span>
        </div>
      </section>
      <section className="auth-card">
        <div className="tab-row">
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
            Create workspace
          </button>
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Sign in
          </button>
        </div>
        <form onSubmit={submit}>
          {mode === "register" && (
            <>
              <Field label="Your name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
              <Field
                label="Organization name"
                value={form.organizationName}
                onChange={(organizationName) => setForm({ ...form, organizationName })}
              />
              <Field
                label="Workspace name"
                value={form.workspaceName}
                onChange={(workspaceName) => setForm({ ...form, workspaceName })}
              />
            </>
          )}
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(email) => setForm({ ...form, email })}
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={(password) => setForm({ ...form, password })}
          />
          {authMutation.error && <p className="form-error">{authMutation.error.message}</p>}
          <button className="primary full" type="submit" disabled={authMutation.isPending}>
            {authMutation.isPending ? "Working..." : mode === "register" ? "Create platform space" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
