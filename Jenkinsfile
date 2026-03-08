pipeline {
    agent { label 'linux-docker' }

    parameters {
        booleanParam(name: 'RUN_E2E', defaultValue: false, description: 'Run Playwright E2E tests')
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

                // Run a release-branch happy-path E2E check and optionally run full E2E on demand.
                stage('E2E (Release Happy Path)') {
                    when {
                        expression { return (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/) || params.RUN_E2E }
                    }
                    agent {
                        docker {
                            // Chromium launched by Playwright needs system deps not present in the plain node image.
                            // Using the official Playwright image here avoids downloading browsers and fixes missing libs (e.g. libnspr4.so).
                            image 'mcr.microsoft.com/playwright:v1.57.0-jammy'
                            args "--entrypoint='' --ipc=host"
                            reuseNode true
                        }
                    }
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            script {
                                def isReleaseBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                                sh 'npx playwright --version'
                                if (isReleaseBranch) {
                                    sh "npx playwright test tests/e2e/ui-interactions.spec.js --project=chromium --grep \"should open settings modal\""
                                }
                                if (params.RUN_E2E) {
                                    sh 'npm run test:e2e'
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
                                sh '''
                                    docker run --rm \
                                      -u "$(id -u):$(id -g)" \
                                      -e SONAR_HOST_URL="$SONAR_HOST_URL" \
                                      -e SONAR_TOKEN="$SONAR_AUTH_TOKEN" \
                                      -v "$WORKSPACE:/usr/src" \
                                      sonarsource/sonar-scanner-cli:11 \
                                      sonar-scanner \
                                        -Dsonar.projectKey=dorfgefluester \
                                        -Dsonar.projectName="Dorfgefluester" \
                                        -Dsonar.sources=. \
                                        -Dsonar.exclusions=**/node_modules/**,**/dist/**,**/tests/**,**/coverage/** \
                                        -Dsonar.javascript.lcov.reportPaths=tests/coverage/lcov.info \
                                        -Dsonar.scanner.metadataFilePath=/usr/src/report-task.txt \
                                        -Dsonar.host.url="$SONAR_HOST_URL"
                                '''
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
                                        mkdir -p "$TRIVY_FS_CACHE_DIR"
                                        docker run --rm -u "$(id -u):$(id -g)" \
                                          -v "$WORKSPACE:/src" \
                                          -v "$TRIVY_FS_CACHE_DIR:/tmp/trivy-cache" \
                                          aquasec/trivy fs /src \
                                          --cache-dir /tmp/trivy-cache \
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
                                }
                            )
                        }
                    }
                }
            }
        }

        // Evaluate SonarQube quality gate and mark UNSTABLE instead of failing hard on gate errors.
        stage('Quality Gate') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    script {
                        if (!fileExists('report-task.txt')) {
                            unstable('Skipping quality gate: Sonar report-task.txt not found.')
                            return
                        }
                        timeout(time: 5, unit: 'MINUTES') {
                            def qg = waitForQualityGate()
                            if (qg.status != 'OK') {
                                unstable("Quality gate failed: ${qg.status}")
                            }
                        }
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
                                  aquasec/trivy image \
                                  --cache-dir /tmp/trivy-cache \
                                  --skip-db-update \
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
                            def directPushStatus = sh(script: "docker push ${IMAGE_REPO}:${imageTag}", returnStatus: true)
                            if (directPushStatus == 0) {
                                echo 'Image pushed directly from Jenkins agent.'
                            } else {
                                echo "Direct push failed (likely insecure registry/TLS mismatch). Trying skopeo HTTP push."
                                def skopeoPushStatus = sh(
                                    script: """
                                      docker run --rm \
                                        -v /var/run/docker.sock:/var/run/docker.sock \
                                        quay.io/skopeo/stable:latest \
                                        copy --dest-tls-verify=false \
                                        docker-daemon:${IMAGE_REPO}:${imageTag} \
                                        docker://${IMAGE_REPO}:${imageTag}
                                    """,
                                    returnStatus: true
                                )
                                if (skopeoPushStatus == 0) {
                                    echo 'Image pushed from Jenkins agent using skopeo HTTP fallback.'
                                    return
                                }
                                echo "Skopeo HTTP push failed. Falling back to push via ${DEPLOY_HOST}."
                                def imageArchive = "/tmp/${RELEASE}-${imageTag}.tar.gz"
                                def sshCredCandidates = [env.SSH_CRED_ID, 'dev-env-01-ssh', 'deploy'].findAll { it?.trim() }.unique()
                                def pushedViaSsh = false
                                def lastSshError = null
                                for (def credId : sshCredCandidates) {
                                    try {
                                        withCredentials([sshUserPrivateKey(credentialsId: credId, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                                            sh """
                                              set -e
                                              docker save ${IMAGE_REPO}:${imageTag} | gzip > ${imageArchive}
                                              scp -i "\$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no ${imageArchive} \$SSH_USER@${DEPLOY_HOST}:/tmp/
                                              ssh -i "\$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \$SSH_USER@${DEPLOY_HOST} '
                                                set -e
                                                IMAGE_ARCHIVE=${imageArchive}
                                                if docker info >/dev/null 2>&1; then
                                                  DOCKER_CMD="docker"
                                                elif sudo -n docker info >/dev/null 2>&1; then
                                                  DOCKER_CMD="sudo docker"
                                                elif sudo -n k3s ctr version >/dev/null 2>&1; then
                                                  gunzip -c \$IMAGE_ARCHIVE | sudo -n k3s ctr -n k8s.io images import -
                                                  sudo -n k3s ctr -n k8s.io images push --plain-http ${IMAGE_REPO}:${imageTag}
                                                  rm -f \$IMAGE_ARCHIVE
                                                  exit 0
                                                else
                                                  echo "Neither docker nor k3s ctr is available for user \$USER on ${DEPLOY_HOST}."
                                                  exit 1
                                                fi
                                                gunzip -c \$IMAGE_ARCHIVE | \$DOCKER_CMD load
                                                \$DOCKER_CMD push ${IMAGE_REPO}:${imageTag}
                                                rm -f \$IMAGE_ARCHIVE
                                              '
                                              rm -f ${imageArchive}
                                            """
                                        }
                                        env.SSH_CRED_ID = credId
                                        echo "Image pushed via SSH using credential '${credId}'."
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
        always {
            // Clean workspace only. Docker cache is preserved for faster incremental builds.
            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
        }
    }
}
