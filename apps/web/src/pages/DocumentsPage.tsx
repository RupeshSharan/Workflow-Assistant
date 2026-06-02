import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { api } from "../api";
import { Field } from "../components/common/Field";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session } from "../types";

interface DocumentsPageProps {
  session: Session;
  canContribute: boolean;
}

export function DocumentsPage({ session, canContribute }: DocumentsPageProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [contentText, setContentText] = useState("");
  const [searchText, setSearchText] = useState("");

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
    }
  });

  const indexMutation = useMutation({
    mutationFn: (documentId: string) => api.indexDocument(session, documentId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["documents", session.activeWorkspaceId] })
  });

  const searchMutation = useMutation({
    mutationFn: () => api.searchDocuments(session, { query: searchText, topK: 5 })
  });

  return (
    <section className="documents-page">
      <div className="page-intro">
        <p className="eyebrow">Knowledge library</p>
        <h3>Ground future AI responses in workspace knowledge.</h3>
        <p>Text notes can be chunked and indexed through self-hosted Ollama embeddings for scoped semantic retrieval.</p>
      </div>

      <div className="documents-grid">
        {canContribute && (
          <form
            className="knowledge-compose"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
          >
            <h4>Add knowledge note</h4>
            <Field label="Title" value={title} onChange={setTitle} />
            <label className="field">
              <span>Knowledge text</span>
              <textarea value={contentText} onChange={(event) => setContentText(event.target.value)} required />
            </label>
            {createMutation.error && <p className="form-error">{createMutation.error.message}</p>}
            <button className="primary">Save note</button>
          </form>
        )}

        <section className="semantic-search">
          <h4>Semantic search</h4>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              searchMutation.mutate();
            }}
          >
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search indexed knowledge"
              required
            />
            <button className="primary">Search</button>
          </form>
          {searchMutation.error && <p className="form-error">{searchMutation.error.message}</p>}
          <div className="search-results">
            {searchMutation.data?.matches.map((match) => (
              <article key={match.chunkId}>
                <strong>{match.title}</strong>
                <small>{Math.round(Number(match.similarity) * 100)}% similar</small>
                <p>{match.chunkText}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      {documents.isLoading ? (
        <LoadingSpinner message="Loading documents..." />
      ) : (
        <div className="document-list">
          <header>
            <h4>Workspace documents</h4>
            <span>Indexing requires the configured Ollama embedding model.</span>
          </header>
          {documents.data?.documents.map((document) => (
            <article key={document.id}>
              <FileText size={18} />
              <div>
                <strong>{document.title}</strong>
                <small>{new Date(document.createdAt).toLocaleDateString()}</small>
              </div>
              <em className={`status ${document.status}`}>{document.status}</em>
              {canContribute && document.status !== "indexed" && (
                <button className="secondary" onClick={() => indexMutation.mutate(document.id)}>
                  Index
                </button>
              )}
            </article>
          ))}
          {indexMutation.error && <p className="form-error">{indexMutation.error.message}</p>}
        </div>
      )}
    </section>
  );
}
