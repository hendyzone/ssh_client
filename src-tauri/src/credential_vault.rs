//! 系统钥匙串封装。明文凭据只存系统钥匙串，数据库仅存 credential_ref（= host id）。
//!
//! 单元测试用自定义全局 HashMap mock（headless Linux 无 secret-service，且 keyring 3.x
//! 的内置 mock 是 per-Entry 的，无跨调用持久化，不适合 roundtrip 测试）。
//! 真实后端（Windows Credential Manager）在目标平台手动验证。

const SERVICE: &str = "ssh-client";

/// 存储某 reference（一般是 host id）对应的密码。
pub fn store(reference: &str, secret: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())?;
    entry.set_password(secret).map_err(|e| e.to_string())
}

/// 读取密码。无条目时返回 Ok(None)。
pub fn get(reference: &str) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 删除密码。无条目时视作成功（幂等）。
pub fn delete(reference: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, reference).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring::credential::{Credential, CredentialApi, CredentialBuilder, CredentialBuilderApi, CredentialPersistence};
    use std::collections::HashMap;
    use std::sync::{Mutex, Once, OnceLock};

    // ──────────────────────────────────────────────────────────────────────────
    // 全局 HashMap mock：持久化存储在进程内，支持跨 Entry::new 调用的 roundtrip 测试。
    // keyring 3.x 内置 mock 是 per-Entry（EntryOnly），无法测试我们的 store/get/delete。
    // ──────────────────────────────────────────────────────────────────────────

    /// 全局密码表：key = "service\0user"，value = 密码字符串。
    static GLOBAL_STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

    fn global_store() -> &'static Mutex<HashMap<String, String>> {
        GLOBAL_STORE.get_or_init(|| Mutex::new(HashMap::new()))
    }

    fn map_key(service: &str, user: &str) -> String {
        format!("{}\0{}", service, user)
    }

    /// 有全局持久化的 mock credential。
    struct MapCredential {
        key: String,
    }

    impl CredentialApi for MapCredential {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            let pw = String::from_utf8(secret.to_vec())
                .map_err(|e| keyring::Error::Invalid("secret".into(), e.to_string()))?;
            global_store().lock().unwrap().insert(self.key.clone(), pw);
            Ok(())
        }

        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            match global_store().lock().unwrap().get(&self.key) {
                Some(v) => Ok(v.as_bytes().to_vec()),
                None => Err(keyring::Error::NoEntry),
            }
        }

        fn delete_credential(&self) -> keyring::Result<()> {
            match global_store().lock().unwrap().remove(&self.key) {
                Some(_) => Ok(()),
                None => Err(keyring::Error::NoEntry),
            }
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    /// MapCredential 的 builder。
    struct MapCredentialBuilder;

    impl CredentialBuilderApi for MapCredentialBuilder {
        fn build(
            &self,
            _target: Option<&str>,
            service: &str,
            user: &str,
        ) -> keyring::Result<Box<Credential>> {
            Ok(Box::new(MapCredential {
                key: map_key(service, user),
            }))
        }

        fn as_any(&self) -> &dyn std::any::Any {
            self
        }

        fn persistence(&self) -> CredentialPersistence {
            CredentialPersistence::ProcessOnly
        }
    }

    static INIT: Once = Once::new();

    fn use_mock() {
        INIT.call_once(|| {
            keyring::set_default_credential_builder(Box::new(MapCredentialBuilder));
        });
    }

    #[test]
    fn store_get_delete_roundtrip() {
        use_mock();
        let r = "host-roundtrip";
        assert_eq!(get(r).unwrap(), None);
        store(r, "s3cret").unwrap();
        assert_eq!(get(r).unwrap(), Some("s3cret".to_string()));
        delete(r).unwrap();
        assert_eq!(get(r).unwrap(), None);
        delete(r).unwrap(); // 幂等
    }

    #[test]
    fn overwrite_updates_secret() {
        use_mock();
        let r = "host-overwrite";
        store(r, "old").unwrap();
        store(r, "new").unwrap();
        assert_eq!(get(r).unwrap(), Some("new".to_string()));
        delete(r).unwrap();
    }
}
