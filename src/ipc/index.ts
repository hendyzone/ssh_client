import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Group {
  id: string;
  name: string;
  parentId: string | null;
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

/** 会话层 IPC：SSH 连接、读写、调整大小、关闭及事件订阅 */
export const session = {
  connect: (p: {
    sessionId: string; address: string; port: number; username: string;
    password: string; cols: number; rows: number;
  }) => invoke<void>("connect_cmd", p),
  write: (sessionId: string, data: number[]) => invoke<void>("write_cmd", { sessionId, data }),
  resize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>("resize_cmd", { sessionId, cols, rows }),
  close: (sessionId: string) => invoke<void>("close_cmd", { sessionId }),
  onData: (sessionId: string, cb: (bytes: Uint8Array) => void): Promise<UnlistenFn> =>
    listen<number[]>(`ssh://${sessionId}/data`, (e) => cb(new Uint8Array(e.payload))),
  onClosed: (sessionId: string, cb: () => void): Promise<UnlistenFn> =>
    listen(`ssh://${sessionId}/closed`, () => cb()),
};
