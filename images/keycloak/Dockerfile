# Keycloak image of the platform:
# official image by digest, built for PostgreSQL (`kc.sh build`, docs
# "Running Keycloak in a container"), started with `start --optimized`.
# Built, scanned and signed by the forge's CI (repository `keycloak`), like
# the engine: never built on a VM.
FROM quay.io/keycloak/keycloak:26.8.1@sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244 AS upstream

# ponytail: the official image lags RHEL fixes (ca-certificates CRITICAL,
# 2026-10-29); its packages are upgraded at build time with UBI's dnf (the
# Keycloak image has no package manager), rpm database included so that Trivy
# sees the real versions. Drop when a newer Keycloak digest carries them.
FROM registry.access.redhat.com/ubi9/ubi:9.8@sha256:5f08e80aa970ae77712e75e5e857ac0b396abc900823c4d041c1150a9538a13f AS packages
COPY --from=upstream / /mnt/rootfs
RUN dnf --installroot /mnt/rootfs --releasever 9 --setopt install_weak_deps=false --nodocs -y upgrade \
 && dnf --installroot /mnt/rootfs clean all

FROM upstream AS build
# Build options (fixed in the image): PostgreSQL database, health and
# metrics on the management port 9000, never published.
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_METRICS_ENABLED=true
RUN /opt/keycloak/bin/kc.sh build

FROM upstream
COPY --from=packages /mnt/rootfs/ /
COPY --from=build /opt/keycloak/ /opt/keycloak/
# Non-root user of the official image (uid 1000).
USER 1000
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized"]
