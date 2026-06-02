interface StatCardProps {
  label: string;
  value: number | string;
  tone?: "danger" | "accent";
  compact?: boolean;
}

export function StatCard({
  label,
  value,
  tone,
  compact
}: StatCardProps) {
  return (
    <article className={`stat-card ${tone ?? ""} ${compact ? "compact" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
