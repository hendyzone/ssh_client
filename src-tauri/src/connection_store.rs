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
}
