import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { api } from "../api";
import { StatCard } from "../components/dashboard/StatCard";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session } from "../types";

interface AnalyticsPageProps {
  session: Session;
}

export function AnalyticsPage({ session }: AnalyticsPageProps) {
  const queryClient = useQueryClient();

  const bottlenecksQuery = useQuery({
    queryKey: ["bottlenecks", session.activeWorkspaceId],
    queryFn: () => api.workflowBottlenecks(session)
  });

  const productivityQuery = useQuery({
    queryKey: ["productivity", session.activeWorkspaceId],
    queryFn: () => api.productivityStats(session)
  });

  const insightsQuery = useQuery({
    queryKey: ["adaptive-insights", session.activeWorkspaceId],
    queryFn: () => api.adaptiveInsights(session)
  });

  const reportMutation = useMutation({
    mutationFn: () => api.generateWorkspaceReport(session),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents", session.activeWorkspaceId] });
      alert("Workspace performance report has been successfully compiled and indexed in your Knowledge Library!");
    }
  });

  const bottlenecks = bottlenecksQuery.data?.bottlenecks ?? [];
  const productivity = productivityQuery.data;
  const insights = insightsQuery.data?.suggestions ?? [];

  const maxHours = Math.max(...bottlenecks.map((b) => b.avgHours), 1);

  return (
    <section className="analytics-page">
      <div className="page-intro">
        <p className="eyebrow">Adaptive intelligence</p>
        <h3>Workspace Bottlenecks & Productivity Insights</h3>
        <p>Analyze cycle times, monitor stage processing delays, and review AI consultant suggestions.</p>
      </div>

      <div className="report-export-panel">
        <div>
          <h4>Unified Knowledge Report</h4>
          <p>Compile current metrics into a document, index it in pgvector, and ask the AI assistant for insights.</p>
        </div>
        <button
          className="primary"
          onClick={() => reportMutation.mutate()}
          disabled={reportMutation.isPending}
        >
          {reportMutation.isPending ? "Generating..." : "Generate Workspace Report"}
        </button>
      </div>

      <div className="stats">
        <StatCard
          label="Average Cycle Time"
          value={`${Math.round(productivity?.cycleTimeStats.avgHoursClosed ?? 0)} hours`}
        />
        <StatCard
          label="Closed Items Analyzed"
          value={productivity?.cycleTimeStats.closedCount ?? 0}
        />
        <StatCard
          label="Active Bottlenecks"
          value={bottlenecks.filter((b) => b.avgHours > 24).length}
          tone={bottlenecks.some((b) => b.avgHours > 48) ? "danger" : undefined}
        />
        <StatCard
          label="Productive Assignees"
          value={productivity?.completedItemsPerUser.filter((u) => u.completedCount > 0).length ?? 0}
          tone="accent"
        />
      </div>

      <div className="analytics-grid">
        <div className="analytics-left">
          <article className="analytics-card">
            <h4>Workflow Stage Bottlenecks (Average Hours Spent)</h4>
            <div className="bottleneck-chart-container">
              {bottlenecksQuery.isLoading ? (
                <LoadingSpinner message="Loading bottleneck statistics..." />
              ) : bottlenecks.length === 0 ? (
                <p className="muted-message">No default workflow stages found to analyze.</p>
              ) : (
                <svg className="bottleneck-chart" viewBox={`0 0 500 ${Math.max(bottlenecks.length * 45 + 30, 100)}`} width="100%">
                  <line x1="120" y1="10" x2="120" y2={bottlenecks.length * 45 + 10} stroke="#e2e8f0" strokeWidth="1.5" />
                  {bottlenecks.map((stage, index) => {
                    const y = 15 + index * 45;
                    const barWidth = stage.avgHours > 0 ? (stage.avgHours / maxHours) * 320 : 5;
                    return (
                      <g key={stage.stageId}>
                        <text
                          x="110"
                          y={y + 14}
                          textAnchor="end"
                          fontSize="11"
                          fontFamily="sans-serif"
                          fill="#475569"
                          fontWeight="500"
                        >
                          {stage.stageName}
                        </text>
                        <rect
                          x="120"
                          y={y}
                          width={barWidth}
                          height="20"
                          fill={stage.color || "#64748b"}
                          rx="4"
                          className="chart-bar"
                        />
                        <text
                          x={120 + barWidth + 8}
                          y={y + 14}
                          fontSize="11"
                          fontFamily="sans-serif"
                          fill="#1e293b"
                          fontWeight="600"
                        >
                          {Math.round(stage.avgHours)}h
                        </text>
                        <text
                          x="120"
                          y={y + 31}
                          fontSize="9"
                          fontFamily="sans-serif"
                          fill="#94a3b8"
                        >
                          {stage.itemCount} items processed
                        </text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          </article>

          <article className="analytics-card">
            <h4>Assignee Leadership (Completed Items)</h4>
            {productivityQuery.isLoading ? (
              <LoadingSpinner message="Loading productivity metrics..." />
            ) : !productivity?.completedItemsPerUser.length ? (
              <p className="muted-message">No members found in this workspace.</p>
            ) : (
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Completed Tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {productivity.completedItemsPerUser.map((user) => (
                    <tr key={user.userId}>
                      <td>
                        <strong>{user.userName}</strong>
                      </td>
                      <td>{user.completedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </div>

        <div className="analytics-right">
          <article className="analytics-card">
            <h4>
              <TrendingUp size={16} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />{" "}
              Adaptive AI Insights
            </h4>
            <p className="muted-message" style={{ marginBottom: "1rem", fontSize: "0.8rem" }}>
              Heuristics and LLM suggestions to optimize your workspace.
            </p>
            {insightsQuery.isLoading ? (
              <LoadingSpinner message="Analyzing workflow rules..." />
            ) : insights.length === 0 ? (
              <p className="muted-message">No optimization suggestions available.</p>
            ) : (
              insights.map((insight, idx) => (
                <div key={idx} className="insight-card">
                  <strong>{insight.title}</strong>
                  <p>{insight.suggestion}</p>
                  <em>Impact: {insight.expectedImpact}</em>
                </div>
              ))
            )}
          </article>
        </div>
      </div>
    </section>
  );
}
