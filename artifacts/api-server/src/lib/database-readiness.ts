import { pool } from "@workspace/db";

// Read-only: schema application belongs to the approved development setup /
// post-merge flow, never to application startup (including production).
const requiredTables = [
  { name: "judging_rooms", columns: "id, state, expires_at" },
  { name: "judging_rate_limits", columns: "key, hits, reset_at" },
] as const;

export async function assertDatabaseReady(): Promise<void> {
  for (const table of requiredTables) {
    try {
      // LIMIT 0 checks name resolution and SELECT access without reading rooms.
      await pool.query(`SELECT ${table.columns} FROM ${table.name} LIMIT 0`);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "42P01" || code === "42703") {
        throw new Error(
          `Database schema is not ready: ${table.name} has a missing table or required column ` +
          `(PostgreSQL ${code}). 開発DBのスキーマ適用が必要です。` +
          "開発DBであることを確認し、承認された手順で " +
          "`pnpm --filter @workspace/db run push` を実行してください。" +
          "共有DBは無断変更せず、本番DBにはこのコマンドを実行しないでください。" +
          " No schema was changed by this check.",
        );
      }
      // Avoid turning permissions / connectivity failures into migration advice.
      throw new Error(`Database readiness check failed for ${table.name} (PostgreSQL ${code ?? "unknown"}).`, { cause: error });
    }
  }
}
