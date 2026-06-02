import { query } from "../db.js";
import type { TenantContext } from "../domain/types.js";
import { embedTexts, toPgVector } from "./ollama.js";

export interface KnowledgeMatch {
  documentId: string;
  title: string;
  chunkId: string;
  chunkText: string;
  similarity: number;
}

export async function searchKnowledge(
  tenant: TenantContext,
  searchText: string,
  topK: number
): Promise<KnowledgeMatch[]> {
  const candidateLimit = Math.max(topK * 2, 20);

  // 1. Fetch vector matches
  let vectorMatches: KnowledgeMatch[] = [];
  try {
    const [embedding] = await embedTexts([searchText]);
    const vectorRes = await query<KnowledgeMatch>(
      `SELECT document.id AS "documentId",
              document.title,
              chunk.id AS "chunkId",
              chunk.chunk_text AS "chunkText",
              1 - (chunk.embedding_vector <=> $3::vector) AS similarity
         FROM document_chunks chunk
         JOIN documents document ON document.id = chunk.document_id
        WHERE document.org_id = $1
          AND document.workspace_id = $2
          AND document.status = 'indexed'
          AND document.deleted_at IS NULL
          AND chunk.embedding_vector IS NOT NULL
        ORDER BY chunk.embedding_vector <=> $3::vector
        LIMIT $4`,
      [tenant.orgId, tenant.workspaceId, toPgVector(embedding!), candidateLimit]
    );
    vectorMatches = vectorRes.rows;
  } catch (error) {
    // If embedding service is down/error, fall back to FTS only
  }

  // 2. Fetch FTS matches using pg tsvector index
  let ftsMatches: {
    documentId: string;
    title: string;
    chunkId: string;
    chunkText: string;
    rank: number;
  }[] = [];
  try {
    const ftsRes = await query<{
      documentId: string;
      title: string;
      chunkId: string;
      chunkText: string;
      rank: number;
    }>(
      `SELECT d.id AS "documentId",
              d.title,
              c.id AS "chunkId",
              c.chunk_text AS "chunkText",
              ts_rank_cd(d.search_vector, plainto_tsquery('english', $3)) AS rank
         FROM documents d
         JOIN document_chunks c ON c.document_id = d.id
        WHERE d.org_id = $1
          AND d.workspace_id = $2
          AND d.status = 'indexed'
          AND d.deleted_at IS NULL
          AND d.search_vector @@ plainto_tsquery('english', $3)
        ORDER BY rank DESC, c.chunk_index ASC
        LIMIT $4`,
      [tenant.orgId, tenant.workspaceId, searchText, candidateLimit]
    );
    ftsMatches = ftsRes.rows;
  } catch (error) {
    // Fall back if FTS has issues (e.g. empty plainto_tsquery)
  }

  // 3. Perform Reciprocal Rank Fusion (RRF)
  const mergedMap = new Map<string, {
    match: KnowledgeMatch;
    vectorRank: number;
    ftsRank: number;
    ftsRankScore: number;
  }>();

  vectorMatches.forEach((match, index) => {
    mergedMap.set(match.chunkId, {
      match,
      vectorRank: index + 1,
      ftsRank: Infinity,
      ftsRankScore: 0
    });
  });

  ftsMatches.forEach((match, index) => {
    const existing = mergedMap.get(match.chunkId);
    if (existing) {
      existing.ftsRank = index + 1;
      existing.ftsRankScore = match.rank;
    } else {
      mergedMap.set(match.chunkId, {
        match: {
          documentId: match.documentId,
          title: match.title,
          chunkId: match.chunkId,
          chunkText: match.chunkText,
          similarity: 0.5 + 0.5 * (match.rank / (1 + match.rank)) // Map FTS rank to 0.5 - 1.0 range
        },
        vectorRank: Infinity,
        ftsRank: index + 1,
        ftsRankScore: match.rank
      });
    }
  });

  const mergedList = Array.from(mergedMap.values()).map((item) => {
    const rrfScore = (item.vectorRank !== Infinity ? 1 / (60 + item.vectorRank) : 0) +
                     (item.ftsRank !== Infinity ? 1 / (60 + item.ftsRank) : 0);
    return {
      ...item.match,
      rrfScore
    };
  });

  // Sort by RRF score descending
  mergedList.sort((a, b) => b.rrfScore - a.rrfScore);

  // Return topK
  return mergedList.slice(0, topK).map(({ rrfScore, ...match }) => match);
}
