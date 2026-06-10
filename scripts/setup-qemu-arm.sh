#!/usr/bin/env bash
set -e

OPENWRT_VERSION="24.10.0"
BASE_URL="https://downloads.openwrt.org/releases/${OPENWRT_VERSION}/targets/armsr/armv7"
IMAGE_DIR="./vm/arm"
IMAGE_FILE="${IMAGE_DIR}/openwrt-arm.img"

echo "Setting up OpenWrt ARM QEMU environment..."
echo "This will emulate ARM Cortex-A (armv7) for testing lighttpd/TurrisOS compatibility"
echo ""

if ! command -v qemu-system-arm &> /dev/null; then
    echo "QEMU ARM not found. Installing via Homebrew..."
    brew install qemu
fi

mkdir -p "${IMAGE_DIR}"

if [ ! -f "${IMAGE_FILE}" ]; then
    echo "Downloading OpenWrt ${OPENWRT_VERSION} ARM combined image..."
    curl -fL "${BASE_URL}/openwrt-${OPENWRT_VERSION}-armsr-armv7-generic-ext4-combined-efi.img.gz" -o "${IMAGE_DIR}/combined.img.gz"

    echo "Extracting image..."
    gunzip "${IMAGE_DIR}/combined.img.gz"
    mv "${IMAGE_DIR}/combined.img" "${IMAGE_FILE}"

    echo "Resizing image to 512MB..."
    qemu-img resize "${IMAGE_FILE}" 512M
else
    echo "Image already exists at ${IMAGE_FILE}"
fi

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Run: ./scripts/start-vm-arm.sh"
echo "2. Wait for boot (may take a while - ARM emulation is slow)"
echo "3. Run: ./scripts/setup-lighttpd-vm.sh (in another terminal)"
