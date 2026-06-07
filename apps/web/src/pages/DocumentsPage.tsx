import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileText, Folder, Clock, Brain, Search, ArrowRight, X, Plus, Sparkles } from "lucide-react";
import { api } from "../api";
import { Field } from "../components/common/Field";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session, KnowledgeDocument } from "../types";

interface DocumentsPageProps {
  session: Session;
  canContribute: boolean;
}

export function DocumentsPage({ session, canContribute }: DocumentsPageProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [contentText, setContentText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [activeFolder, setActiveFolder] = useState<"all" | "recent" | "reports">("all");
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [activeAddTab, setActiveAddTab] = useState<"note" | "file">("note");

  // Navigation tab for Knowledge page
  const [activeTab, setActiveTab] = useState<"library" | "graph" | "transcript">("library");

  // Meeting Transcript parser state variables
  const [meetingTranscriptText, setMeetingTranscriptText] = useState("");
  const [extractedTasks, setExtractedTasks] = useState<any[]>([]);
  const [extractedSummary, setExtractedSummary] = useState<string | null>(null);

  // AI Knowledge Graph states
  const [graphNodes, setGraphNodes] = useState<any[]>([]);
  const [graphLinks, setGraphLinks] = useState<any[]>([]);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);

  const knowledgeGraph = useQuery({
    queryKey: ["knowledge-graph", session.activeWorkspaceId],
    queryFn: () => api.knowledgeGraph(session),
    enabled: activeTab === "graph"
  });

  const extractTranscriptMutation = useMutation({
    mutationFn: (transcript: string) => api.meetingTranscript(session, transcript),
    onSuccess: (data) => {
      setExtractedTasks(data.tasks || []);
      setExtractedSummary(data.summary || "");
    }
  });

  const executeTranscriptMutation = useMutation({
    mutationFn: (tasks: any[]) => api.meetingExecute(session, tasks),
    onSuccess: () => {
      alert("Bulk tasks created from transcript successfully!");
      setMeetingTranscriptText("");
      setExtractedTasks([]);
      setExtractedSummary(null);
      setActiveTab("library");
      void queryClient.invalidateQueries({ queryKey: ["work-items", session.activeWorkspaceId] });
      void queryClient.invalidateQueries({ queryKey: ["summary", session.activeWorkspaceId] });
    }
  });

  // Force-directed layout physics setup
  useEffect(() => {
    if (!knowledgeGraph.data) return;
    const initialNodes = knowledgeGraph.data.nodes.map((n: any, idx: number) => {
      const angle = (idx / knowledgeGraph.data.nodes.length) * 2 * Math.PI;
      const r = 160 + Math.random() * 40;
      return {
        ...n,
        x: 400 + r * Math.cos(angle),
        y: 250 + r * Math.sin(angle),
        vx: 0,
        vy: 0
      };
    });
    setGraphNodes(initialNodes);
    setGraphLinks(knowledgeGraph.data.links);
  }, [knowledgeGraph.data]);

  useEffect(() => {
    if (graphNodes.length === 0 || activeTab !== "graph") return;
    
    let animFrameId: number;
    const width = 800;
    const height = 500;
    
    const tick = () => {
      setGraphNodes(prevNodes => {
        const nextNodes = prevNodes.map(n => ({ ...n }));
        const nodeMap = new Map(nextNodes.map(n => [n.id, n]));
        
        // 1. Repulsion
        for (let i = 0; i < nextNodes.length; i++) {
          const n1 = nextNodes[i]!;
          for (let j = i + 1; j < nextNodes.length; j++) {
            const n2 = nextNodes[j]!;
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            if (dist < 180) {
              const force = (180 - dist) * 0.05;
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              
              if (n1.id !== draggedNodeId) {
                n1.vx -= fx;
                n1.vy -= fy;
              }
              if (n2.id !== draggedNodeId) {
                n2.vx += fx;
                n2.vy += fy;
              }
            }
          }
        }
        
        // 2. Attraction along links
        graphLinks.forEach(link => {
          const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
          const targetId = typeof link.target === 'object' ? link.target.id : link.target;
          
          const n1 = nodeMap.get(sourceId);
          const n2 = nodeMap.get(targetId);
          if (n1 && n2) {
            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const desiredDist = 100;
            const force = (dist - desiredDist) * 0.025;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            
            if (n1.id !== draggedNodeId) {
              n1.vx += fx;
              n1.vy += fy;
            }
            if (n2.id !== draggedNodeId) {
              n2.vx -= fx;
              n2.vy -= fy;
            }
          }
        });
        
        // 3. Gravity & Movement
        nextNodes.forEach(n => {
          if (n.id === draggedNodeId) return;
          
          n.vx += (width / 2 - n.x) * 0.012;
          n.vy += (height / 2 - n.y) * 0.012;
          
          n.vx *= 0.78;
          n.vy *= 0.78;
          
          n.x += n.vx;
          n.y += n.vy;
          
          n.x = Math.max(30, Math.min(width - 30, n.x));
          n.y = Math.max(30, Math.min(height - 30, n.y));
        });
        
        return nextNodes;
      });
      
      animFrameId = requestAnimationFrame(tick);
    };
    
    animFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameId);
  }, [graphLinks, draggedNodeId, activeTab]);

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggedNodeId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setGraphNodes(prev =>
      prev.map(n => (n.id === draggedNodeId ? { ...n, x, y, vx: 0, vy: 0 } : n))
    );
  };

  const documents = useQuery({
    queryKey: ["documents", session.activeWorkspaceId],
    queryFn: () => api.documents(session)
  });

  const createMutation = useMutation({
    mutationFn: () => api.createDocument(session, { title, contentText, sourceType: "note" }),
    onSuccess: () => {
      setTitle("");
      setContentText("");
      void queryClient.invalidateQueries({ queryKey: ["documents", session.activeWorkspaceId] });
      alert("Text note added to knowledge library!");
      setShowAddForm(false);
    }
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (!uploadFile) throw new Error("No file selected.");
      return api.uploadDocument(session, uploadFile, uploadTitle || undefined);
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadTitle("");
      void queryClient.invalidateQueries({ queryKey: ["documents", session.activeWorkspaceId] });
      alert("Document uploaded and enqueued for background indexing!");
      setShowAddForm(false);
    }
  });

  const indexMutation = useMutation({
    mutationFn: (documentId: string) => api.indexDocument(session, documentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["documents", session.activeWorkspaceId] });
      alert("Document indexing task initiated in background.");
    }
  });

  const searchMutation = useMutation({
    mutationFn: () => api.searchDocuments(session, { query: searchText, topK: 5 })
  });

  const allDocs = documents.data?.documents ?? [];
  
  // Filter docs based on selected folder
  const visibleDocs = allDocs.filter((doc) => {
    if (activeFolder === "all") return true;
    if (activeFolder === "reports") return doc.title.includes("Report");
    if (activeFolder === "recent") {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      return new Date(doc.createdAt) > oneDayAgo;
    }
    return true;
  });

  return (
    <section className="documents-page" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)", position: "relative" }}>
      <div className="page-intro" style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "end" }}>
        <div>
          <p className="eyebrow">Knowledge Center</p>
          <h3>Ground future AI responses in workspace knowledge.</h3>
          <p>Upload files, write plain notes, parse meeting transcripts, or explore the interactive workspace knowledge graph.</p>
        </div>

        {/* Navigation Tabs */}
        <div className="tab-row" style={{ margin: 0, padding: "2px", height: "auto" }}>
          <button className={activeTab === "library" ? "active" : ""} onClick={() => setActiveTab("library")}>
            Knowledge Library
          </button>
          <button className={activeTab === "graph" ? "active" : ""} onClick={() => setActiveTab("graph")}>
            AI Knowledge Graph
          </button>
          <button className={activeTab === "transcript" ? "active" : ""} onClick={() => setActiveTab("transcript")}>
            Meeting-to-Execution
          </button>
        </div>
      </div>

      {activeTab === "library" && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1.5rem", minHeight: "calc(100vh - 120px)", alignItems: "start" }}>
          
          {/* 1. Sidebar Column (Folders & Semantic Search) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            
            {/* Folders Sidebar Filters */}
            <aside className="templates-sidebar">
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, marginBottom: "1rem", fontSize: "0.95rem" }}>
                Folders & Filters
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button
                  className={`template-item ${activeFolder === "all" ? "active" : ""}`}
                  onClick={() => setActiveFolder("all")}
                >
                  <Folder size={14} /> All Documents ({allDocs.length})
                </button>
                <button
                  className={`template-item ${activeFolder === "recent" ? "active" : ""}`}
                  onClick={() => setActiveFolder("recent")}
                >
                  <Clock size={14} /> Recently Uploaded
                </button>
                <button
                  className={`template-item ${activeFolder === "reports" ? "active" : ""}`}
                  onClick={() => setActiveFolder("reports")}
                >
                  <Brain size={14} /> AI Performance Reports
                </button>
              </div>
            </aside>

            {/* Semantic search with citations in Left Column */}
            <section className="semantic-search" style={{ background: "white", padding: "1.25rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.95rem" }}>
                <Search size={16} /> Semantic Search
              </h4>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  searchMutation.mutate();
                }}
                style={{ display: "flex", gap: "0.25rem", margin: "1rem 0 0.5rem 0" }}
              >
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search meaning..."
                  required
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    fontSize: "0.85rem",
                    borderRadius: "6px",
                    border: "1px solid var(--line)"
                  }}
                />
                <button className="primary" style={{ padding: "6px 12px", fontSize: "0.85rem" }}>Search</button>
              </form>

              <div className="search-results" style={{ marginTop: "1rem", maxHeight: "380px", overflowY: "auto", paddingRight: "4px" }}>
                {searchMutation.data?.matches.map((match, idx) => (
                  <article key={match.chunkId} style={{ padding: "0.75rem", borderBottom: "1px solid var(--line)", background: "var(--surface-muted)", borderRadius: "6px", marginBottom: "0.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", fontWeight: "700", gap: "8px" }}>
                      <span style={{ color: "var(--forest-dark)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={match.title}>{match.title}</span>
                      <span className="citation-badge" style={{ flexShrink: 0 }}>
                        [Citation {idx + 1}]
                      </span>
                    </div>
                    <p style={{ fontSize: "0.77rem", margin: "0.4rem 0", color: "var(--muted)", lineHeight: "1.4" }}>{match.chunkText}</p>
                    <small style={{ color: "var(--green-dark)", fontSize: "0.68rem", fontWeight: 600 }}>Similarity: {Math.round(Number(match.similarity) * 100)}%</small>
                  </article>
                ))}
                {searchMutation.isIdle && (
                  <p className="muted-message" style={{ fontSize: "0.8rem", textAlign: "center", marginTop: "1rem" }}>
                    Search keywords to find vector matches in your document database.
                  </p>
                )}
                {searchMutation.data?.matches && searchMutation.data.matches.length === 0 && (
                  <p className="muted-message" style={{ fontSize: "0.8rem", textAlign: "center", marginTop: "1rem" }}>
                    No matching context chunks found.
                  </p>
                )}
              </div>
            </section>
          </div>

          {/* 2. Main Content Column */}
          <main style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "white", padding: "1.25rem", borderRadius: "12px", border: "1px solid var(--line)" }}>
              <div>
                <h4 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, margin: 0, color: "var(--forest-dark)", fontSize: "1.1rem" }}>
                  Workspace Documents
                </h4>
                <span style={{ color: "var(--muted)", fontSize: "0.8rem", marginTop: "4px", display: "block" }}>
                  Index files and text notes to ground the workspace AI responses.
                </span>
              </div>
              {canContribute && (
                <button 
                  className="primary" 
                  onClick={() => {
                    setShowAddForm(!showAddForm);
                    if (!showAddForm) setActiveAddTab("note");
                  }}
                  style={{ gap: "6px" }}
                >
                  <Plus size={16} /> Add to Knowledge
                </button>
              )}
            </header>

            {/* Collapsible Forms Section */}
            {showAddForm && (
              <div className="knowledge-compose" style={{ position: "relative" }}>
                <button
                  onClick={() => setShowAddForm(false)}
                  style={{
                    position: "absolute",
                    top: "12px",
                    right: "12px",
                    background: "transparent",
                    color: "var(--muted)",
                    padding: 0
                  }}
                  title="Close composer"
                >
                  <X size={16} />
                </button>

                <div style={{ display: "flex", gap: "1rem", borderBottom: "1px solid var(--line)", marginBottom: "1.25rem" }}>
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "8px 12px",
                      borderBottom: activeAddTab === "note" ? "2px solid var(--green)" : "none",
                      fontWeight: activeAddTab === "note" ? 700 : 400,
                      color: activeAddTab === "note" ? "var(--forest-dark)" : "var(--muted)",
                      cursor: "pointer"
                    }}
                    onClick={() => setActiveAddTab("note")}
                  >
                    Write Text Note
                  </button>
                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: "8px 12px",
                      borderBottom: activeAddTab === "file" ? "2px solid var(--green)" : "none",
                      fontWeight: activeAddTab === "file" ? 700 : 400,
                      color: activeAddTab === "file" ? "var(--forest-dark)" : "var(--muted)",
                      cursor: "pointer"
                    }}
                    onClick={() => setActiveAddTab("file")}
                  >
                    Upload File
                  </button>
                </div>

                {activeAddTab === "note" ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      createMutation.mutate();
                    }}
                  >
                    <Field label="Title" value={title} onChange={setTitle} />
                    <label className="field" style={{ marginTop: "0.75rem" }}>
                      <span>Knowledge text</span>
                      <textarea
                        value={contentText}
                        onChange={(event) => setContentText(event.target.value)}
                        required
                        style={{ height: "120px", resize: "vertical" }}
                        placeholder="Enter knowledge base text, instructions, or process steps..."
                      />
                    </label>
                    {createMutation.error && <p className="form-error">{createMutation.error.message}</p>}
                    <button className="primary" style={{ marginTop: "1rem" }}>Save note</button>
                  </form>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      uploadMutation.mutate();
                    }}
                  >
                    <div style={{ margin: "0.5rem 0 1rem 0", border: "1px dashed var(--line)", padding: "1.5rem", borderRadius: "8px", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem", background: "var(--surface)" }}>
                      <input
                        type="file"
                        id="file-upload-input"
                        accept=".pdf,.txt,.csv,.md,.markdown,.doc,.docx"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const files = e.target.files;
                          if (files && files[0]) {
                            setUploadFile(files[0]);
                            if (!uploadTitle) {
                              setUploadTitle(files[0].name.replace(/\.[^/.]+$/, ""));
                            }
                          }
                        }}
                        required
                      />
                      <label htmlFor="file-upload-input" className="secondary" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <FileText size={16} /> Choose File
                      </label>
                      <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                        {uploadFile ? `Selected: ${uploadFile.name} (${Math.round(uploadFile.size / 1024)} KB)` : "Supports PDF, TXT, CSV, DOCX, Markdown"}
                      </span>
                    </div>
                    <Field label="Document Title (Optional)" value={uploadTitle} onChange={setUploadTitle} />
                    {uploadMutation.error && <p className="form-error">{uploadMutation.error.message}</p>}
                    <button className="primary" style={{ marginTop: "1rem" }} disabled={uploadMutation.isPending}>
                      {uploadMutation.isPending ? "Uploading..." : "Upload file"}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Documents list */}
            {documents.isLoading ? (
              <LoadingSpinner message="Retrieving knowledge documents..." />
            ) : (
              <div className="document-list">
                {visibleDocs.map((doc) => (
                  <article key={doc.id}>
                    <FileText size={18} />
                    <div>
                      <strong>{doc.title}</strong>
                      <small>Source: {doc.sourceType} • Created: {new Date(doc.createdAt).toLocaleDateString()}</small>
                    </div>
                    <em className={`status ${doc.status}`} style={{ textTransform: "capitalize" }}>{doc.status}</em>
                    
                    <div style={{ display: "flex", gap: "0.25rem", marginLeft: "auto" }}>
                      <button
                        className="secondary"
                        style={{ padding: "4px 8px", fontSize: "0.8rem", height: "auto", margin: 0 }}
                        onClick={() => setSelectedDoc(doc)}
                      >
                        View
                      </button>
                      {canContribute && doc.status !== "indexed" && (
                        <button
                          className="primary"
                          style={{ padding: "4px 8px", fontSize: "0.8rem", height: "auto", margin: 0 }}
                          onClick={() => indexMutation.mutate(doc.id)}
                        >
                          Index
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {visibleDocs.length === 0 && (
                  <p className="muted-message" style={{ textAlign: "center", padding: "2rem" }}>
                    No documents found matching this folder filter.
                  </p>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {/* AI Knowledge Graph */}
      {activeTab === "graph" && (
        <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
            <div>
              <h4 style={{ margin: 0, fontFamily: "var(--font-premium)", fontWeight: 800, color: "var(--forest-dark)" }}>AI Workspace Knowledge Graph</h4>
              <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Interactive representation of connections between Tasks, Documents, Stages, and Team Members. Drag nodes to explore relationships.</span>
            </div>
            <button className="secondary" onClick={() => knowledgeGraph.refetch()} style={{ padding: "0.5rem 1rem", fontSize: "0.8rem", border: "1px solid var(--line)" }}>
              Refresh Graph
            </button>
          </div>
          
          {knowledgeGraph.isLoading ? (
            <LoadingSpinner message="Graphing workspace nodes..." />
          ) : (
            <div style={{ position: "relative", width: "100%", height: "520px", background: "var(--surface-muted)", borderRadius: "12px", border: "1px solid var(--line)", overflow: "hidden" }}>
              {/* Legend overlay */}
              <div style={{ position: "absolute", top: "12px", left: "12px", background: "rgba(255,255,255,0.9)", padding: "10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "0.75rem", display: "flex", flexDirection: "column", gap: "6px", zIndex: 10 }}>
                <span style={{ fontWeight: 700 }}>Node Groups:</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#f97316" }} /> Task</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#3b82f6" }} /> Document</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#10b981" }} /> Member</span>
                <span style={{ display: "flex", alignItems: "center", gap: "6px" }}><span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#64748b" }} /> Stage</span>
              </div>
              
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 800 500"
                style={{ cursor: draggedNodeId ? "grabbing" : "grab" }}
                onMouseMove={handleSvgMouseMove}
                onMouseUp={() => setDraggedNodeId(null)}
                onMouseLeave={() => setDraggedNodeId(null)}
              >
                {/* 1. Links */}
                {graphLinks.map((link, idx) => {
                  const sourceNode = graphNodes.find(n => n.id === (typeof link.source === 'object' ? link.source.id : link.source));
                  const targetNode = graphNodes.find(n => n.id === (typeof link.target === 'object' ? link.target.id : link.target));
                  if (!sourceNode || !targetNode) return null;
                  return (
                    <g key={`link-${idx}`}>
                      <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke="rgba(0,0,0,0.15)"
                        strokeWidth="1.5"
                        strokeDasharray={link.type === "referenced_by" ? "4" : "0"}
                      />
                    </g>
                  );
                })}
                
                {/* 2. Nodes */}
                {graphNodes.map(node => {
                  const colorMap = {
                    task: "#f97316",
                    document: "#3b82f6",
                    member: "#10b981",
                    stage: "#64748b"
                  };
                  const color = colorMap[node.group as keyof typeof colorMap] || "#64748b";
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setDraggedNodeId(node.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <circle
                        r={node.group === "member" ? 18 : 12}
                        fill={color}
                        stroke="#fff"
                        strokeWidth="2.5"
                        style={{
                          filter: "drop-shadow(0px 3px 6px rgba(0,0,0,0.15))"
                        }}
                      />
                      <text
                        y={node.group === "member" ? 28 : 22}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill="var(--forest-dark)"
                        style={{
                          pointerEvents: "none",
                          userSelect: "none"
                        }}
                      >
                        {node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
        </div>
      )}

      {activeTab === "transcript" && (
        <div className="card-premium" style={{ background: "white", padding: "1.5rem", borderRadius: "16px", border: "1px solid var(--line)" }}>
          <h4 style={{ margin: "0 0 0.5rem 0", fontFamily: "var(--font-premium)", fontWeight: 800, color: "var(--forest-dark)" }}>AI Meeting-to-Execution Pipeline 🎙️</h4>
          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "1.5rem" }}>
            Paste a transcript of your meeting notes, discussions, or call logs. Our LLM will auto-extract, prioritize, and assign action items for bulk execution.
          </p>
          
          <div style={{ display: "grid", gridTemplateColumns: extractedTasks.length > 0 ? "1fr 1.2fr" : "1fr", gap: "1.5rem" }}>
            
            {/* Input Transcript Area */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <label className="field" style={{ margin: 0 }}>
                <span>Meeting Transcript notes</span>
                <textarea
                  value={meetingTranscriptText}
                  onChange={(e) => setMeetingTranscriptText(e.target.value)}
                  style={{ height: "300px", resize: "vertical", fontSize: "0.85rem", lineHeight: "1.5" }}
                  placeholder="Example transcript:
John: We need to design the dashboard component by Friday. Lisa, can you handle that?
Lisa: Sure, I will start today.
John: Also, Mark, please test the database migration timeouts before Wednesday.
Mark: Got it, I will write the benchmark scripts."
                />
              </label>
              <button
                className="primary"
                onClick={() => extractTranscriptMutation.mutate(meetingTranscriptText)}
                disabled={extractTranscriptMutation.isPending || !meetingTranscriptText.trim()}
                style={{ padding: "0.75rem 1.25rem" }}
              >
                {extractTranscriptMutation.isPending ? "Analyzing & Extracting tasks..." : "Analyze & Extract Action Items"}
              </button>
            </div>

            {/* Extracted Preview Panel */}
            {extractedTasks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem", borderLeft: "1px solid var(--line)", paddingLeft: "1.5rem" }}>
                <h5 style={{ margin: 0, fontFamily: "var(--font-premium)", fontWeight: 700, color: "var(--forest-dark)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <Sparkles size={16} style={{ color: "#7c3aed" }} /> Preview Extracted Items
                </h5>
                
                {extractedSummary && (
                  <div style={{ background: "var(--surface-muted)", padding: "0.75rem", borderRadius: "8px", fontSize: "0.8rem", color: "var(--forest-dark)", border: "1px solid var(--line)", lineHeight: "1.5" }}>
                    <strong>Brief Summary:</strong>
                    <p style={{ margin: "4px 0 0 0" }}>{extractedSummary}</p>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "380px", overflowY: "auto", paddingRight: "4px" }}>
                  {extractedTasks.map((task, idx) => (
                    <article key={idx} className="card-premium" style={{ background: "white", padding: "0.75rem", borderRadius: "8px", border: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className={`priority ${task.priority}`} style={{ fontSize: "0.65rem", padding: "2px 6px" }}>{task.priority}</span>
                        {task.assigneeName && (
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: 600 }}>Assignee: {task.assigneeName}</span>
                        )}
                      </div>
                      <h6 style={{ margin: "6px 0 4px 0", fontSize: "0.85rem", fontWeight: 700, color: "var(--forest-dark)" }}>{task.title}</h6>
                      <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--muted)", lineHeight: "1.4" }}>{task.description}</p>
                    </article>
                  ))}
                </div>

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "auto" }}>
                  <button
                    className="primary"
                    onClick={() => executeTranscriptMutation.mutate(extractedTasks)}
                    disabled={executeTranscriptMutation.isPending}
                    style={{ flex: 1, padding: "0.65rem" }}
                  >
                    {executeTranscriptMutation.isPending ? "Creating tasks..." : `Approve & Create ${extractedTasks.length} Tasks`}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setExtractedTasks([]);
                      setExtractedSummary(null);
                    }}
                    style={{ padding: "0.65rem" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Slide-out details summary Drawer */}
      {selectedDoc && (
        <div className="document-details-drawer">
          <button
            onClick={() => setSelectedDoc(null)}
            style={{
              position: "absolute",
              top: "20px",
              right: "20px",
              background: "transparent",
              color: "var(--muted)",
              padding: 0
            }}
          >
            <X size={20} />
          </button>

          <h4>Document metadata</h4>
          
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem", color: "var(--forest-dark)" }}>
            <p><strong>Title:</strong> {selectedDoc.title}</p>
            <p><strong>Source:</strong> {selectedDoc.sourceType}</p>
            <p><strong>Status:</strong> <span className={`status ${selectedDoc.status}`} style={{ textTransform: "capitalize" }}>{selectedDoc.status}</span></p>
            <p><strong>Created at:</strong> {new Date(selectedDoc.createdAt).toLocaleString()}</p>
          </div>

          <div style={{ height: "1px", background: "var(--line)", margin: "0.5rem 0" }} />

          <div>
            <h5 style={{ fontFamily: "var(--font-premium)", fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.5rem" }}>
              AI Summary & Insights
            </h5>
            <div className="summary-box">
              {selectedDoc.summary || (
                <span style={{ fontStyle: "italic", opacity: 0.85 }}>
                  AI Summary has not been generated yet. Document will be summarized during its vector indexing phase.
                </span>
              )}
            </div>
          </div>

          <button
            className="primary"
            style={{ marginTop: "auto", gap: "4px" }}
            onClick={() => {
              navigate("/ai", { state: { prefill: `Explain contents of document "${selectedDoc.title}"` } });
              setSelectedDoc(null);
            }}
          >
            Ask AI about this doc <ArrowRight size={14} />
          </button>
        </div>
      )}
    </section>
  );
}
