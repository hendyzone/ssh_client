#!/usr/bin/env bash
# 起一个本地 sshd 容器用于集成测试：tester / testpass，端口 2222
set -e
docker rm -f ssh-itest 2>/dev/null || true
docker run -d --name ssh-itest -p 2222:2222 \
  -e PUID=1000 -e PGID=1000 \
  -e PASSWORD_ACCESS=true \
  -e USER_PASSWORD=testpass \
  -e USER_NAME=tester \
  lscr.io/linuxserver/openssh-server:latest
echo "等待 sshd 启动…"; sleep 8
echo "就绪：tester / testpass @ localhost:2222"
