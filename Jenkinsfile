// Helper function to run npm commands (native or containerized)
def runNpm(command) {
    if (env.USE_NODE_CONTAINER == 'true') {
        sh """
            ${CONTAINER_CMD} run --rm \
                -v \$WORKSPACE:/workspace:rw \
                -w /workspace \
                ${NODE_CONTAINER_IMAGE} \
                npm ${command}
        """
    } else {
        sh "npm ${command}"
    }
}

// Helper function to run node commands (native or containerized)
def runNode(command) {
    if (env.USE_NODE_CONTAINER == 'true') {
        sh """
            ${CONTAINER_CMD} run --rm \
                -v \$WORKSPACE:/workspace:rw \
                -w /workspace \
                ${NODE_CONTAINER_IMAGE} \
                node ${command}
        """
    } else {
        sh "node ${command}"
    }
}

pipeline {
    agent any

    environment {
        // Project configuration
        PROJECT_NAME = 'dorfgefluester'
        NODE_VERSION = '18'

        // Version and tagging
        VERSION = sh(script: "grep '\"version\"' package.json | cut -d'\"' -f4", returnStdout: true).trim()
        GIT_SHORT_COMMIT = sh(script: "git rev-parse --short HEAD", returnStdout: true).trim()
        BUILD_TAG = "${VERSION}-${BUILD_NUMBER}-${GIT_SHORT_COMMIT}"

        // Container configuration
        CONTAINER_CMD = 'podman'
        REGISTRY_URL = 'docker.io'  // Change to your registry
        REGISTRY_NAMESPACE = 'myaccount'  // Change to your namespace
        IMAGE_NAME = "${REGISTRY_NAMESPACE}/${PROJECT_NAME}"
        IMAGE_TAG = "${BUILD_TAG}"
        FULL_IMAGE_NAME = "${REGISTRY_URL}/${IMAGE_NAME}:${IMAGE_TAG}"
        LATEST_IMAGE_NAME = "${REGISTRY_URL}/${IMAGE_NAME}:latest"

        // Report directories
        REPORT_DIR = "${WORKSPACE}/security-reports"
        DEPENDENCY_CHECK_DIR = "${REPORT_DIR}/dependency-check"
        TRIVY_DIR = "${REPORT_DIR}/trivy"
        SEMGREP_DIR = "${REPORT_DIR}/semgrep"

        // Build configuration
        DIST_DIR = "${WORKSPACE}/dist"
        ASSETS_DIR = "${WORKSPACE}/public/assets"

        // Performance thresholds
        MAX_BUNDLE_SIZE_MB = '5'  // Alert if bundle > 5MB
        MAX_ASSET_SIZE_MB = '50'  // Alert if total assets > 50MB
    }

    tools {
        'hudson.plugins.sonar.SonarRunnerInstallation' 'SonarQube'
    }

    options {
        // Keep builds for 30 days
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))

        // Timeout after 1 hour
        timeout(time: 1, unit: 'HOURS')

        // Timestamps in console output
        timestamps()

        // Disable concurrent builds
        disableConcurrentBuilds()
    }

    stages {
        stage('Checkout') {
            steps {
                echo '📥 Checking out source code...'
                checkout scm

                script {
                    // Get git commit info
                    env.GIT_COMMIT_SHORT = sh(
                        script: "git rev-parse --short HEAD",
                        returnStdout: true
                    ).trim()
                    env.GIT_BRANCH = sh(
                        script: "git rev-parse --abbrev-ref HEAD",
                        returnStdout: true
                    ).trim()
                }

                echo "✅ Checked out ${env.GIT_BRANCH} @ ${env.GIT_COMMIT_SHORT}"
            }
        }

        stage('Validate Dependencies') {
            steps {
                echo '🔍 Checking required dependencies...'

                script {
                    // Auto-detect container runtime: prefer podman, fall back to docker
                    if (sh(script: "command -v ${CONTAINER_CMD} > /dev/null 2>&1", returnStatus: true) != 0) {
                        def fallback = (CONTAINER_CMD == 'podman') ? 'docker' : 'podman'
                        if (sh(script: "command -v ${fallback} > /dev/null 2>&1", returnStatus: true) == 0) {
                            echo "🔄 ${CONTAINER_CMD} not found, switching to ${fallback}"
                            env.CONTAINER_CMD = fallback
                        }
                    }

                    def missingTools = []
                    def installedTools = []

                    // Check for required system tools
                    def tools = [
                        'git': 'git --version',
                        'jq': 'jq --version',
                        'curl': 'curl --version',
                        "${CONTAINER_CMD}": "${CONTAINER_CMD} --version"
                    ]

                    tools.each { name, command ->
                        def result = sh(script: "${command} > /dev/null 2>&1", returnStatus: true)
                        if (result == 0) {
                            def version = sh(script: "${command} 2>&1 | head -1", returnStdout: true).trim()
                            installedTools << "✅ ${name}: ${version}"
                        } else {
                            missingTools << name
                        }
                    }

                    // Display installed tools
                    echo "Installed tools:"
                    installedTools.each { echo "  ${it}" }

                    // Handle missing tools
                    if (missingTools.size() > 0) {
                        echo "\n⚠️ Missing tools detected: ${missingTools.join(', ')}"
                        echo "Attempting to install or provide alternatives...\n"

                        // Auto-install jq if missing
                        if (missingTools.contains('jq')) {
                            echo "Installing jq..."
                            def jqInstallResult = sh(
                                script: '''
                                    if command -v apt-get > /dev/null; then
                                        sudo apt-get update && sudo apt-get install -y jq
                                    elif command -v yum > /dev/null; then
                                        sudo yum install -y jq
                                    elif command -v dnf > /dev/null; then
                                        sudo dnf install -y jq
                                    elif command -v brew > /dev/null; then
                                        brew install jq
                                    else
                                        # Fallback: download jq binary
                                        wget -O /tmp/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64
                                        chmod +x /tmp/jq
                                        sudo mv /tmp/jq /usr/local/bin/jq
                                    fi
                                ''',
                                returnStatus: true
                            )

                            if (jqInstallResult == 0) {
                                echo "✅ jq installed successfully"
                                missingTools.remove('jq')
                            }
                        }

                        // Check for curl, use wget as fallback
                        if (missingTools.contains('curl')) {
                            def wgetResult = sh(script: "wget --version > /dev/null 2>&1", returnStatus: true)
                            if (wgetResult == 0) {
                                echo "✅ wget available as curl alternative"
                                missingTools.remove('curl')
                            }
                        }

                        // If container runtime missing, fail with instructions
                        if (missingTools.contains(CONTAINER_CMD)) {
                            error("""
❌ ${CONTAINER_CMD} is not installed!

Installation instructions:

For Podman:
  # RHEL/CentOS/Fedora
  sudo dnf install podman

  # Ubuntu/Debian
  sudo apt-get install podman

  # macOS
  brew install podman

For Docker:
  # Ubuntu/Debian
  curl -fsSL https://get.docker.com | sh

  # RHEL/CentOS
  sudo yum install docker-ce

Then restart Jenkins agent.
Alternatively, set CONTAINER_CMD='docker' in Jenkinsfile if Docker is installed.
                            """)
                        }

                        // Final check
                        if (missingTools.size() > 0) {
                            error("Still missing required tools: ${missingTools.join(', ')}")
                        }
                    }

                    echo "✅ All required dependencies validated"
                }
            }
        }

        stage('Setup Node.js') {
            steps {
                echo '🔧 Setting up Node.js environment...'

                script {
                    // Check if Node.js is installed
                    def nodeInstalled = sh(script: 'node --version > /dev/null 2>&1', returnStatus: true) == 0

                    if (!nodeInstalled) {
                        echo "⚠️ Node.js not found on agent, using containerized Node.js"

                        // Use Node.js container for all npm commands
                        env.USE_NODE_CONTAINER = 'true'
                        env.NODE_CONTAINER_IMAGE = "docker.io/node:${NODE_VERSION}-alpine"

                        // Pull Node.js image
                        sh "${CONTAINER_CMD} pull ${NODE_CONTAINER_IMAGE}"

                        // Test Node.js container
                        sh """
                            ${CONTAINER_CMD} run --rm ${NODE_CONTAINER_IMAGE} node --version
                            ${CONTAINER_CMD} run --rm ${NODE_CONTAINER_IMAGE} npm --version
                        """

                        echo "✅ Containerized Node.js ${NODE_VERSION} ready"
                    } else {
                        env.USE_NODE_CONTAINER = 'false'

                        def nodeVersion = sh(script: 'node --version', returnStdout: true).trim()
                        def npmVersion = sh(script: 'npm --version', returnStdout: true).trim()

                        echo "✅ Using native Node.js ${nodeVersion}"
                        echo "✅ Using native npm ${npmVersion}"

                        // Check if Node.js version matches requirement
                        def installedMajor = nodeVersion.replaceAll(/v(\d+)\..*/, '$1').toInteger()
                        def requiredMajor = NODE_VERSION.toInteger()

                        if (installedMajor < requiredMajor) {
                            echo "⚠️ Node.js ${nodeVersion} is older than recommended ${NODE_VERSION}"
                            echo "Consider upgrading or pipeline will use containerized Node.js"

                            env.USE_NODE_CONTAINER = 'true'
                            env.NODE_CONTAINER_IMAGE = "docker.io/node:${NODE_VERSION}-alpine"
                            sh "${CONTAINER_CMD} pull ${NODE_CONTAINER_IMAGE}"
                        }
                    }
                }
            }
        }

        stage('Setup Build Environment') {
            steps {
                echo '🔧 Setting up build environment...'

                script {
                    // Create report directories
                    sh """
                        mkdir -p ${DEPENDENCY_CHECK_DIR}
                        mkdir -p ${TRIVY_DIR}
                        mkdir -p ${SEMGREP_DIR}
                    """

                    // Pull required container images in parallel (non-fatal — scans will fail gracefully if unavailable)
                    echo "📥 Pulling container images..."
                    sh """
                        ${CONTAINER_CMD} pull docker.io/owasp/dependency-check:latest &
                        ${CONTAINER_CMD} pull docker.io/aquasec/trivy:latest &
                        ${CONTAINER_CMD} pull docker.io/returntocorp/semgrep:latest &
                        wait || true
                    """

                    // Display environment info
                    def nodeCmd = env.USE_NODE_CONTAINER == 'true' ?
                        "${CONTAINER_CMD} run --rm ${NODE_CONTAINER_IMAGE}" : ''

                    sh """
                        echo "📊 Build Information:"
                        echo "  Project: ${PROJECT_NAME}"
                        echo "  Version: ${VERSION}"
                        echo "  Build: #${BUILD_NUMBER}"
                        echo "  Tag: ${BUILD_TAG}"
                        echo "  Image: ${FULL_IMAGE_NAME}"
                        echo "  Node Mode: ${env.USE_NODE_CONTAINER == 'true' ? 'Container' : 'Native'}"
                        ${nodeCmd} node --version | sed 's/^/  Node: /'
                        ${nodeCmd} npm --version | sed 's/^/  npm: /'
                        ${CONTAINER_CMD} --version | head -1 | sed 's/^/  ${CONTAINER_CMD}: /'
                    """

                    echo '✅ Environment ready'
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                echo '📦 Installing npm dependencies...'

                script {
                    def startTime = System.currentTimeMillis()

                    // Install dependencies using helper function
                    runNpm('ci --prefer-offline --no-audit')

                    def duration = (System.currentTimeMillis() - startTime) / 1000
                    echo "✅ Dependencies installed in ${duration}s"

                    // List outdated packages (informational)
                    sh(script: "npm outdated || true", returnStatus: true)
                }
            }
        }

        stage('Code Quality') {
            parallel {
                stage('ESLint') {
                    when {
                        expression {
                            return fileExists('.eslintrc.js') || fileExists('.eslintrc.json') || fileExists('eslint.config.js')
                        }
                    }
                    steps {
                        echo '🔍 Running ESLint...'
                        script {
                            def eslintResult = sh(
                                script: 'npm run lint --if-present || npx eslint src/ --format json > ${REPORT_DIR}/eslint-report.json',
                                returnStatus: true
                            )

                            if (eslintResult != 0) {
                                unstable(message: 'ESLint found issues')
                            }
                        }
                        echo '✅ ESLint complete'
                    }
                }

                stage('Prettier') {
                    when {
                        expression {
                            return fileExists('.prettierrc') || fileExists('.prettierrc.json') || fileExists('prettier.config.js')
                        }
                    }
                    steps {
                        echo '✨ Checking code formatting...'
                        script {
                            def prettierResult = sh(
                                script: 'npx prettier --check "src/**/*.{js,json,css,html}" || true',
                                returnStatus: true
                            )

                            if (prettierResult != 0) {
                                echo '⚠️ Code formatting issues found (run: npm run format)'
                            }
                        }
                    }
                }

                stage('Validate Assets') {
                    steps {
                        echo '🎨 Validating game assets...'
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
                        echo '✅ Asset validation complete'
                    }
                }
            }
        }

        stage('Lint & Validate') {
            parallel {
                stage('Validate Prototype') {
                    steps {
                        echo '🔍 Running prototype validation...'
                        script {
                            runNpm('run validate')
                        }
                    }
                }

                stage('Validate Translations') {
                    steps {
                        echo '🌐 Running translation validation...'
                        script {
                            runNpm('run validate-translations')
                        }
                    }
                }
            }
        }

        stage('Security Scans') {
            parallel {
                stage('npm audit') {
                    steps {
                        echo '🔒 Running npm audit...'
                        script {
                            def auditResult = sh(
                                script: 'npm audit --json > ${REPORT_DIR}/npm-audit.json',
                                returnStatus: true
                            )

                            // Parse and display results
                            sh '''
                                echo "📊 npm audit results:"
                                cat ${REPORT_DIR}/npm-audit.json | jq -r '.metadata | "Vulnerabilities: \\(.vulnerabilities.total) (Critical: \\(.vulnerabilities.critical), High: \\(.vulnerabilities.high), Medium: \\(.vulnerabilities.moderate), Low: \\(.vulnerabilities.low))"'
                            '''

                            // Warning if vulnerabilities found (don't fail)
                            if (auditResult != 0) {
                                unstable(message: 'npm audit found vulnerabilities')
                            }
                        }
                        echo '✅ npm audit complete'
                    }
                }

                stage('OWASP DependencyCheck') {
                    steps {
                        echo '🛡️ Running OWASP DependencyCheck...'
                        script {
                            def suppressionFile = fileExists('config/security/dependency-check-suppression.xml') ?
                                "/src/config/security/dependency-check-suppression.xml" : ""

                            def suppressionArg = suppressionFile ? "--suppression ${suppressionFile}" : ""

                            catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                                sh """
                                    ${CONTAINER_CMD} run --rm \
                                      -v \$WORKSPACE:/src:ro \
                                      -v ${DEPENDENCY_CHECK_DIR}:/reports:rw \
                                      -v dependency-check-data:/usr/share/dependency-check/data \
                                      docker.io/owasp/dependency-check:latest \
                                      --scan /src \
                                      --format HTML \
                                      --format JSON \
                                      --format JUNIT \
                                      --out /reports \
                                      ${suppressionArg} \
                                      --enableExperimental \
                                      --nodeAuditSkipDevDependencies false \
                                      --nodePackageSkipDevDependencies false \
                                      --project "${PROJECT_NAME}" \
                                      --failOnCVSS 0
                                """
                            }
                        }
                        echo '✅ DependencyCheck complete'
                    }
                    post {
                        always {
                            // Publish JUnit results
                            junit allowEmptyResults: true, testResults: "${DEPENDENCY_CHECK_DIR}/dependency-check-junit.xml"
                        }
                    }
                }

                stage('Trivy Scan') {
                    steps {
                        echo '🔍 Running Trivy vulnerability scan...'
                        script {
                            catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                            // Vulnerability scan
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${TRIVY_DIR}:/reports:rw \
                                  docker.io/aquasec/trivy:latest \
                                  fs --scanners vuln \
                                  --format json \
                                  --output /reports/trivy-vuln.json \
                                  --severity CRITICAL,HIGH,MEDIUM,LOW \
                                  /src
                            """

                            // Secret scan
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${TRIVY_DIR}:/reports:rw \
                                  docker.io/aquasec/trivy:latest \
                                  fs --scanners secret \
                                  --format json \
                                  --output /reports/trivy-secrets.json \
                                  /src
                            """

                            // License scan
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${TRIVY_DIR}:/reports:rw \
                                  docker.io/aquasec/trivy:latest \
                                  fs --scanners license \
                                  --format json \
                                  --output /reports/trivy-license.json \
                                  /src
                            """

                            // HTML report
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${TRIVY_DIR}:/reports:rw \
                                  docker.io/aquasec/trivy:latest \
                                  fs --format template \
                                  --template "@contrib/html.tpl" \
                                  --output /reports/trivy-report.html \
                                  /src
                            """

                            // SARIF for GitHub/GitLab integration
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${TRIVY_DIR}:/reports:rw \
                                  docker.io/aquasec/trivy:latest \
                                  fs --format sarif \
                                  --output /reports/trivy-results.sarif \
                                  /src
                            """

                            // Check for critical/high vulnerabilities
                            def criticalCount = sh(
                                script: '''
                                    cat ${TRIVY_DIR}/trivy-vuln.json | \
                                    jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL" or .Severity=="HIGH")] | length'
                                ''',
                                returnStdout: true
                            ).trim()

                            echo "📊 Trivy found ${criticalCount} CRITICAL/HIGH vulnerabilities"

                            if (criticalCount.toInteger() > 0) {
                                unstable(message: "Trivy found ${criticalCount} CRITICAL/HIGH vulnerabilities")
                            }
                            } // end catchError
                        }
                        echo '✅ Trivy scan complete'
                    }
                }

                stage('Semgrep Scan') {
                    steps {
                        echo '🔎 Running Semgrep SAST scan...'
                        catchError(buildResult: 'UNSTABLE', stageResult: 'UNSTABLE') {
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${SEMGREP_DIR}:/reports:rw \
                                  docker.io/returntocorp/semgrep:latest \
                                  scan /src \
                                  --config=auto \
                                  --json \
                                  --output /reports/semgrep-results.json
                            """

                            // Also generate SARIF
                            sh """
                                ${CONTAINER_CMD} run --rm \
                                  -v \$WORKSPACE:/src:ro \
                                  -v ${SEMGREP_DIR}:/reports:rw \
                                  docker.io/returntocorp/semgrep:latest \
                                  scan /src \
                                  --config=auto \
                                  --sarif \
                                  --output /reports/semgrep-results.sarif
                            """
                        }
                        echo '✅ Semgrep scan complete'
                    }
                }
            }
        }

        stage('Tests') {
            parallel {
                stage('Unit Tests') {
                    steps {
                        echo '🧪 Running Jest unit tests...'
                        script {
                            runNpm('test -- --ci --coverage --maxWorkers=2')
                        }
                    }
                    post {
                        always {
                            // Publish coverage reports
                            publishHTML([
                                allowMissing: true,
                                reportDir: 'tests/coverage/lcov-report',
                                reportFiles: 'index.html',
                                reportName: 'Code Coverage',
                                keepAll: true,
                                alwaysLinkToLastBuild: true
                            ])
                        }
                    }
                }

                stage('E2E Tests') {
                    when {
                        expression {
                            return env.BRANCH_NAME ==~ /(master|main|develop|0\.\d+(\.\d+)*)/ || env.CHANGE_TARGET
                        }
                    }
                    steps {
                        echo '🎭 Running Playwright E2E tests...'
                        script {
                            // E2E tests need Playwright browsers installed
                            if (env.USE_NODE_CONTAINER == 'true') {
                                echo '📦 Using Playwright container with pre-installed browsers'
                                sh """
                                    ${CONTAINER_CMD} run --rm \
                                        -v \${WORKSPACE}:/workspace:rw \
                                        -w /workspace \
                                        --ipc=host \
                                        docker.io/mcr.microsoft.com/playwright:v1.50.0-noble \
                                        npm run test:e2e
                                """
                            } else {
                                echo '📦 Installing Playwright browsers for native Node...'
                                sh 'npx playwright install chromium firefox webkit'
                                runNpm('run test:e2e')
                            }
                        }
                    }
                    post {
                        always {
                            // Publish Playwright report
                            publishHTML([
                                allowMissing: true,
                                reportDir: 'playwright-report',
                                reportFiles: 'index.html',
                                reportName: 'Playwright Report',
                                keepAll: true,
                                alwaysLinkToLastBuild: true
                            ])
                        }
                    }
                }
            }
        }

        stage('SonarQube Analysis') {
            steps {
                echo '🔎 Running SonarQube analysis...'
                catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
                    withSonarQubeEnv('SonarQube') {
                        sh """
                            sonar-scanner \
                                -Dsonar.projectKey=${PROJECT_NAME} \
                                -Dsonar.projectName='Dorfgeflüster' \
                                -Dsonar.sources=src \
                                -Dsonar.exclusions=**/node_modules/**,dist/**,public/** \
                                -Dsonar.javascript.lcov.reportPaths=tests/coverage/lcov.info \
                                -Dsonar.host.url=http://jenkins:9000
                        """
                    }
                }
            }
        }

        stage('Build') {
            steps {
                echo '🏗️ Building production bundle...'

                script {
                    def startTime = System.currentTimeMillis()

                    // Build with Vite
                    sh 'npm run build'

                    def duration = (System.currentTimeMillis() - startTime) / 1000
                    echo "✅ Build completed in ${duration}s"

                    // Analyze build output
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

                        # Check for source maps (should exist in production)
                        MAP_COUNT=$(find ${DIST_DIR} -name "*.map" | wc -l)
                        echo "  Source maps: $MAP_COUNT"
                    '''
                }
            }
            post {
                success {
                    // Archive build artifacts
                    archiveArtifacts artifacts: 'dist/**/*',
                                     fingerprint: true,
                                     allowEmptyArchive: false
                }
            }
        }

        stage('Build Container Image') {
            steps {
                echo '🐳 Building container image...'

                script {
                    // Create Dockerfile if it doesn't exist
                    if (!fileExists('Dockerfile')) {
                        echo '📝 Creating Dockerfile for game deployment...'
                        sh """
                            cat > Dockerfile <<'EOF'
# Multi-stage build for Dorfgefluester game
FROM docker.io/nginx:alpine

# Copy built game files
COPY dist/ /usr/share/nginx/html/

# Copy custom nginx config if exists
COPY nginx.conf /etc/nginx/conf.d/default.conf 2>/dev/null || true

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
    CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1

# Run nginx
CMD ["nginx", "-g", "daemon off;"]
EOF
                        """
                    }

                    // Create nginx.conf if it doesn't exist
                    if (!fileExists('nginx.conf')) {
                        echo '📝 Creating nginx.conf for SPA routing...'
                        sh '''
                            cat > nginx.conf <<'EOF'
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Cache static assets
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
                        '''
                    }

                    // Build the image
                    sh """
                        ${CONTAINER_CMD} build \\
                            --tag ${FULL_IMAGE_NAME} \\
                            --tag ${LATEST_IMAGE_NAME} \\
                            --label "version=${VERSION}" \\
                            --label "build-number=${BUILD_NUMBER}" \\
                            --label "git-commit=${GIT_SHORT_COMMIT}" \\
                            --label "build-date=\\\$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \\
                            --label "project=${PROJECT_NAME}" \\
                            .
                    """

                    echo "✅ Image built: ${FULL_IMAGE_NAME}"

                    // Display image info
                    sh """
                        echo "📊 Image Information:"
                        ${CONTAINER_CMD} images ${IMAGE_NAME} --format "table {{.Repository}}:{{.Tag}}\\t{{.Size}}\\t{{.CreatedAt}}"
                    """
                }
            }
        }

        stage('Scan Container Image') {
            steps {
                echo '🔍 Scanning container image for vulnerabilities...'

                script {
                    // Scan the built image with Trivy
                    sh """
                        ${CONTAINER_CMD} run --rm \\
                            -v /var/run/podman/podman.sock:/var/run/docker.sock:ro \\
                            -v ${TRIVY_DIR}:/reports:rw \\
                            docker.io/aquasec/trivy:latest \\
                            image \\
                            --format json \\
                            --output /reports/image-scan.json \\
                            --severity CRITICAL,HIGH,MEDIUM \\
                            ${FULL_IMAGE_NAME}
                    """

                    // Generate HTML report
                    sh """
                        ${CONTAINER_CMD} run --rm \\
                            -v /var/run/podman/podman.sock:/var/run/docker.sock:ro \\
                            -v ${TRIVY_DIR}:/reports:rw \\
                            docker.io/aquasec/trivy:latest \\
                            image \\
                            --format template \\
                            --template "@contrib/html.tpl" \\
                            --output /reports/image-scan.html \\
                            ${FULL_IMAGE_NAME}
                    """

                    // Check for critical vulnerabilities in image
                    def imageCriticalCount = sh(
                        script: '''
                            cat ${TRIVY_DIR}/image-scan.json | \
                            jq '[.Results[]?.Vulnerabilities[]? | select(.Severity=="CRITICAL")] | length'
                        ''',
                        returnStdout: true
                    ).trim()

                    echo "📊 Image scan found ${imageCriticalCount} CRITICAL vulnerabilities"

                    if (imageCriticalCount.toInteger() > 0) {
                        unstable(message: "Container image has ${imageCriticalCount} CRITICAL vulnerabilities")
                    }
                }

                echo '✅ Container image scan complete'
            }
            post {
                always {
                    publishHTML([
                        allowMissing: true,
                        reportDir: "${TRIVY_DIR}",
                        reportFiles: 'image-scan.html',
                        reportName: 'Container Image Scan',
                        keepAll: true,
                        alwaysLinkToLastBuild: true
                    ])
                }
            }
        }

        stage('Push Container Image') {
            when {
                anyOf {
                    branch 'master'
                    branch 'main'
                    branch pattern: 'release/.*', comparator: 'REGEXP'
                }
            }
            steps {
                echo '📤 Pushing container image to registry...'

                script {
                    // Login to registry (requires Jenkins credentials)
                    withCredentials([usernamePassword(
                        credentialsId: 'container-registry-credentials',
                        usernameVariable: 'REGISTRY_USER',
                        passwordVariable: 'REGISTRY_PASS'
                    )]) {
                        sh '''
                            echo "$REGISTRY_PASS" | \
                            ''' + "${CONTAINER_CMD} login ${REGISTRY_URL}" + ''' \
                                --username "$REGISTRY_USER" \
                                --password-stdin
                        '''
                    }

                    // Push both tags
                    sh """
                        ${CONTAINER_CMD} push ${FULL_IMAGE_NAME}
                        ${CONTAINER_CMD} push ${LATEST_IMAGE_NAME}
                    """

                    echo "✅ Images pushed:"
                    echo "   ${FULL_IMAGE_NAME}"
                    echo "   ${LATEST_IMAGE_NAME}"

                    // Logout
                    sh "${CONTAINER_CMD} logout ${REGISTRY_URL}"
                }
            }
        }

        stage('Generate SBOM') {
            steps {
                echo '📋 Generating Software Bill of Materials...'
                sh """
                    ${CONTAINER_CMD} run --rm \
                      -v \$WORKSPACE:/src:ro \
                      -v ${REPORT_DIR}:/reports:rw \
                      docker.io/aquasec/trivy:latest \
                      fs --format cyclonedx \
                      --output /reports/SBOM.json \
                      /src
                """
                echo '✅ SBOM generated'
            }
        }

        stage('Security Summary') {
            steps {
                script {
                    echo '📊 Generating security scan summary...'

                    // Create summary HTML
                    sh """
                        cat > ${REPORT_DIR}/summary.html <<'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Security Scan Summary - Build #${BUILD_NUMBER}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { color: #333; }
        .section { margin: 20px 0; padding: 15px; border: 1px solid #ddd; }
        .critical { color: #d32f2f; font-weight: bold; }
        .high { color: #f57c00; font-weight: bold; }
        .medium { color: #fbc02d; }
        .low { color: #388e3c; }
        a { color: #1976d2; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>🔒 Security Scan Summary</h1>
    <p><strong>Project:</strong> ${PROJECT_NAME}</p>
    <p><strong>Build:</strong> #${BUILD_NUMBER}</p>
    <p><strong>Branch:</strong> ${env.GIT_BRANCH}</p>
    <p><strong>Commit:</strong> ${env.GIT_COMMIT_SHORT}</p>
    <p><strong>Date:</strong> \$(date)</p>

    <div class="section">
        <h2>📊 Scan Results</h2>
        <ul>
            <li><a href="npm-audit.json">npm audit (JSON)</a></li>
            <li><a href="dependency-check/dependency-check-report.html">OWASP DependencyCheck (HTML)</a></li>
            <li><a href="trivy/trivy-report.html">Trivy Report (HTML)</a></li>
            <li><a href="semgrep/semgrep-results.json">Semgrep Results (JSON)</a></li>
            <li><a href="SBOM.json">SBOM (CycloneDX)</a></li>
        </ul>
    </div>

    <div class="section">
        <h2>🛡️ Recommendations</h2>
        <ul>
            <li>Review all <span class="critical">CRITICAL</span> and <span class="high">HIGH</span> severity findings</li>
            <li>Update outdated dependencies: <code>npm update</code></li>
            <li>Check suppression files for expired suppressions</li>
            <li>Verify no secrets were committed</li>
        </ul>
    </div>
</body>
</html>
EOF
                    """

                    echo '✅ Summary generated'
                }
            }
        }
    }

    post {
        always {
            echo '📦 Archiving artifacts and reports...'

            // Archive security reports
            archiveArtifacts artifacts: 'security-reports/**/*',
                             fingerprint: true,
                             allowEmptyArchive: true

            // Archive build artifacts
            archiveArtifacts artifacts: 'dist/**/*',
                             fingerprint: true,
                             allowEmptyArchive: true

            // Publish HTML reports
            publishHTML([
                allowMissing: true,
                reportDir: "${REPORT_DIR}",
                reportFiles: 'summary.html',
                reportName: 'Security Summary',
                keepAll: true,
                alwaysLinkToLastBuild: true
            ])

            publishHTML([
                allowMissing: true,
                reportDir: "${DEPENDENCY_CHECK_DIR}",
                reportFiles: 'dependency-check-report.html',
                reportName: 'DependencyCheck Report',
                keepAll: true,
                alwaysLinkToLastBuild: true
            ])

            publishHTML([
                allowMissing: true,
                reportDir: "${TRIVY_DIR}",
                reportFiles: 'trivy-report.html',
                reportName: 'Trivy Report',
                keepAll: true,
                alwaysLinkToLastBuild: true
            ])

            // Clean up workspace
            cleanWs(
                deleteDirs: true,
                disableDeferredWipeout: true,
                notFailBuild: true,
                patterns: [
                    [pattern: 'node_modules', type: 'INCLUDE'],
                    [pattern: 'dist', type: 'INCLUDE']
                ]
            )
        }

        success {
            echo '✅ Pipeline completed successfully!'

            script {
                if (env.CHANGE_ID) {
                    // Post comment on PR if available
                    echo "📝 Build #${BUILD_NUMBER} passed all security scans"
                }
            }
        }

        failure {
            echo '❌ Pipeline failed!'

            script {
                if (env.CHANGE_ID) {
                    echo "📝 Build #${BUILD_NUMBER} failed - check logs"
                }
            }
        }

        unstable {
            echo '⚠️ Pipeline unstable - security issues found'

            script {
                if (env.CHANGE_ID) {
                    echo "📝 Build #${BUILD_NUMBER} found security issues - review reports"
                }
            }
        }
    }
}
