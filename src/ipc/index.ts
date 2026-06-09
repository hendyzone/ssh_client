import { invoke } from "@tauri-apps/api/core";

export interface Group {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface Host {
  id: string;
  name: string;
  address: string;
  port: number;
  username: string;
  groupId: string | null;
  tags: string[];
  authType: string;
  credentialRef: string | null;
  proxyJump: string | null;
}

export const api = {
  listGroups: () => invoke<Group[]>("list_groups_cmd"),
  createGroup: (name: string, parentId: string | null) =>
    invoke<Group>("create_group_cmd", { name, parentId }),
  renameGroup: (id: string, name: string) => invoke<void>("rename_group_cmd", { id, name }),
  deleteGroup: (id: string) => invoke<void>("delete_group_cmd", { id }),
  listHosts: () => invoke<Host[]>("list_hosts_cmd"),
  upsertHost: (host: Host) => invoke<void>("upsert_host_cmd", { host }),
  deleteHost: (id: string) => invoke<void>("delete_host_cmd", { id }),
};
