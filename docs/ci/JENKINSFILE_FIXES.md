# Jenkinsfile Dollar Sign Fixes

## Problem

Groovy interprets `$VAR` inside `sh """` blocks as Groovy variables, but they're shell variables.

## Solution

Use one of these approaches:

### Option 1: Use Single Quotes for Pure Shell (Recommended)

**Before:**
```groovy
sh """
    echo $HOME
    BUNDLE_SIZE=$(du -sm dist | cut -f1)
    if [ "$BUNDLE_SIZE" -gt 5 ]; then
        echo "Too big"
    fi
"""
```

**After:**
```groovy
sh '''
    echo $HOME
    BUNDLE_SIZE=$(du -sm dist | cut -f1)
    if [ "$BUNDLE_SIZE" -gt 5 ]; then
        echo "Too big"
    fi
'''
```

### Option 2: Escape Dollar Signs

**When you need both Groovy and Shell variables:**

```groovy
sh """
    # Shell variables - escaped
    echo \$HOME
    BUNDLE_SIZE=\$(du -sm ${DIST_DIR} | cut -f1)

    # Groovy variables - not escaped
    if [ "\$BUNDLE_SIZE" -gt "${MAX_BUNDLE_SIZE_MB}" ]; then
        echo "Too big"
    fi
"""
```

## Specific Fixes Needed in Jenkinsfile

### Fix 1: Lines 4-17 (runNpm helper)
**Status:** ✅ Already escaped correctly (`\$WORKSPACE`)

### Fix 2: Lines 494-506 (Trivy scan - vuln)
**Change:** `\$WORKSPACE` → Already correct OR change to `sh '''`

### Fix 3: Lines 507-518 (Trivy scan - secrets)
**Change:** `\$WORKSPACE` → Already correct OR change to `sh '''`

### Fix 4: Lines 519-530 (Trivy scan - license)
**Change:** `\$WORKSPACE` → Already correct OR change to `sh '''`

### Fix 5: Lines 531-542 (Trivy scan - HTML)
**Change:** `\$WORKSPACE` → Already correct OR change to `sh '''`

### Fix 6: Lines 543-554 (Trivy scan - SARIF)
**Change:** `\$WORKSPACE` → Already correct OR change to `sh '''`

### Fix 7: Lines 575-582 (Check critical count)
**Current:**
```groovy
sh """
    cat ${TRIVY_DIR}/trivy-vuln.json | \
    jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL" or .Severity=="HIGH")] | length'
"""
```

**Fix - Use single quotes:**
```groovy
sh '''
    cat ${TRIVY_DIR}/trivy-vuln.json | \
    jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL" or .Severity=="HIGH")] | length'
'''
```

### Fix 8: Lines 639-648 (E2E Playwright container)
**Current:**
```groovy
sh """
    ${CONTAINER_CMD} run --rm \
        -v \${WORKSPACE}:/workspace:rw \
        ...
"""
```

**Status:** ✅ Already escaped correctly

### Fix 9: Lines 682-710 (Build Analysis)
**Current:**
```groovy
sh """
    echo "📊 Build Analysis:"
    ...
    BUNDLE_SIZE=$(du -sm ${DIST_DIR} | cut -f1)
    echo "  Bundle size: ${BUNDLE_SIZE}MB"

    if [ "$BUNDLE_SIZE" -gt "${MAX_BUNDLE_SIZE_MB}" ]; then
        ...
    fi

    ...
    xargs ls -lh | awk '{print "    " $9 " (" $5 ")"}'
    ...
    MAP_COUNT=$(find ${DIST_DIR} -name "*.map" | wc -l)
"""
```

**Fix - Use single quotes:**
```groovy
sh '''
    echo "📊 Build Analysis:"

    # Check if dist directory exists
    if [ ! -d "${DIST_DIR}" ]; then
        echo "❌ Build failed - dist directory not found"
        exit 1
    fi

    # Count files
    echo "  Files: $(find ${DIST_DIR} -type f | wc -l)"

    # Calculate bundle size
    BUNDLE_SIZE=$(du -sm ${DIST_DIR} | cut -f1)
    echo "  Bundle size: ${BUNDLE_SIZE}MB"

    # Check bundle size threshold
    if [ "$BUNDLE_SIZE" -gt "${MAX_BUNDLE_SIZE_MB}" ]; then
        echo "⚠️ Bundle size exceeds ${MAX_BUNDLE_SIZE_MB}MB threshold"
    fi

    # List main files
    echo "  Main files:"
    find ${DIST_DIR} -name "*.js" -o -name "*.html" -o -name "*.css" | \
        xargs ls -lh | awk '{print "    " $9 " (" $5 ")"}'

    # Check for source maps
    MAP_COUNT=$(find ${DIST_DIR} -name "*.map" | wc -l)
    echo "  Source maps: $MAP_COUNT"
'''
```

### Fix 10: Lines 732-758 (Create Dockerfile)
**Current:**
```groovy
sh """
    cat > Dockerfile <<'EOF'
...
    CMD ["nginx", "-g", "daemon off;"]
EOF
"""
```

**Status:** ✅ Heredoc uses single quotes, should be OK

### Fix 11: Lines 759-785 (Create nginx.conf)
**Current:**
```groovy
sh """
    cat > nginx.conf <<'EOF'
server {
    ...
    location / {
        try_files \\$uri \\$uri/ /index.html;
    }
}
EOF
"""
```

**Issue:** The `\\$uri` needs escaping

**Fix:**
```groovy
sh '''
    cat > nginx.conf <<'EOF'
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
'''
```

### Fix 12: Lines 802-815 (Podman image scan - jq)
**Current:**
```groovy
sh """
    cat ${TRIVY_DIR}/image-scan.json | \
    jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length'
"""
```

**Fix - Use single quotes:**
```groovy
sh '''
    cat ${TRIVY_DIR}/image-scan.json | \
    jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length'
'''
```

### Fix 13: Lines 916-921 (Registry login)
**Current:**
```groovy
sh """
    echo "$REGISTRY_PASS" | \
    ${CONTAINER_CMD} login ${REGISTRY_URL} \
        --username "$REGISTRY_USER" \
        --password-stdin
"""
```

**Fix - Escape shell variables:**
```groovy
sh """
    echo "\\\$REGISTRY_PASS" | \
    ${CONTAINER_CMD} login ${REGISTRY_URL} \
        --username "\\\$REGISTRY_USER" \
        --password-stdin
"""
```

### Fix 14: Lines 378-391 (Asset validation)
**Current:**
```groovy
sh """
    ...
    ASSET_SIZE=$(du -sm ${ASSETS_DIR} | cut -f1)
    echo "  Total size: ${ASSET_SIZE}MB"

    if [ "$ASSET_SIZE" -gt "${MAX_ASSET_SIZE_MB}" ]; then
        ...
    fi
"""
```

**Fix - Use single quotes:**
```groovy
sh '''
    # Check if asset directories exist
    test -d ${ASSETS_DIR}/tilemaps || echo "⚠️ Missing tilemaps directory"
    test -d ${ASSETS_DIR}/sprites || echo "⚠️ Missing sprites directory"

    # Count assets
    echo "📊 Asset inventory:"
    find ${ASSETS_DIR} -type f -name "*.png" | wc -l | xargs echo "  PNG images:"
    find ${ASSETS_DIR} -type f -name "*.json" | wc -l | xargs echo "  JSON files:"
    find ${ASSETS_DIR} -type f -name "*.tsx" | wc -l | xargs echo "  Tilesets:"

    # Check total asset size
    ASSET_SIZE=$(du -sm ${ASSETS_DIR} | cut -f1)
    echo "  Total size: ${ASSET_SIZE}MB"

    if [ "$ASSET_SIZE" -gt "${MAX_ASSET_SIZE_MB}" ]; then
        echo "⚠️ Assets exceed ${MAX_ASSET_SIZE_MB}MB threshold"
    fi
'''
```

## Quick Fix Script

Run this to automatically fix all issues:

```bash
# Backup original
mkdir -p infra/jenkins/_archive
cp Jenkinsfile infra/jenkins/_archive/Jenkinsfile.backup

# Apply fixes (this is a simplified example - manual review recommended)
sed -i 's/sh """/sh '"'"'"'"'"'/g' Jenkinsfile  # Changes all to single quotes
# Then manually fix the few that need Groovy interpolation
```

## Recommended Approach

1. **Search and replace in your editor:**
   - Find: `sh """`
   - Review each occurrence
   - If it contains ONLY shell code → Change to `sh '''`
   - If it needs Groovy variables → Keep `sh """` and escape `$` as `\$`

2. **Test incrementally:**
   - Fix one section at a time
   - Run Jenkins validation
   - Fix syntax errors as they appear

3. **General rules:**
   - `$(command)` → Needs escaping: `\$(command)` or use `sh '''`
   - `$VAR` → Needs escaping: `\$VAR` or use `sh '''`
   - `${GROOVY_VAR}` → OK in `sh """`, this IS Groovy interpolation
   - `awk '{print $1}'` → Needs escaping: `\$1` or use `sh '''`

## Verification

After fixing, verify with:

```bash
# Syntax check (if you have Groovy installed)
groovyc -d /tmp Jenkinsfile

# Or just run in Jenkins and check for:
# - "illegal string body character after dollar sign" → Still have unescaped $
# - Syntax errors → Review that section
```
