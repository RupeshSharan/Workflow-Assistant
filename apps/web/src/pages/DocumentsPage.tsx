import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { FileText, Folder, Clock, Brain, Search, ArrowRight, X, Plus } from "lucide-react";
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
    <section className="documents-page" style={{ padding: "2rem", overflowY: "auto", height: "calc(100vh - 65px)" }}>
      <div className="page-intro" style={{ marginBottom: "1.5rem" }}>
        <p className="eyebrow">Knowledge Center</p>
        <h3>Ground future AI responses in workspace knowledge.</h3>
        <p>Upload files or write plain notes. Ollama will chunk and index them for grounded semantic retrieval.</p>
      </div>

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
