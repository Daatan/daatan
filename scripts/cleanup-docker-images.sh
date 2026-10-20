#!/bin/bash
#
# Prune old daatan-app Docker images so the host does not run out of disk
# during a deploy. Keeps the 2*N newest images of the ECR daatan-app repo
# (default N=3: roughly 3 app + 3 migrations builds). Never removes an image
# that a container (running or stopped) uses, nor the one the local
# daatan-app:* / daatan-migrations:* tags point at.
#
# Usage: cleanup-docker-images.sh [KEEP_COUNT]
# Designed to run on the EC2 host via SSM, before a pull.
#
# Selection is by image ID, not tag (daatan#1987): since daatan#1954 the deploy
# pulls `daatan-app@sha256:<digest>`, so those images have no tag at all and a
# tag-based pass matched nothing while 35 images filled the staging disk. They
# aren't dangling either (they keep a RepoDigest), so `docker image prune` skips
# them too.
#

set -u

KEEP_COUNT="${1:-3}"
KEEP_IMAGES=$((KEEP_COUNT * 2))
ECR_REPO="${ECR_REPO:-272007598366.dkr.ecr.eu-central-1.amazonaws.com/daatan-app}"

echo "🧹 Cleaning up old Docker images (keeping newest $KEEP_IMAGES daatan-app images)..."
echo "   Disk before:"
df -h / | awk 'NR==2 {print "   " $0}'

# Every image of the repo, tagged or digest-only, newest first, one line per ID.
mapfile -t image_ids < <(
    docker images --no-trunc --format '{{.CreatedAt}}|{{.ID}}' "$ECR_REPO" \
        | sort -r | awk -F'|' '!seen[$2]++ {print $2}'
)

# Images any container was created from, running or not.
in_use=" $(docker ps -aq | xargs -r docker inspect --format '{{.Image}}' 2>/dev/null | tr '\n' ' ') "

removed=0
for id in "${image_ids[@]:$KEEP_IMAGES}"; do
    [[ "$in_use" == *" $id "* ]] && continue
    # Remove each reference the image holds; Docker deletes it with the last
    # one. An image still carrying a local tag (daatan-app:latest,
    # daatan-migrations:staging-latest, ...) is the current deploy's — skip it.
    mapfile -t refs < <(docker inspect --format '{{range .RepoTags}}{{println .}}{{end}}{{range .RepoDigests}}{{println .}}{{end}}' "$id" 2>/dev/null | sed '/^$/d')
    skip=false
    for ref in "${refs[@]}"; do
        [[ "$ref" == "$ECR_REPO"[:@]* ]] || skip=true
    done
    $skip && continue
    for ref in "${refs[@]}"; do
        docker rmi "$ref" >/dev/null 2>&1 || true
    done
    if ! docker image inspect "$id" >/dev/null 2>&1; then
        echo "   removed: ${id#sha256:}" | cut -c1-28
        removed=$((removed + 1))
    fi
done

echo "   Removed $removed images."

# Drop dangling layers left behind by the rmi pass.
docker system prune -f >/dev/null 2>&1 || true

echo "   Disk after:"
df -h / | awk 'NR==2 {print "   " $0}'
