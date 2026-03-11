pipeline {
    agent { label 'linux-docker' }

    parameters {
        booleanParam(name: 'RUN_E2E', defaultValue: false, description: 'Run Playwright E2E tests')
        booleanParam(name: 'SONAR_VERBOSE', defaultValue: false, description: 'Enable verbose Sonar scanner logs (-X)')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
        timeout(time: 45, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    environment {
        PROJECT_NAME = 'dorfgefluester'
        IMAGE_NAME = 'dorfgefluester'
        NODE_VERSION = '20'
        NODE_MAJOR_REQUIRED = '18'
        REGISTRY = 'dev-env-01:5000'
        IMAGE_REPO = "${REGISTRY}/${IMAGE_NAME}"
        DEPLOY_HOST = 'dev-env-01'
        DEPLOY_USER = 'deploy'
        SSH_CRED_ID = 'deploy'
        NAMESPACE = 'dev'
        RELEASE = 'dorfgefluester'
        BUILD_ALLOWED = 'true'
        GIT_SHA = ''
        IMAGE_TAG = ''
        // Keep dependency/scanner caches outside the wiped workspace root.
        // Jenkins creates a per-workspace temp directory at "$WORKSPACE@tmp" which is not removed by "Prepare Workspace".
        WORKSPACE_TMP = "${WORKSPACE}@tmp"
        NPM_CACHE_DIR = "${WORKSPACE_TMP}/.npm-cache"
        TRIVY_FS_CACHE_DIR = "${WORKSPACE_TMP}/.trivy-fs-cache"
        TRIVY_IMAGE_CACHE_DIR = "${WORKSPACE_TMP}/.trivy-image-cache"
    }

    stages {
        // Build only the latest semantic-version branch to reduce redundant CI load.
        stage('Gate: Latest Version Branch') {
            steps {
                script {
                    def isVersionBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                    if (isVersionBranch) {
                        def credId = scm.userRemoteConfigs[0].credentialsId
                        def repoUrl = scm.userRemoteConfigs[0].url
                        def latest = ''
                        withCredentials([gitUsernamePassword(credentialsId: credId, gitToolName: 'Default')]) {
                            retry(3) {
                                latest = sh(
                                    script: "git ls-remote --heads '${repoUrl}' | cut -f2 | sed 's#refs/heads/##' | grep -E -x '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V | tail -n 1",
                                    returnStdout: true
                                ).trim()
                            }
                        }
                        env.LATEST_VERSION_BRANCH = latest
                        if (env.BRANCH_NAME != latest) {
                            env.BUILD_ALLOWED = 'false'
                            currentBuild.result = 'NOT_BUILT'
                            echo "Skipping build for ${env.BRANCH_NAME} (latest is ${latest})."
                        } else {
                            echo "Building latest version branch: ${latest}."
                        }
                    } else {
                        echo "Non-version branch (${env.BRANCH_NAME}); continuing."
                    }

                    if (env.BUILD_ALLOWED == 'true') {
                        def deployPipelinePath = 'jenkins/core-vitals-staging-deploy.Jenkinsfile'
                        def changedPaths = []

                        try {
                            for (def changeSet in currentBuild.changeSets) {
                                for (def entry in changeSet.items) {
                                    for (def file in entry.affectedFiles) {
                                        if (file?.path) {
                                            changedPaths << file.path.toString()
                                        }
                                    }
                                }
                            }
                        } catch (ignored) {
                            echo 'Unable to inspect changelog entries; continuing build.'
                        }

                        changedPaths = changedPaths.unique()
                        if (!changedPaths.isEmpty()) {
                            def onlyDeployPipelineChanged = true
                            for (def changedPath in changedPaths) {
                                if (changedPath != deployPipelinePath) {
                                    onlyDeployPipelineChanged = false
                                    break
                                }
                            }
                            if (onlyDeployPipelineChanged) {
                                env.BUILD_ALLOWED = 'false'
                                currentBuild.result = 'NOT_BUILT'
                                echo "Skipping build: only ${deployPipelinePath} changed."
                            }
                        } else {
                            echo 'No SCM changelog entries available; continuing build.'
                        }
                    }
                }
            }
        }

        // Reset workspace contents before checkout to recover from stale root-owned files across runs.
        stage('Prepare Workspace') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                sh '''
                    docker run --rm -u root:root -v "$WORKSPACE:/ws" node:20 \
                      sh -lc 'find /ws -mindepth 1 -maxdepth 1 -exec rm -rf {} +'
                '''
            }
        }

        // Run compile, lint, tests, and optional E2E in a Node 20 container for parity across projects.
        stage('CI') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            agent {
                docker {
                    image "node:${NODE_VERSION}"
                    args "--entrypoint=''"
                    reuseNode true
                }
            }
            stages {
                // Perform a resilient checkout and set a deterministic image tag from git SHA.
                stage('Checkout') {
                    steps {
                        script {
                            for (int attempt = 1; attempt <= 3; attempt++) {
                                try {
                                    checkout scm
                                    break
                                } catch (err) {
                                    if (attempt == 3) {
                                        throw err
                                    }
                                    int waitSeconds = 10 * attempt
                                    echo "Checkout attempt ${attempt} failed: ${err.getMessage()}"
                                    echo "Retrying checkout in ${waitSeconds}s..."
                                    sleep time: waitSeconds, unit: 'SECONDS'
                                }
                            }
                            def resolvedSha = env.GIT_COMMIT?.trim()
                            if (resolvedSha && resolvedSha != 'null') {
                                resolvedSha = resolvedSha.take(7)
                            }
                            if (!resolvedSha || resolvedSha == 'null') {
                                sh 'git config --global --add safe.directory "$WORKSPACE"'
                                resolvedSha = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                            }
                            if (!resolvedSha || resolvedSha == 'null') {
                                error('Unable to resolve GIT_SHA during checkout.')
                            }
                            env.GIT_SHA = resolvedSha
                            env.IMAGE_TAG = resolvedSha
                        }
                    }
                }

                // Verify runtime versions early so incompatible agents fail fast.
                stage('Verify Tooling') {
                    steps {
                        sh 'node --version'
                        sh 'npm --version'
                        script {
                            def nodeVersion = sh(script: 'node --version', returnStdout: true).trim()
                            def major = nodeVersion.replaceAll(/v(\d+)\..*/, '$1').toInteger()
                            if (major < NODE_MAJOR_REQUIRED.toInteger()) {
                                error("Node.js ${nodeVersion} is older than required v${NODE_MAJOR_REQUIRED}.x")
                            }
                        }
                    }
                }

                // Install locked dependencies for reproducible builds and consistent scans.
                stage('Install Dependencies') {
                    steps {
                        sh '''
                            mkdir -p "$NPM_CACHE_DIR"
                            npm ci --cache "$NPM_CACHE_DIR" --prefer-offline --no-audit --no-fund
                        '''
                    }
                }

                // Build production assets early so downstream stages validate real outputs.
                stage('Build') {
                    steps {
                        sh 'npm run build'
                    }
                    post {
                        success {
                            archiveArtifacts artifacts: 'dist/**/*', fingerprint: true, allowEmptyArchive: false
                        }
                    }
                }

                // Enforce bundle-size budgets to prevent silent frontend payload regressions.
                stage('Bundle Budget') {
                    steps {
                        script {
                            def isReleaseBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                            def maxIndexKb = isReleaseBranch ? 450 : 550
                            def maxPhaserKb = isReleaseBranch ? 1600 : 1700
                            def maxTotalKb = isReleaseBranch ? 2100 : 2300
                            sh """
                                node -e '
                                const fs = require(\"fs\");
                                const path = require(\"path\");
                                const dir = path.join(\"dist\", \"assets\");
                                if (!fs.existsSync(dir)) {
                                  console.error(\"Bundle budget check failed: dist/assets not found.\");
                                  process.exit(1);
                                }
                                const files = fs.readdirSync(dir).filter((name) => name.endsWith(\".js\"));
                                const stats = files.map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size }));
                                const findByPrefix = (prefix) => stats.find((entry) => entry.name.startsWith(prefix));
                                const indexChunk = findByPrefix(\"index-\");
                                const phaserChunk = findByPrefix(\"phaser-\");
                                const totalBytes = stats.reduce((sum, entry) => sum + entry.bytes, 0);

                                const limits = {
                                  index: ${maxIndexKb} * 1024,
                                  phaser: ${maxPhaserKb} * 1024,
                                  total: ${maxTotalKb} * 1024
                                };

                                const violations = [];
                                if (!indexChunk) {
                                  violations.push(\"Missing index-* chunk in dist/assets.\");
                                } else if (indexChunk.bytes > limits.index) {
                                  violations.push(`index chunk \${(indexChunk.bytes / 1024).toFixed(2)} KiB exceeds ${maxIndexKb} KiB.`);
                                }
                                if (!phaserChunk) {
                                  violations.push(\"Missing phaser-* chunk in dist/assets.\");
                                } else if (phaserChunk.bytes > limits.phaser) {
                                  violations.push(`phaser chunk \${(phaserChunk.bytes / 1024).toFixed(2)} KiB exceeds ${maxPhaserKb} KiB.`);
                                }
                                if (totalBytes > limits.total) {
                                  violations.push(`total JS bundle \${(totalBytes / 1024).toFixed(2)} KiB exceeds ${maxTotalKb} KiB.`);
                                }

                                console.log(`Bundle sizes: index=\${indexChunk ? (indexChunk.bytes / 1024).toFixed(2) : \"n/a\"} KiB, phaser=\${phaserChunk ? (phaserChunk.bytes / 1024).toFixed(2) : \"n/a\"} KiB, total=\${(totalBytes / 1024).toFixed(2)} KiB.`);
                                if (violations.length > 0) {
                                  console.error(\"Bundle budget violations:\\n - \" + violations.join(\"\\n - \"));
                                  process.exit(1);
                                }
                                '
                            """
                        }
                    }
                }

                // Run static checks and test execution in parallel to reduce CI cycle time.
                stage('Lint & Test') {
                    parallel {
                        // Enforce lint rules before delivery to keep code quality consistent.
                        stage('Lint') {
                            steps {
                                sh 'npm run lint --if-present -- --max-warnings=0'
                                sh 'npm run format:check --if-present'
                            }
                        }

                        // Execute tests and publish JUnit-compatible reports for Jenkins visibility.
                        stage('Test') {
                            steps {
                                script {
                                    def junitDir = 'tests/junit'
                                    def hasJunit = sh(script: '[ -d node_modules/jest-junit ]', returnStatus: true) == 0
                                    sh "mkdir -p ${junitDir}"
                                    if (hasJunit) {
                                        withEnv(["JEST_JUNIT_OUTPUT_DIR=${junitDir}", "JEST_JUNIT_OUTPUT_NAME=jest-junit.xml"]) {
                                            sh 'npm test -- --ci --coverage=false --reporters=default --reporters=jest-junit'
                                        }
                                    } else {
                                        sh 'npm test -- --ci --coverage=false --json --outputFile=tests/junit/jest.json'
                                        sh 'node scripts/jest-json-to-junit.cjs tests/junit/jest.json tests/junit/jest-junit.xml'
                                    }
                                }
                            }
                            post {
                                always {
                                    junit testResults: 'tests/junit/**/*.xml', allowEmptyResults: true
                                }
                            }
                        }
                    }
                }

                // Publish coverage as a non-blocking quality signal to avoid halting delivery.
                stage('Coverage (Non-Blocking)') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            sh 'npm run test:coverage --if-present'
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'tests/coverage/**/*', fingerprint: true, allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        // Run a release-branch happy-path E2E check and optionally run full E2E on demand.
        // NOTE: This stage must run on the Jenkins agent (not inside the Node CI container), because it needs to launch
        // the Playwright Docker image and the nested Docker CLI is not available inside the CI container (see build #35).
        stage('E2E (Release Happy Path)') {
            when {
                expression {
                    return env.BUILD_ALLOWED == 'true' && ((env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/) || params.RUN_E2E)
                }
            }
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    script {
                        def isReleaseBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                        def runFullE2E = (params.RUN_E2E == true)
                        def runHappyPath = isReleaseBranch && !runFullE2E

                        def playwrightVersion = sh(
                            script: '''
                                set -e
                                docker run --rm -u "$(id -u):$(id -g)" \
                                  -v "$WORKSPACE:/work" -w /work \
                                  node:20 \
                                  sh -lc '
                                    if [ -f node_modules/@playwright/test/package.json ]; then
                                      node -p "require(\\"./node_modules/@playwright/test/package.json\\").version"
                                    elif [ -f package-lock.json ]; then
                                      node -e "const lock=require(\\"./package-lock.json\\"); const v=(lock?.packages?.[\\"node_modules/@playwright/test\\"]?.version)|| (lock?.dependencies?.[\\"@playwright/test\\"]?.version) || \\"\\"; process.stdout.write(v);"
                                    else
                                      echo ""
                                    fi
                                  '
                            ''',
                            returnStdout: true
                        ).trim()

                        if (!playwrightVersion) {
                            unstable('Skipping E2E: unable to resolve @playwright/test version from node_modules or package-lock.json.')
                            return
                        }

                        def playwrightImage = "mcr.microsoft.com/playwright:v${playwrightVersion}-jammy"
                        def dockerRunBase = """
                            docker run --rm --ipc=host \
                              -u "\$(id -u):\$(id -g)" \
                              -v "${env.WORKSPACE}:/work" \
                              -w /work \
                              ${playwrightImage} \
                              bash -lc
                        """.trim()

                        sh "${dockerRunBase} 'npx playwright --version'"

	                        if (runHappyPath) {
	                            sh "${dockerRunBase} 'npx playwright test tests/e2e/ui-interactions.spec.js --project=chromium --grep \"should open settings modal\"'"
	                            sh "${dockerRunBase} 'npx playwright test tests/e2e/accessibility.spec.js --project=chromium'"
	                        }

                        if (runFullE2E) {
                            sh "${dockerRunBase} 'npm run test:e2e'"
                        }
                    }
                }
            }
            post {
                always {
                    archiveArtifacts artifacts: 'playwright-report/**/*,tests/test-results/**/*', fingerprint: true, allowEmptyArchive: true
                }
            }
        }

        // Run code-quality analysis and security checks in parallel for faster feedback.
        stage('Analysis & Security') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            parallel {
                // Send source and coverage data to SonarQube for centralized quality metrics.
                stage('SonarQube Analysis') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            withSonarQubeEnv('SonarQube') {
                                withEnv([
                                    "SONAR_SCANNER_DEBUG=${params.SONAR_VERBOSE ? '-X' : ''}",
                                    "SONAR_SCANNER_VERBOSE=${params.SONAR_VERBOSE ? '-Dsonar.verbose=true' : ''}"
                                ]) {
                                    sh '''
                                        docker run --rm \
                                          -u "$(id -u):$(id -g)" \
                                          -e SONAR_HOST_URL="$SONAR_HOST_URL" \
                                          -e SONAR_TOKEN="$SONAR_AUTH_TOKEN" \
                                          -v "$WORKSPACE:/usr/src" \
                                          sonarsource/sonar-scanner-cli:11 \
                                          sonar-scanner $SONAR_SCANNER_DEBUG $SONAR_SCANNER_VERBOSE \
                                            -Dsonar.projectKey=dorfgefluester \
                                            -Dsonar.projectName="Dorfgefluester" \
                                            -Dsonar.sources=. \
                                            -Dsonar.exclusions=**/node_modules/**,**/dist/**,**/tests/**,**/coverage/**,**/assets/tilemaps/**/*.tsx \
                                            -Dsonar.javascript.lcov.reportPaths=tests/coverage/lcov.info \
                                            -Dsonar.scanner.metadataFilePath=/usr/src/report-task.txt \
                                            -Dsonar.host.url="$SONAR_HOST_URL"
                                    '''
                                }
                            }
                        }
                    }
                }

                // Execute independent security scans in parallel so one slow scan does not block others.
	                stage('Security Scans') {
	                    steps {
	                        script {
	                            parallel(
                                // Scan the repository filesystem for high/critical issues without failing the pipeline.
                                'Trivy FS Scan': {
                                    sh '''
                                        mkdir -p reports/trivy
                                        mkdir -p "$TRIVY_FS_CACHE_DIR"
                                        docker run --rm -u "$(id -u):$(id -g)" \
                                          -v "$WORKSPACE:/src" \
                                          -v "$TRIVY_FS_CACHE_DIR:/tmp/trivy-cache" \
                                          aquasec/trivy fs /src \
                                          --cache-dir /tmp/trivy-cache \
                                          --format json --output /src/reports/trivy/fs.json \
                                          --exit-code 0 --severity HIGH,CRITICAL --ignore-unfixed || true
                                    '''
                                },
                                // Run Semgrep SAST ruleset for fast pattern-based vulnerability detection.
                                'Semgrep': {
                                    sh '''
                                        docker run --rm -u "$(id -u):$(id -g)" -v "$WORKSPACE:/src" \
                                          returntocorp/semgrep semgrep scan /src \
                                          --config auto --error || true
                                    '''
                                },
	                                // Run npm audit as a dependency-risk signal while keeping delivery non-blocking.
	                                'npm Audit': {
	                                    sh 'npm audit --audit-level=high --package-lock-only || true'
	                                },
	                                // Scan workspace files for leaked secrets while excluding generated artifacts.
	                                'Gitleaks': {
	                                    sh 'mkdir -p reports/gitleaks'
                                    def status = sh(
                                        script: '''
                                            set -eu
                                            TMPDIR="$(mktemp -d)"
                                            cleanup() {
                                              rm -rf "$TMPDIR"
                                            }
                                            trap cleanup EXIT

                                            mkdir -p "$TMPDIR/repo" "$WORKSPACE/reports/gitleaks"
                                            tar \
                                              --exclude='./.git' \
                                              --exclude='./.scannerwork' \
                                              --exclude='./playwright-report' \
                                              --exclude='./tests/test-results' \
                                              --exclude='./reports' \
                                              -cf - . | tar -C "$TMPDIR/repo" -xf -

                                            docker run --rm -u "$(id -u):$(id -g)" \
                                              -v "$TMPDIR/repo:/repo" \
                                              -v "$WORKSPACE/reports/gitleaks:/reports" \
                                              -w /repo \
                                              zricethezav/gitleaks:latest detect \
                                              --source=/repo \
                                              --no-git \
                                              --report-format json \
                                              --report-path /reports/gitleaks.json \
                                              --no-banner
                                        ''',
                                        returnStatus: true
                                    )
                                    if (status == 1) {
                                        unstable('Gitleaks detected potential secrets. See reports/gitleaks/gitleaks.json')
                                    } else if (status != 0) {
                                        unstable("Gitleaks execution failed (exit ${status}). See Jenkins logs for details.")
                                    } else {
                                        echo 'Gitleaks: no leaks detected.'
                                    }
                                }
	                            )
	                        }
	                    }
	                }
            }
        }

        // Wait for SonarQube to finish processing the analysis report.
        // We do NOT fail or mark UNSTABLE based on the global Sonar Quality Gate here, because the default gate
        // is currently too strict for this repo (new_violations/new_coverage/hotspot review). Instead we apply a
        // focused gate later based on HIGH-impact Security/Reliability findings (see "Sonar Gate (High Impact)").
        stage('Quality Gate') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                script {
                    if (!fileExists('report-task.txt')) {
                        echo 'Skipping waitForQualityGate: Sonar report-task.txt not found.'
                        return
                    }
                    try {
                        timeout(time: 5, unit: 'MINUTES') {
                            def qg = waitForQualityGate()
                            echo "SonarQube quality gate status (informational): ${qg.status}"
                        }
                    } catch (err) {
                        echo "Unable to retrieve SonarQube quality gate (continuing): ${err.getMessage()}"
                    }
                }
            }
        }

        // Export a snapshot of SonarQube issues and persist scanner outputs as Jenkins artifacts for backlog triage.
        stage('Export Findings') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    withSonarQubeEnv('SonarQube') {
                        sh '''
                            docker run --rm -u "$(id -u):$(id -g)" \
                              -v "$WORKSPACE:/work" -w /work \
                              -e SONAR_HOST_URL="$SONAR_HOST_URL" \
                              -e SONAR_TOKEN="$SONAR_AUTH_TOKEN" \
                              node:20 \
                              node scripts/quality/sonarqube-export.cjs \
                                --project-key dorfgefluester \
                                --out-json reports/sonarqube/issues.json \
                                --out-md reports/sonarqube/issues.md

                            docker run --rm -u "$(id -u):$(id -g)" \
                              -v "$WORKSPACE:/work" -w /work \
                              -e SONAR_HOST_URL="$SONAR_HOST_URL" \
                              -e SONAR_TOKEN="$SONAR_AUTH_TOKEN" \
                              node:20 \
                              node scripts/quality/sonar-report.cjs \
                                --project-key dorfgefluester \
                                --out-json reports/sonarqube/sonar-report.json \
                                --out-md reports/sonarqube/sonar-report.md \
                                --strict false

                            echo ""
                            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                            echo "SonarQube Report (from reports/sonarqube/sonar-report.md)"
                            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                            echo ""
                            sed -n '1,220p' reports/sonarqube/sonar-report.md || true
                        '''
                    }
                }
            }
        }

        // Mark the build UNSTABLE only when SonarQube reports HIGH-impact Security or Reliability findings.
        // This keeps CI "green by default" while you continuously burn down medium/maintainability issues.
        stage('Sonar Gate (High Impact)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                script {
                    def reportPath = 'reports/sonarqube/sonar-report.json'
                    if (!fileExists(reportPath)) {
                        echo "Skipping Sonar gate: ${reportPath} not found."
                        return
                    }

                    // Avoid Groovy JSON parsing in Jenkins sandbox (script-security blocks JsonSlurperClassic by default).
                    // Read totals via a short Node.js snippet inside a Node 20 container.
                    def gateLine = sh(
                        script: '''
                          set -e

                          REPORT_PATH="reports/sonarqube/sonar-report.json"
                          if [ ! -f "$REPORT_PATH" ]; then
                            echo "REL_HIGH=0 SEC_HIGH=0"
                            exit 0
                          fi

                          WORKDIR="${WORKSPACE:-$(pwd)}"
                          docker run --rm -u "$(id -u):$(id -g)" \
                            -v "$WORKDIR:/work" -w /work \
                            node:20 \
                            node -e '
                              const fs = require("fs");
                              const path = process.argv[1];
                              const report = JSON.parse(fs.readFileSync(path, "utf8"));
                              const rel = Number(report?.totals?.reliability_high ?? (Array.isArray(report?.reliability_high) ? report.reliability_high.length : 0));
                              const sec = Number(report?.totals?.security_high ?? (Array.isArray(report?.security_high) ? report.security_high.length : 0));
                              const relHigh = Number.isFinite(rel) ? rel : 0;
                              const secHigh = Number.isFinite(sec) ? sec : 0;
                              console.log(`REL_HIGH=${relHigh} SEC_HIGH=${secHigh}`);
                            ' "$REPORT_PATH"
                        ''',
                        returnStdout: true
                    ).trim()

                    def matcher = gateLine =~ /REL_HIGH=(\d+)\s+SEC_HIGH=(\d+)/
                    if (!matcher.find()) {
                        echo "Unable to parse Sonar gate counts from: ${gateLine}"
                        return
                    }

                    def relHigh = (matcher.group(1) as Integer)
                    def secHigh = (matcher.group(2) as Integer)

                    if (relHigh > 0 || secHigh > 0) {
                        unstable("High-impact Sonar findings: reliability_high=${relHigh}, security_high=${secHigh}")
                    } else {
                        echo 'No HIGH-impact reliability/security findings (Sonar gate passed).'
                    }
                }
            }
        }

        // Validate Helm chart rendering in CI so deployment failures are caught pre-release.
        stage('Helm Validation (Parallel)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            parallel {
                // Lint chart templates to catch syntax and schema issues before deployment.
                stage('Helm Lint') {
                    steps {
                        script {
                            def hasHelm = sh(script: 'command -v helm >/dev/null 2>&1', returnStatus: true) == 0
                            if (hasHelm) {
                                sh 'helm lint helm/dorfgefluester'
                            } else {
                                echo 'Helm not found on agent; skipping Helm Lint.'
                            }
                        }
                    }
                }

                // Render manifests and run client-side apply to verify Kubernetes compatibility.
                stage('Helm Render (Dry Run)') {
                    steps {
                        script {
                            def hasHelm = sh(script: 'command -v helm >/dev/null 2>&1', returnStatus: true) == 0
                            def hasKubectl = sh(script: 'command -v kubectl >/dev/null 2>&1', returnStatus: true) == 0
                            if (hasHelm && hasKubectl) {
                                sh """
                                  helm template ${RELEASE} helm/dorfgefluester \
                                    --namespace ${NAMESPACE} \
                                    --set image.repository=${IMAGE_REPO} \
                                    --set image.tag=ci-dry-run \
                                    --set ingress.host=dorf.test > /tmp/${RELEASE}-rendered.yaml
                                  kubectl apply --dry-run=client -f /tmp/${RELEASE}-rendered.yaml
                                """
                            } else {
                                echo 'Helm or kubectl not found on agent; skipping Helm Render (Dry Run).'
                            }
                        }
                    }
                }
            }
        }

        // Build, scan, push, and archive metadata for the deployable container image.
        stage('Docker Build, Scan & Push') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                anyOf {
                    branch pattern: '0.*', comparator: 'GLOB'
                    branch 'staging'
                    branch 'master'
                }
            }
            stages {
                // Build the immutable SHA-tagged image that will be scanned and published.
                stage('Build Docker Image') {
                    steps {
                        script {
                            def isUnset = { value ->
                                return !value?.trim() || value.trim() == 'null'
                            }
                            def resolvedTag = env.IMAGE_TAG?.trim()
                            if (isUnset(resolvedTag) && !isUnset(env.GIT_COMMIT)) {
                                resolvedTag = env.GIT_COMMIT.take(7)
                            }
                            if (isUnset(resolvedTag)) {
                                sh 'git config --global --add safe.directory "$WORKSPACE"'
                                resolvedTag = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                            }
                            if (isUnset(resolvedTag)) {
                                error('Unable to resolve IMAGE_TAG from GIT_COMMIT or git rev-parse.')
                            }
                            env.GIT_SHA = resolvedTag
                            env.IMAGE_TAG = resolvedTag
                            echo "Using image tag ${resolvedTag}."
                            sh "docker build -t ${IMAGE_REPO}:${resolvedTag} ."
                        }
                    }
                }

                // Scan the built image for high/critical vulnerabilities before publishing.
                stage('Scan Docker Image') {
                    steps {
                        script {
                            def imageTag = env.IMAGE_TAG?.trim()
                            if (!imageTag || imageTag == 'null') {
                                sh 'git config --global --add safe.directory "$WORKSPACE"'
                                imageTag = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                            }
                            if (!imageTag || imageTag == 'null') {
                                error('Unable to resolve IMAGE_TAG for image scan.')
                            }
                            def isReleaseBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                            def trivyCacheDir = "${env.TRIVY_IMAGE_CACHE_DIR}"
                            sh "mkdir -p '${trivyCacheDir}'"
                            sh 'mkdir -p reports/trivy'

                            def dbRepos = [
                                'mirror.gcr.io/aquasec/trivy-db:2',
                                'ghcr.io/aquasecurity/trivy-db:2',
                                'public.ecr.aws/aquasecurity/trivy-db:2'
                            ]
                            def dbReady = false
                            for (def repo : dbRepos) {
                                echo "Attempting Trivy DB download from ${repo}..."
                                def dbStatus = sh(
                                    script: """
                                        docker run --rm \
                                          -v '${trivyCacheDir}:/tmp/trivy-cache' \
                                          aquasec/trivy image \
                                          --cache-dir /tmp/trivy-cache \
                                          --download-db-only \
                                          --db-repository ${repo}
                                    """,
                                    returnStatus: true
                                )
                                if (dbStatus == 0) {
                                    dbReady = true
                                    break
                                }
                            }
                            if (!dbReady) {
                                error('Unable to download Trivy vulnerability DB from configured repositories.')
                            }

                            def trivyCommand = """
                                docker run --rm \
                                  -v /var/run/docker.sock:/var/run/docker.sock \
                                  -v '${trivyCacheDir}:/tmp/trivy-cache' \
                                  -v '${env.WORKSPACE}:/work' \
                                  aquasec/trivy image \
                                  --cache-dir /tmp/trivy-cache \
                                  --skip-db-update \
                                  --format json --output /work/reports/trivy/image.json \
                                  --exit-code 1 --severity ${isReleaseBranch ? 'CRITICAL' : 'HIGH,CRITICAL'} --ignore-unfixed \
                                  "${IMAGE_REPO}:${imageTag}"
                            """
                            if (isReleaseBranch) {
                                sh trivyCommand
                            } else {
                                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                                    sh trivyCommand
                                }
                            }
                        }
                    }
                }

	                // Push directly when possible and fallback via deploy host for insecure-registry setups.
	                stage('Push Docker Image') {
	                    when {
	                        branch 'master'
	                    }
	                    steps {
	                        script {
	                            def imageTag = env.IMAGE_TAG?.trim()
	                            if (!imageTag || imageTag == 'null') {
	                                sh 'git config --global --add safe.directory "$WORKSPACE"'
	                                imageTag = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
	                            }
	                            if (!imageTag || imageTag == 'null') {
	                                error('Unable to resolve IMAGE_TAG for docker push.')
	                            }
	                            env.IMAGE_TAG = imageTag
	                            def extraTags = []
	                            if (env.BRANCH_NAME == 'master') {
	                                extraTags << 'master-latest'
	                            } else if (env.BRANCH_NAME == 'staging') {
	                                extraTags << 'staging-latest'
	                            }
	                            extraTags = extraTags.findAll { it?.trim() }.unique()

	                            for (def tag : extraTags) {
	                                sh "docker tag ${IMAGE_REPO}:${imageTag} ${IMAGE_REPO}:${tag}"
	                            }

	                            def tagsToPush = ([imageTag] + extraTags).unique()
	                            def pushDirectAll = {
	                                def ok = true
	                                for (def tag : tagsToPush) {
	                                    def status = sh(script: "docker push ${IMAGE_REPO}:${tag}", returnStatus: true)
	                                    if (status != 0) {
	                                        ok = false
	                                    }
	                                }
	                                return ok
	                            }

	                            def pushSkopeoAll = {
	                                def ok = true
	                                for (def tag : tagsToPush) {
	                                    def status = sh(
	                                        script: """
	                                          docker run --rm \
	                                            -v /var/run/docker.sock:/var/run/docker.sock \
	                                            quay.io/skopeo/stable:latest \
	                                            copy --dest-tls-verify=false \
	                                            docker-daemon:${IMAGE_REPO}:${tag} \
	                                            docker://${IMAGE_REPO}:${tag}
	                                        """,
	                                        returnStatus: true
	                                    )
	                                    if (status != 0) {
	                                        ok = false
	                                    }
	                                }
	                                return ok
	                            }

	                            if (pushDirectAll()) {
	                                echo "Image pushed directly from Jenkins agent (${tagsToPush.join(', ')})."
	                            } else {
	                                echo "Direct push failed (likely insecure registry/TLS mismatch). Trying skopeo HTTP push."
	                                if (pushSkopeoAll()) {
	                                    echo "Image pushed from Jenkins agent using skopeo HTTP fallback (${tagsToPush.join(', ')})."
	                                } else {
	                                    echo "Skopeo HTTP push failed. Falling back to push via ${DEPLOY_HOST}."
	                                    def imageArchive = "/tmp/${RELEASE}-${imageTag}.tar.gz"
	                                    def sshCredCandidates = [env.SSH_CRED_ID, 'dev-env-01-ssh', 'deploy'].findAll { it?.trim() }.unique()
	                                    def pushedViaSsh = false
	                                    def lastSshError = null
	                                    for (def credId : sshCredCandidates) {
	                                        try {
	                                            withCredentials([sshUserPrivateKey(credentialsId: credId, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
	                                                def extraTagsCsv = extraTags.join(',')
	                                                sh """
	                                                  set -e
	                                                  docker save ${IMAGE_REPO}:${imageTag} | gzip > ${imageArchive}
	                                                  scp -i "\$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no ${imageArchive} \$SSH_USER@${DEPLOY_HOST}:/tmp/
	                                                  ssh -i "\$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \$SSH_USER@${DEPLOY_HOST} '
	                                                    set -e
	                                                    IMAGE_ARCHIVE=${imageArchive}
	                                                    IMAGE_TAG=${imageTag}
	                                                    IMAGE_REPO=${IMAGE_REPO}
	                                                    EXTRA_TAGS_CSV="${extraTagsCsv}"
	                                                    if docker info >/dev/null 2>&1; then
	                                                      DOCKER_CMD="docker"
	                                                    elif sudo -n docker info >/dev/null 2>&1; then
	                                                      DOCKER_CMD="sudo docker"
	                                                    elif sudo -n k3s ctr version >/dev/null 2>&1; then
	                                                      gunzip -c \$IMAGE_ARCHIVE | sudo -n k3s ctr -n k8s.io images import -
	                                                      sudo -n k3s ctr -n k8s.io images push --plain-http \$IMAGE_REPO:\$IMAGE_TAG
	                                                      if [ -n "\$EXTRA_TAGS_CSV" ]; then
	                                                        IFS=","; for t in \$EXTRA_TAGS_CSV; do
	                                                          [ -n "\$t" ] || continue
	                                                          sudo -n k3s ctr -n k8s.io images tag \$IMAGE_REPO:\$IMAGE_TAG \$IMAGE_REPO:\$t
	                                                          sudo -n k3s ctr -n k8s.io images push --plain-http \$IMAGE_REPO:\$t
	                                                        done
	                                                      fi
	                                                      rm -f \$IMAGE_ARCHIVE
	                                                      exit 0
	                                                    else
	                                                      echo "Neither docker nor k3s ctr is available for user \$USER on ${DEPLOY_HOST}."
	                                                      exit 1
	                                                    fi
	                                                    gunzip -c \$IMAGE_ARCHIVE | \$DOCKER_CMD load
	                                                    \$DOCKER_CMD push \$IMAGE_REPO:\$IMAGE_TAG
	                                                    if [ -n "\$EXTRA_TAGS_CSV" ]; then
	                                                      IFS=","; for t in \$EXTRA_TAGS_CSV; do
	                                                        [ -n "\$t" ] || continue
	                                                        \$DOCKER_CMD tag \$IMAGE_REPO:\$IMAGE_TAG \$IMAGE_REPO:\$t
	                                                        \$DOCKER_CMD push \$IMAGE_REPO:\$t
	                                                      done
	                                                    fi
	                                                    rm -f \$IMAGE_ARCHIVE
	                                                  '
	                                                  rm -f ${imageArchive}
	                                                """
	                                            }
	                                            env.SSH_CRED_ID = credId
	                                            echo "Image pushed via SSH using credential '${credId}' (${tagsToPush.join(', ')})."
	                                            pushedViaSsh = true
	                                            break
	                                        } catch (err) {
	                                            lastSshError = err
	                                            echo "SSH push fallback failed with credential '${credId}': ${err.getMessage()}"
	                                        }
	                                    }
	                                    if (!pushedViaSsh) {
	                                        throw lastSshError ?: new RuntimeException('SSH push fallback failed for all configured credentials.')
	                                    }
	                                }
	                            }

	                            // Best-effort verification: confirm the tag(s) exist in registry after push.
	                            catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
	                                sh """
	                                  set -e
	                                  url="http://${REGISTRY}/v2/${IMAGE_NAME}/tags/list"
	                                  if ! tags_json=\$(curl -fsS "\$url"); then
	                                    echo "WARN: unable to query registry tags at \$url"
	                                    exit 0
	                                  fi
	                                  for t in ${tagsToPush.join(' ')}; do
	                                    echo "\$tags_json" | grep -Fq "\"\$t\"" || { echo "WARN: registry tag missing after push: \$t"; exit 1; }
	                                  done
	                                  echo "Registry tags verified: ${tagsToPush.join(', ')}"
	                                """
	                            }
	                        }
	                    }
	                }

                // Archive build metadata so downstream deploy jobs can consume image details reliably.
                stage('Archive Build Metadata') {
                    steps {
                        script {
                            def imageTag = env.IMAGE_TAG?.trim()
                            if (!imageTag || imageTag == 'null') {
                                sh 'git config --global --add safe.directory "$WORKSPACE"'
                                imageTag = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                            }
                            if (!imageTag || imageTag == 'null') {
                                error('Unable to resolve IMAGE_TAG for build metadata.')
                            }
                            env.IMAGE_TAG = imageTag
                        }
                        sh """
                          cat > build-meta.json <<EOF
                          {
                            "gitSha": "${env.GIT_SHA}",
                            "imageTag": "${env.IMAGE_TAG}",
                            "branch": "${env.BRANCH_NAME}",
                            "buildNumber": "${env.BUILD_NUMBER}",
                            "registry": "${env.REGISTRY}",
                            "image": "${env.IMAGE_REPO}:${env.IMAGE_TAG}"
                          }
                          EOF
                        """
                        archiveArtifacts artifacts: 'build-meta.json', allowEmptyArchive: false
                    }
                }
            }
            post {
                success {
                    script {
                        def publishedTag = env.IMAGE_TAG?.trim()
                        if (!publishedTag || publishedTag == 'null') {
                            publishedTag = env.GIT_SHA?.trim()
                        }
                        echo "Image published: ${env.IMAGE_REPO}:${publishedTag ?: 'unknown'}"
                    }
                    echo "Use dedicated deploy pipelines for environment rollout (e.g. jenkins/*-deploy.Jenkinsfile)."
                }
            }
        }
    }

	    post {
	        success {
	            script {
	                if (env.BRANCH_NAME == 'master') {
	                    catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
	                        build job: 'dorfgefluester-INT',
	                            wait: false,
	                            parameters: [
	                                string(name: 'IMAGE_TAG', value: env.IMAGE_TAG),
	                                string(name: 'BRANCH', value: env.BRANCH_NAME)
	                            ]
	                    }
	                }
	            }
	        }
	        always {
	            // Persist scan outputs for backlog triage (SonarQube issues export, Trivy JSON reports, etc.).
	            archiveArtifacts artifacts: 'reports/**/*,report-task.txt', fingerprint: false, allowEmptyArchive: true
	            // Skip cleanWs to preserve "$WORKSPACE@tmp" caches (npm/trivy) for faster subsequent builds.
	            // The workspace root itself is wiped at the start of each build in "Prepare Workspace".
            echo 'Skipping cleanWs to keep per-workspace caches.'
        }
    }
}
