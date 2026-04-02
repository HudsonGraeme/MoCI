#!/usr/bin/env bash
set -e

OPENWRT_VERSION="24.10.0"
BASE_URL="https://downloads.openwrt.org/releases/${OPENWRT_VERSION}/targets/armsr/armv7"
IMAGE_DIR="./vm/arm"
KERNEL_FILE="${IMAGE_DIR}/openwrt-kernel.bin"
ROOTFS_FILE="${IMAGE_DIR}/openwrt-rootfs.img"

echo "Setting up OpenWrt ARM QEMU environment..."
echo "This will emulate ARM Cortex-A (armv7) for testing lighttpd/TurrisOS compatibility"
echo ""

if ! command -v qemu-system-arm &> /dev/null; then
    echo "QEMU ARM not found. Installing via Homebrew..."
    brew install qemu
fi

mkdir -p "${IMAGE_DIR}"

if [ ! -f "${KERNEL_FILE}" ]; then
    echo "Downloading OpenWrt ${OPENWRT_VERSION} ARM kernel..."
    curl -L "${BASE_URL}/openwrt-${OPENWRT_VERSION}-armsr-armv7-generic-kernel.bin" -o "${KERNEL_FILE}"
else
    echo "Kernel already exists at ${KERNEL_FILE}"
fi

if [ ! -f "${ROOTFS_FILE}" ]; then
    echo "Downloading OpenWrt ${OPENWRT_VERSION} ARM rootfs..."
    curl -L "${BASE_URL}/openwrt-${OPENWRT_VERSION}-armsr-armv7-generic-ext4-rootfs.img.gz" -o "${IMAGE_DIR}/rootfs.img.gz"

    echo "Extracting rootfs..."
    gunzip "${IMAGE_DIR}/rootfs.img.gz"
    mv "${IMAGE_DIR}/rootfs.img" "${ROOTFS_FILE}"

    echo "Resizing rootfs to 512MB..."
    qemu-img resize "${ROOTFS_FILE}" 512M
else
    echo "Rootfs already exists at ${ROOTFS_FILE}"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Run: ./scripts/start-vm-arm.sh"
echo "2. Wait for boot (may take a while - ARM emulation is slow)"
echo "3. Install lighttpd: opkg update && opkg install lighttpd lighttpd-mod-cgi"
echo "4. Deploy MoCI with lighttpd config"
