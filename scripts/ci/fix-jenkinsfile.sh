#!/bin/bash
# Quick fix script for Jenkinsfile dollar sign issues
# Usage:
#   ./scripts/ci/fix-jenkinsfile.sh
#   ./fix-jenkinsfile.sh   # legacy wrapper

set -e

JENKINSFILE="Jenkinsfile"
BACKUP_DIR="infra/jenkins/_archive"
BACKUP="${BACKUP_DIR}/Jenkinsfile.backup.$(date +%Y%m%d_%H%M%S)"

echo "🔧 Fixing Jenkinsfile dollar sign issues..."

# Create backup
mkdir -p "$BACKUP_DIR"
echo "📦 Creating backup: $BACKUP"
cp "$JENKINSFILE" "$BACKUP"

# Fix common patterns

echo "🔍 Fixing pattern 1: sh blocks with jq commands..."
# These are pure shell, should use single quotes
perl -0777 -i -pe 's/sh """\n(\s+)cat \$\{TRIVY_DIR\}\/trivy-vuln\.json \| \\\n(\s+)jq/sh '"'"'"'"'"'\n$1cat ${TRIVY_DIR}\/trivy-vuln.json | \\\n$2jq/g' "$JENKINSFILE"
perl -0777 -i -pe 's/sh """\n(\s+)cat \$\{TRIVY_DIR\}\/image-scan\.json \| \\\n(\s+)jq/sh '"'"'"'"'"'\n$1cat ${TRIVY_DIR}\/image-scan.json | \\\n$2jq/g' "$JENKINSFILE"

echo "🔍 Fixing pattern 2: Build analysis blocks..."
# Fix BUNDLE_SIZE and MAP_COUNT variables
sed -i 's/BUNDLE_SIZE=\\$(du -sm/BUNDLE_SIZE=$(du -sm/g' "$JENKINSFILE"
sed -i 's/MAP_COUNT=\\$(find/MAP_COUNT=$(find/g' "$JENKINSFILE"
sed -i 's/ASSET_SIZE=\\$(du -sm/ASSET_SIZE=$(du -sm/g' "$JENKINSFILE"

echo "🔍 Fixing pattern 3: Test if statements..."
sed -i 's/if \[ "\\$BUNDLE_SIZE" -gt/if [ "$BUNDLE_SIZE" -gt/g' "$JENKINSFILE"
sed -i 's/if \[ "\\$ASSET_SIZE" -gt/if [ "$ASSET_SIZE" -gt/g' "$JENKINSFILE"

echo "🔍 Fixing pattern 4: Echo statements with shell variables..."
sed -i 's/echo "  Bundle size: \\${BUNDLE_SIZE}MB"/echo "  Bundle size: ${BUNDLE_SIZE}MB"/g' "$JENKINSFILE"
sed -i 's/echo "  Total size: \\${ASSET_SIZE}MB"/echo "  Total size: ${ASSET_SIZE}MB"/g' "$JENKINSFILE"
sed -i 's/echo "  Source maps: \\$MAP_COUNT"/echo "  Source maps: $MAP_COUNT"/g' "$JENKINSFILE"

echo "🔍 Fixing pattern 5: awk commands..."
sed -i "s/awk '{print \"    \" \\\\$9 \" (\" \\\\$5 \")\"}'/awk '{print \"    \" \$9 \" (\" \$5 \")'}/g" "$JENKINSFILE"

echo "🔍 Fixing pattern 6: Find with wc..."
sed -i 's/echo \"  Files: \\$(find/echo \"  Files: $(find/g' "$JENKINSFILE"

echo "✅ Basic fixes applied!"
echo ""
echo "⚠️  MANUAL REVIEW REQUIRED:"
echo "   1. Search for remaining 'sh \"\"\"' blocks with shell variables"
echo "   2. Either change to 'sh '''  for pure shell blocks"
echo "   3. Or escape $ as \\$ for mixed Groovy/shell blocks"
echo ""
echo "📝 Backup saved as: $BACKUP"
echo "🔬 Test the fixed Jenkinsfile in Jenkins before committing"
echo ""
echo "🔍 Problematic lines still to check manually:"
grep -n 'sh """' "$JENKINSFILE" | head -10
