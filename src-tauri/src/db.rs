use rusqlite::Connection;

/// 在给定连接上建表（幂等）。
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    // 每个连接都需要显式开启外键约束（SQLite 默认关闭）
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT
        );
        CREATE TABLE IF NOT EXISTS hosts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT NOT NULL,
            group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
            tags TEXT NOT NULL,            -- JSON 数组字符串
            auth_type TEXT NOT NULL,
            credential_ref TEXT,
            proxy_jump TEXT,
            key_path TEXT,
            use_tmux INTEGER NOT NULL DEFAULT 0,
            tmux_session TEXT
        );
        CREATE TABLE IF NOT EXISTS known_hosts (
            host TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL
        );
        ",
    )?;
    // 迁移：为早期版本建立的库补列（已存在则跳过，保持幂等）。
    add_column_if_missing(conn, "hosts", "key_path", "TEXT")?;
    add_column_if_missing(conn, "hosts", "use_tmux", "INTEGER NOT NULL DEFAULT 0")?;
    add_column_if_missing(conn, "hosts", "tmux_session", "TEXT")?;
    Ok(())
}

/// 若指定表缺少某列则 ALTER 添加；列已存在时静默跳过（用于幂等迁移）。
fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|c| c.ok())
        .any(|c| c == column);
    if !exists {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl};"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_creates_tables() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        // 再次调用应幂等，不报错
        init_schema(&conn).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('groups','hosts')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }
}
