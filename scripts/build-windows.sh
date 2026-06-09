#!/usr/bin/env bash
# 在 Linux 上交叉编译 Windows exe（cargo-xwin + NSIS）。
#
# 一次性安装的依赖（见下；llvm/lld/nsis/nasm 需要 sudo）：
#   rustup target add x86_64-pc-windows-msvc
#   cargo install --locked cargo-xwin
#   sudo apt-get install -y lld nsis nasm llvm-14
#   mkdir -p ~/.local/bin && ln -sf /usr/lib/llvm-14/bin/clang ~/.local/bin/clang-cl
#
# 工具链说明：
#   - cargo-xwin 自动下载 Windows SDK/CRT 到 ~/.cache/cargo-xwin
#   - clang-cl 是 clang 的 cl 兼容驱动（软链接到 clang 即可）
#   - llvm-lib/llvm-dlltool 来自 /usr/lib/llvm-14/bin（aws-lc-sys 打静态库需要）
#   - nasm 供 aws-lc-sys（russh 的加密后端 aws-lc-rs）编译汇编
#   - 只打 nsis 安装包；msi(WiX) 需要 wine，未启用
set -euo pipefail

export PATH="$HOME/.local/bin:/usr/lib/llvm-14/bin:$PATH"

cd "$(dirname "$0")/.."

npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --bundles nsis

echo ""
echo "构建完成，产物："
echo "  应用本体: src-tauri/target/x86_64-pc-windows-msvc/release/hendyzone-ssh.exe"
echo "  安装  包: src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Hendyzone SSH_0.1.0_x64-setup.exe"
