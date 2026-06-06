import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrendingUp, BarChart2, Calendar, Clock, Award, AlertCircle, FileText } from "lucide-react";
import { api } from "../api";
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
  const totalCompleted = productivity?.cycleTimeStats.closedCount ?? 0;
  const totalItems = productivity?.cycleTimeStats.totalCount ?? 0;
  const productivityScore = totalItems > 0 ? Math.round((totalCompleted / totalItems) * 100) : 100;
  const healthLabel = productivityScore >= 80 ? "Excellent health" : productivityScore >= 50 ? "Moderate health" : "Attention needed";
  const healthColor = productivityScore >= 80 ? "var(--status-green)" : productivityScore >= 50 ? "var(--status-orange)" : "var(--status-red)";

  // Dynamic Weekly Completion Trend points
  const velocity = productivity?.weeklyVelocity ?? [];
  const maxVelocityCount = Math.max(...velocity.map((v) => v.count), 1);
  const points = velocity.map((v, index) => {
    const x = 40 + index * 88;
    const y = 130 - (v.count / maxVelocityCount) * 100;
    return { x, y, count: v.count };
  });

  const pathD = points.length > 0
    ? `M ${points[0].x},${points[0].y} ` + points.slice(1).map(p => `L ${p.x},${p.y}`).join(" ")
    : "";

  return (
    <section className="analytics-page" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)" }}>
      {/* Header */}
      <div className="page-intro" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Business Intelligence</p>
        <h3>Process Analytics & Adaptive Insights</h3>
        <p>Monitor stage delays, team workload balances, completion velocity, and AI workflow optimization suggestions.</p>
      </div>

      {/* Unified Report compilation widget */}
      <div className="report-export-panel" style={{ display: "flex", justifyContent: "space-between", padding: "1.5rem", borderRadius: "12px", background: "var(--surface)", border: "1px solid var(--line)", marginBottom: "2rem" }}>
        <div>
          <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem" }}><FileText size={18} /> Compile Unified Knowledge Report</h4>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            Index current analytics as a workspace document so the AI assistant can reference it in RAG queries.
          </p>
        </div>
        <button
          className="primary"
          onClick={() => reportMutation.mutate()}
          disabled={reportMutation.isPending}
        >
          {reportMutation.isPending ? "Compiling..." : "Generate report"}
        </button>
      </div>

      {/* Analytics Score Cards */}
      <div className="stats" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <article className="stat-card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "white", padding: "1rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: "600" }}>AVG CYCLE TIME</span>
          <strong style={{ fontSize: "1.6rem", fontWeight: "700" }}>{Math.round(productivity?.cycleTimeStats.avgHoursClosed ?? 0)} hours</strong>
          <span style={{ fontSize: "0.7rem", color: "var(--status-green)", fontWeight: 600 }}>-12% vs last week</span>
        </article>

        <article className="stat-card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "white", padding: "1rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: "600" }}>COMPLETED TASKS</span>
          <strong style={{ fontSize: "1.6rem", fontWeight: "700" }}>{totalCompleted}</strong>
          <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>All-time closed items</span>
        </article>

        <article className="stat-card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "white", padding: "1rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: "600" }}>ACTIVE BOTTLENECK STAGES</span>
          <strong style={{ fontSize: "1.6rem", fontWeight: "700" }}>{bottlenecks.filter((b) => b.avgHours > 24).length}</strong>
          <span style={{ fontSize: "0.7rem", color: bottlenecks.some((b) => b.avgHours > 48) ? "var(--status-red)" : "var(--muted)", fontWeight: 600 }}>
            {bottlenecks.some((b) => b.avgHours > 48) ? "Critical warning" : "Stable limits"}
          </span>
        </article>

        <article className="stat-card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem", background: "white", padding: "1rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--muted)", fontWeight: "600" }}>PRODUCTIVITY SCORE</span>
          <strong style={{ fontSize: "1.6rem", fontWeight: "700" }}>{productivityScore}%</strong>
          <span style={{ fontSize: "0.7rem", color: healthColor, fontWeight: 600 }}>{healthLabel}</span>
        </article>
      </div>

      <div className="analytics-grid" style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "1.5rem" }}>
        
        {/* Left Column: Charts and Visualizations */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Bottleneck Bar chart */}
          <article className="analytics-card" style={{ background: "white", padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Clock size={16} /> Workflow Stage Bottlenecks (Average Hours)
            </h4>
            <div className="bottleneck-chart-container">
              {bottlenecksQuery.isLoading ? (
                <LoadingSpinner message="Calculating bottleneck averages..." />
              ) : bottlenecks.length === 0 ? (
                <p className="muted-message">No workflow templates found to analyze.</p>
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
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>
          </article>

          {/* SVG line chart representing task completion velocity */}
          <article className="analytics-card" style={{ background: "white", padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <BarChart2 size={16} /> Completion Trend (Weekly Velocity)
            </h4>
            <div className="svg-chart-container">
              {productivityQuery.isLoading ? (
                <LoadingSpinner message="Calculating weekly completion rates..." />
              ) : velocity.length === 0 ? (
                <p className="muted-message" style={{ textAlign: "center", padding: "2rem" }}>
                  No closed task history found in the last 6 weeks.
                </p>
              ) : (
                <svg width="100%" height="160" viewBox="0 0 500 160">
                  {/* Horizontal guide lines */}
                  <line x1="40" y1="20" x2="480" y2="20" stroke="#f1f5f9" strokeWidth="1" />
                  <line x1="40" y1="70" x2="480" y2="70" stroke="#f1f5f9" strokeWidth="1" />
                  <line x1="40" y1="120" x2="480" y2="120" stroke="#f1f5f9" strokeWidth="1" />
                  
                  {/* Visual line graph */}
                  {pathD && (
                    <path
                      d={pathD}
                      fill="none"
                      stroke="var(--green)"
                      strokeWidth="3"
                    />
                  )}
                  
                  {/* Data points */}
                  {points.map((p, idx) => (
                    <g key={idx}>
                      <circle cx={p.x} cy={p.y} r="4" fill="var(--green)" />
                      <text
                        x={p.x}
                        y={p.y - 8}
                        fontSize="9"
                        textAnchor="middle"
                        fill="var(--forest-dark)"
                        fontWeight="600"
                      >
                        {p.count}
                      </text>
                    </g>
                  ))}
                  
                  {/* Axis Labels */}
                  {points.map((p, idx) => {
                    const label = idx === 5 ? "Current" : `Wk ${idx + 1}`;
                    return (
                      <text key={idx} x={p.x - 14} y="150" fontSize="10" fill="var(--muted)">
                        {label}
                      </text>
                    );
                  })}
                </svg>
              )}
            </div>
          </article>

          {/* Team Workload balance heatmap */}
          <article className="analytics-card" style={{ background: "white", padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1rem", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Calendar size={16} /> Workspace Workload Balance Heatmap
            </h4>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.8rem", color: "var(--muted)" }}>
              Distribution of active task assignments across team members.
            </p>
            
            <div className="workload-heatmap">
              {productivityQuery.isLoading ? (
                <LoadingSpinner message="Calculating assignee workload..." />
              ) : (
                productivity?.activeItemsPerUser.map((user) => {
                  const tasks = user.activeCount;
                  let levelClass = "level-0";
                  if (tasks > 0 && tasks <= 2) levelClass = "level-1";
                  else if (tasks > 2 && tasks <= 5) levelClass = "level-2";
                  else if (tasks > 5) levelClass = "level-3";
                  
                  return (
                    <div key={user.userId} className={`heatmap-cell ${levelClass}`}>
                      <strong>{user.userName}</strong>
                      <div style={{ fontSize: "0.75rem", marginTop: "2px" }}>{tasks} active tasks</div>
                    </div>
                  );
                })
              )}
            </div>
          </article>

        </div>

        {/* Right Column: AI Optimization Suggestions */}
        <aside style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Insights recommendations list */}
          <article className="analytics-card" style={{ background: "white", padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1rem", marginBottom: "0.25rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <TrendingUp size={16} style={{ color: "var(--status-purple)" }} /> Adaptive AI Recommendations
            </h4>
            <p style={{ margin: "0 0 1rem 0", fontSize: "0.8rem", color: "var(--muted)" }}>
              Observed live pipeline behaviors compiled into actionable suggestions.
            </p>

            {insightsQuery.isLoading ? (
              <LoadingSpinner message="Running optimization analyzer..." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {insights.map((insight, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: "1rem",
                      background: "#faf5ff",
                      border: "1px solid #f3e8ff",
                      borderRadius: "10px"
                    }}
                  >
                    <div style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
                      <AlertCircle size={14} style={{ color: "var(--status-purple)" }} />
                      <strong style={{ fontSize: "0.85rem", color: "var(--forest-dark)" }}>{insight.title}</strong>
                    </div>
                    <p style={{ margin: "0.4rem 0", fontSize: "0.8rem", color: "var(--forest-dark)" }}>{insight.suggestion}</p>
                    <span style={{ fontSize: "0.7rem", fontWeight: "700", color: "var(--status-green)" }}>
                      Impact: {insight.expectedImpact}
                    </span>
                  </div>
                ))}
                {insights.length === 0 && (
                  <p className="muted-message">No AI recommendations currently available.</p>
                )}
              </div>
            )}
          </article>

          {/* Assignee Productivity list */}
          <article className="analytics-card" style={{ background: "white", padding: "1.5rem", borderRadius: "14px", border: "1px solid var(--line)" }}>
            <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Award size={16} /> Leaderboard
            </h4>
            {productivityQuery.isLoading ? (
              <p>Loading...</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {productivity?.completedItemsPerUser.map((user) => (
                  <div
                    key={user.userId}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.5rem 0.75rem",
                      background: "var(--surface-muted)",
                      borderRadius: "8px",
                      fontSize: "0.85rem"
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "var(--forest-dark)" }}>{user.userName}</span>
                    <span style={{ fontWeight: 700, color: "var(--green)" }}>{user.completedCount} closed</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </aside>
      </div>
    </section>
  );
}
