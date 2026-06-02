import { createContext, useState, useContext, type ReactNode } from "react";
import { X, CheckCircle, AlertTriangle, Info } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function addToast(message: string, type: ToastType) {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  }

  function removeToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  const toast = {
    success: (msg: string) => addToast(msg, "success"),
    error: (msg: string) => addToast(msg, "error"),
    info: (msg: string) => addToast(msg, "info"),
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <style>{`
        @keyframes toastSlideIn {
          from {
            transform: translateY(1rem) scale(0.9);
            opacity: 0;
          }
          to {
            transform: translateY(0) scale(1);
            opacity: 1;
          }
        }
        .toast-card {
          animation: toastSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          background: rgba(30, 41, 59, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .toast-card.success {
          border-left: 4px solid #10b981;
        }
        .toast-card.error {
          border-left: 4px solid #ef4444;
        }
        .toast-card.info {
          border-left: 4px solid #3b82f6;
        }
      `}</style>
      <div className="toast-container" style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        zIndex: 9999,
        pointerEvents: "none"
      }}>
        {toasts.map((t) => (
          <div key={t.id} className={`toast-card ${t.type}`} style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            color: "white",
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.3)",
            minWidth: "280px",
            maxWidth: "400px",
            pointerEvents: "auto",
          }}>
            {t.type === "success" && <CheckCircle size={18} style={{ color: "#10b981" }} />}
            {t.type === "error" && <AlertTriangle size={18} style={{ color: "#ef4444" }} />}
            {t.type === "info" && <Info size={18} style={{ color: "#3b82f6" }} />}
            <span style={{ flex: 1, fontSize: "0.9rem", fontWeight: 500 }}>{t.message}</span>
            <button onClick={() => removeToast(t.id)} style={{
              background: "none",
              border: "none",
              color: "rgba(255, 255, 255, 0.5)",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              transition: "color 0.2s"
            }}
            onMouseOver={(e) => e.currentTarget.style.color = "white"}
            onMouseOut={(e) => e.currentTarget.style.color = "rgba(255,255,255,0.5)"}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context.toast;
}
