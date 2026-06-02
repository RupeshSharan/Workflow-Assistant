export function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "3rem",
      gap: "1rem"
    }}>
      <style>{`
        @keyframes spinnerRotate {
          to { transform: rotate(360deg); }
        }
        .spinner-circle {
          width: 36px;
          height: 36px;
          border: 3px solid rgba(255, 255, 255, 0.05);
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spinnerRotate 0.8s linear infinite;
        }
      `}</style>
      <div className="spinner-circle" />
      <span className="muted-message" style={{ fontSize: "0.85rem", opacity: 0.7 }}>{message}</span>
    </div>
  );
}
