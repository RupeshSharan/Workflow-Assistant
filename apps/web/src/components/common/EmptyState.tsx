import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  message: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  message,
  icon,
  actionLabel,
  onAction
}: EmptyStateProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "3rem 2rem",
      background: "rgba(255, 255, 255, 0.01)",
      border: "1px dashed rgba(255, 255, 255, 0.08)",
      borderRadius: "12px",
      margin: "1rem 0"
    }}>
      {icon && <div style={{ marginBottom: "1rem", opacity: 0.5 }}>{icon}</div>}
      <h4 style={{ margin: "0 0 0.5rem 0", color: "#f8fafc", fontSize: "1.05rem" }}>{title}</h4>
      <p style={{ margin: "0 0 1.5rem 0", color: "#94a3b8", maxWidth: "320px", fontSize: "0.85rem", lineHeight: "1.4" }}>{message}</p>
      {actionLabel && onAction && (
        <button className="primary" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
