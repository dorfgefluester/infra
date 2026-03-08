# Quick Jenkinsfile Dollar Sign Fix

## The Problem

Any `sh """` block with shell variables like `$VAR` or `$(command)` will fail with:
```
illegal string body character after dollar sign
```

## The Simple Solution

**Replace `sh """` with `sh '''` (triple single quotes) for blocks that contain ONLY shell code.**

## Top 5 Fixes Needed

### Fix 1: Build Analysis (Line ~682)

**FIND THIS:**
```groovy
sh """
    echo "📊 Build Analysis:"
    ...
    BUNDLE_SIZE=$(du -sm ${DIST_DIR} | cut -f1)
    ...
    awk '{print "    " $9 " (" $5 ")"}'
    ...
"""
```

**REPLACE WITH:**
```groovy
sh '''
    echo "📊 Build Analysis:"

    if [ ! -d "${DIST_DIR}" ]; then
        echo "❌ Build failed - dist directory not found"
        exit 1
    fi

    echo "  Files: $(find ${DIST_DIR} -type f | wc -l)"

    BUNDLE_SIZE=$(du -sm ${DIST_DIR} | cut -f1)
    echo "  Bundle size: ${BUNDLE_SIZE}MB"

    if [ "$BUNDLE_SIZE" -gt "${MAX_BUNDLE_SIZE_MB}" ]; then
        echo "⚠️ Bundle size exceeds ${MAX_BUNDLE_SIZE_MB}MB threshold"
    fi

    echo "  Main files:"
    find ${DIST_DIR} -name "*.js" -o -name "*.html" -o -name "*.css" | \
        xargs ls -lh | awk '{print "    " $9 " (" $5 ")"}'

    MAP_COUNT=$(find ${DIST_DIR} -name "*.map" | wc -l)
    echo "  Source maps: $MAP_COUNT"
'''
```

---

### Fix 2: Asset Validation (Line ~378)

**FIND THIS:**
```groovy
sh """
    ...
    ASSET_SIZE=$(du -sm ${ASSETS_DIR} | cut -f1)
    ...
"""
```

**REPLACE WITH:**
```groovy
sh '''
    test -d ${ASSETS_DIR}/tilemaps || echo "⚠️ Missing tilemaps directory"
    test -d ${ASSETS_DIR}/sprites || echo "⚠️ Missing sprites directory"

    echo "📊 Asset inventory:"
    find ${ASSETS_DIR} -type f -name "*.png" | wc -l | xargs echo "  PNG images:"
    find ${ASSETS_DIR} -type f -name "*.json" | wc -l | xargs echo "  JSON files:"
    find ${ASSETS_DIR} -type f -name "*.tsx" | wc -l | xargs echo "  Tilesets:"

    ASSET_SIZE=$(du -sm ${ASSETS_DIR} | cut -f1)
    echo "  Total size: ${ASSET_SIZE}MB"

    if [ "$ASSET_SIZE" -gt "${MAX_ASSET_SIZE_MB}" ]; then
        echo "⚠️ Assets exceed ${MAX_ASSET_SIZE_MB}MB threshold"
    fi
'''
```

---

### Fix 3: Trivy Vulnerability Count (Line ~575)

**FIND THIS:**
```groovy
def criticalCount = sh(
    script: """
        cat ${TRIVY_DIR}/trivy-vuln.json | \
        jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL" or .Severity=="HIGH")] | length'
    """,
    returnStdout: true
).trim()
```

**REPLACE WITH:**
```groovy
def criticalCount = sh(
    script: '''
        cat ${TRIVY_DIR}/trivy-vuln.json | \
        jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL" or .Severity=="HIGH")] | length'
    ''',
    returnStdout: true
).trim()
```

---

### Fix 4: Image Scan Count (Line ~802)

**FIND THIS:**
```groovy
def imageCriticalCount = sh(
    script: """
        cat ${TRIVY_DIR}/image-scan.json | \
        jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length'
    """,
    returnStdout: true
).trim()
```

**REPLACE WITH:**
```groovy
def imageCriticalCount = sh(
    script: '''
        cat ${TRIVY_DIR}/image-scan.json | \
        jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length'
    ''',
    returnStdout: true
).trim()
```

---

### Fix 5: Nginx Config Creation (Line ~759)

**FIND THIS:**
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

**REPLACE WITH:**
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

---

## One-Line Find & Replace

If you're using an editor with regex find/replace:

1. **Find:** `sh """`
2. **Review each match**
3. **If it contains shell variables** (`$VAR`, `$(cmd)`, `awk '$1'`):
   - Change opening to: `sh '''`
   - Change closing to: `'''`
4. **If it ONLY has Groovy variables** (`${GROOVY_VAR}`):
   - Keep as `sh """`

---

## Quick Test

After fixes, search your file for these patterns:

```bash
# Should return NO results (all fixed)
grep 'BUNDLE_SIZE=\\$' Jenkinsfile
grep 'awk.*\\$' Jenkinsfile
grep -A5 'sh """' Jenkinsfile | grep '\$[A-Z_]*='

# OK to have these (Groovy variables)
grep '\${CONTAINER_CMD}' Jenkinsfile     # ✅ OK
grep '\${DIST_DIR}' Jenkinsfile          # ✅ OK
grep '\${PROJECT_NAME}' Jenkinsfile      # ✅ OK
```

---

## Summary

| Situation | Solution | Example |
|-----------|----------|---------|
| **Pure shell code** | Use `sh '''` | `sh ''' echo $HOME '''` |
| **Pure Groovy vars** | Use `sh """` | `sh """ echo ${GROOVY_VAR} """` |
| **Mixed** | Use `sh """` and escape shell `$` as `\$` | `sh """ echo \$HOME and ${GROOVY} """` |

**Easiest fix:** Use `sh '''` for everything that doesn't need Groovy variables! 🎯
