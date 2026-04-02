#!/usr/bin/env bash
set -e

IMAGE_DIR="./vm/arm"
IMAGE_FILE="${IMAGE_DIR}/openwrt-arm.img"

if [ ! -f "${IMAGE_FILE}" ]; then
    echo "OpenWrt ARM image not found. Run ./scripts/setup-qemu-arm.sh first."
    exit 1
fi

echo "Starting OpenWrt ARM QEMU..."
echo "NOTE: ARM emulation is slow. Be patient."
echo ""
echo "SSH will be available at: localhost:2223"
echo "Web UI at: http://localhost:8081"
echo ""
echo "Press Ctrl+A then X to quit QEMU"
echo ""

qemu-system-arm \
    -M virt \
    -cpu cortex-a15 \
    -m 256M \
    -bios /opt/homebrew/share/qemu/edk2-arm-code.fd \
    -drive file="${IMAGE_FILE}",if=virtio,format=raw \
    -netdev user,id=lan,hostfwd=tcp::2223-:22,hostfwd=tcp::8081-:80 \
    -device virtio-net-pci,netdev=lan \
    -netdev user,id=wan \
    -device virtio-net-pci,netdev=wan \
    -nographic \
    -no-reboot
