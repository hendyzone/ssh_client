use crate::models::{Group, Host};
use rusqlite::Connection;

pub fn create_group(conn: &Connection, name: &str, parent_id: Option<&str>) -> rusqlite::Result<Group> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO groups (id, name, parent_id) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, name, parent_id],
    )?;
    Ok(Group { id, name: name.to_string(), parent_id: parent_id.map(String::from) })
}

pub fn list_groups(conn: &Connection) -> rusqlite::Result<Vec<Group>> {
    let mut stmt = conn.prepare("SELECT id, name, parent_id FROM groups ORDER BY name")?;
    let rows = stmt.query_map([], |r| {
        Ok(Group { id: r.get(0)?, name: r.get(1)?, parent_id: r.get(2)? })
    })?;
    rows.collect()
}

pub fn rename_group(conn: &Connection, id: &str, name: &str) -> rusqlite::Result<()> {
    conn.execute("UPDATE groups SET name = ?2 WHERE id = ?1", rusqlite::params![id, name])?;
    Ok(())
}

pub fn delete_group(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM groups WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

fn row_to_host(r: &rusqlite::Row) -> rusqlite::Result<Host> {
    let tags_json: String = r.get(6)?;
    Ok(Host {
        id: r.get(0)?,
        name: r.get(1)?,
        address: r.get(2)?,
        port: r.get(3)?,
        username: r.get(4)?,
        group_id: r.get(5)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        auth_type: r.get(7)?,
        credential_ref: r.get(8)?,
        proxy_jump: r.get(9)?,
    })
}

pub fn upsert_host(conn: &Connection, host: &Host) -> rusqlite::Result<()> {
    let tags_json = serde_json::to_string(&host.tags).unwrap();
    conn.execute(
        "INSERT INTO hosts (id, name, address, port, username, group_id, tags, auth_type, credential_ref, proxy_jump)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
           name=?2, address=?3, port=?4, username=?5, group_id=?6,
           tags=?7, auth_type=?8, credential_ref=?9, proxy_jump=?10",
        rusqlite::params![
            host.id, host.name, host.address, host.port, host.username,
            host.group_id, tags_json, host.auth_type, host.credential_ref, host.proxy_jump
        ],
    )?;
    Ok(())
}

pub fn list_hosts(conn: &Connection) -> rusqlite::Result<Vec<Host>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, address, port, username, group_id, tags, auth_type, credential_ref, proxy_jump
         FROM hosts ORDER BY name",
    )?;
    let rows = stmt.query_map([], row_to_host)?;
    rows.collect()
}

pub fn get_host(conn: &Connection, id: &str) -> rusqlite::Result<Option<Host>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, address, port, username, group_id, tags, auth_type, credential_ref, proxy_jump
         FROM hosts WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(rusqlite::params![id], row_to_host)?;
    match rows.next() {
        Some(h) => Ok(Some(h?)),
        None => Ok(None),
    }
}

pub fn delete_host(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM hosts WHERE id = ?1", rusqlite::params![id])?;
    Ok(())
}

/// 读取某主机（"address:port"）已记录的公钥指纹。
pub fn get_known_fingerprint(conn: &Connection, host: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT fingerprint FROM known_hosts WHERE host = ?1")?;
    let mut rows = stmt.query_map(rusqlite::params![host], |r| r.get::<_, String>(0))?;
    match rows.next() {
        Some(fp) => Ok(Some(fp?)),
        None => Ok(None),
    }
}

/// 记录/更新某主机的公钥指纹（TOFU 首次写入；变更确认后由上层决定是否覆盖）。
pub fn set_known_fingerprint(conn: &Connection, host: &str, fingerprint: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO known_hosts (host, fingerprint) VALUES (?1, ?2)
         ON CONFLICT(host) DO UPDATE SET fingerprint = ?2",
        rusqlite::params![host, fingerprint],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_schema;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        init_schema(&c).unwrap();
        c
    }

    #[test]
    fn create_and_list_group() {
        let c = mem();
        let g = create_group(&c, "生产组", None).unwrap();
        let all = list_groups(&c).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "生产组");
        assert_eq!(all[0].id, g.id);
    }

    #[test]
    fn rename_and_delete_group() {
        let c = mem();
        let g = create_group(&c, "旧名", None).unwrap();
        rename_group(&c, &g.id, "新名").unwrap();
        assert_eq!(list_groups(&c).unwrap()[0].name, "新名");
        delete_group(&c, &g.id).unwrap();
        assert!(list_groups(&c).unwrap().is_empty());
    }

    fn sample_host(id: &str) -> Host {
        Host {
            id: id.to_string(),
            name: "web1".into(),
            address: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            group_id: None,
            tags: vec!["prod".into(), "web".into()],
            auth_type: "password".into(),
            credential_ref: None,
            proxy_jump: None,
        }
    }

    #[test]
    fn upsert_get_and_list_host() {
        let c = mem();
        let mut h = sample_host("h1");
        upsert_host(&c, &h).unwrap();
        assert_eq!(list_hosts(&c).unwrap().len(), 1);
        // 更新同 id
        h.name = "web1-renamed".into();
        upsert_host(&c, &h).unwrap();
        let got = get_host(&c, "h1").unwrap().unwrap();
        assert_eq!(got.name, "web1-renamed");
        assert_eq!(got.tags, vec!["prod".to_string(), "web".to_string()]);
    }

    #[test]
    fn delete_host_removes_it() {
        let c = mem();
        upsert_host(&c, &sample_host("h1")).unwrap();
        delete_host(&c, "h1").unwrap();
        assert!(get_host(&c, "h1").unwrap().is_none());
    }

    #[test]
    fn known_fingerprint_roundtrip() {
        let c = mem();
        assert_eq!(get_known_fingerprint(&c, "1.2.3.4:22").unwrap(), None);
        set_known_fingerprint(&c, "1.2.3.4:22", "SHA256:abc").unwrap();
        assert_eq!(get_known_fingerprint(&c, "1.2.3.4:22").unwrap(), Some("SHA256:abc".to_string()));
        set_known_fingerprint(&c, "1.2.3.4:22", "SHA256:def").unwrap();
        assert_eq!(get_known_fingerprint(&c, "1.2.3.4:22").unwrap(), Some("SHA256:def".to_string()));
    }

    #[test]
    fn deleting_group_nulls_member_host_group_id() {
        let c = mem();
        let g = create_group(&c, "组A", None).unwrap();
        let mut h = sample_host("h-cascade");
        h.group_id = Some(g.id.clone());
        upsert_host(&c, &h).unwrap();
        // 删除分组
        delete_group(&c, &g.id).unwrap();
        // 主机仍在，但 group_id 被置空
        let got = get_host(&c, "h-cascade").unwrap().unwrap();
        assert_eq!(got.group_id, None);
        // 分组已删
        assert!(list_groups(&c).unwrap().is_empty());
    }
}
