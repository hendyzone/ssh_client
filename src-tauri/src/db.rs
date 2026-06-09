use rusqlite::Connection;

/// 在给定连接上建表（幂等）。
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
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
            group_id TEXT,
            tags TEXT NOT NULL,            -- JSON 数组字符串
            auth_type TEXT NOT NULL,
            credential_ref TEXT,
            proxy_jump TEXT
        );
        ",
    )
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
