pipeline {
    agent { label 'linux-docker' }

    parameters {
        booleanParam(name: 'RUN_E2E', defaultValue: false, description: 'Run Playwright E2E tests')
        booleanParam(name: 'SONAR_VERBOSE', defaultValue: false, description: 'Enable verbose Sonar scanner logs (-X)')
    }

    options {
        buildDiscarder(logRotator(daysToKeepStr: '7', numToKeepStr: '10', artifactDaysToKeepStr: '7', artifactNumToKeepStr: '5'))
        timeout(time: 45, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    environment {
        PROJECT_NAME = 'dorfgefluester'
        IMAGE_NAME = 'dorfgefluester'
        API_IMAGE_NAME = 'dorfgefluester-api'
        NODE_VERSION = '20'
        NODE_MAJOR_REQUIRED = '18'
        REGISTRY = 'dev-env-01:5000'
        IMAGE_REPO = "${REGISTRY}/${IMAGE_NAME}"
        API_IMAGE_REPO = "${REGISTRY}/${API_IMAGE_NAME}"
        DEPLOY_HOST = 'dev-env-01'
        DEPLOY_USER = 'deploy'
        SSH_CRED_ID = 'deploy'
        NAMESPACE = 'dev'
        RELEASE = 'dorfgefluester'
        BUILD_ALLOWED = 'true'
        GIT_SHA = ''
        IMAGE_TAG = ''
        // Keep dependency/scanner caches in the per-job workspace tmp area so the Dockerized CI stages can
        // write to them while still surviving the workspace wipe in "Prepare Workspace".
        CACHE_ROOT = "${WORKSPACE}@tmp/.cache/jenkins/${PROJECT_NAME}"
        JOB_CACHE_DIR = "${CACHE_ROOT}/${JOB_NAME}"
        JOB_CACHE_TOUCH_FILE = "${JOB_CACHE_DIR}/.last-used"
        NPM_CACHE_DIR = "${JOB_CACHE_DIR}/npm"
        TRIVY_FS_CACHE_DIR = "${JOB_CACHE_DIR}/trivy-fs"
        TRIVY_IMAGE_CACHE_DIR = "${JOB_CACHE_DIR}/trivy-image"
        TRIVY_IMAGE = 'docker.io/aquasec/trivy@sha256:7228e304ae0f610a1fad937baa463598cadac0c2ac4027cc68f3a8b997115689'
        DOCKER_BUILDX_CACHE_DIR = "${JOB_CACHE_DIR}/docker-buildx"
        DEPENDENCY_TRACK_URL = 'http://docker-prod:8080'
        DEPENDENCY_TRACK_PROJECT_NAME = 'dorfgefluester'
    }

    stages {
        // Build only the latest semantic-version branch to reduce redundant CI load.
        stage('Gate: Latest Version Branch') {
            steps {
                script {
                    def isVersionBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                    if (isVersionBranch) {
                        env.LATEST_VERSION_BRANCH = env.BRANCH_NAME
                        echo "Version branch (${env.BRANCH_NAME}); continuing. Remote latest-version gating is disabled on current Jenkins agents."
                    } else {
                        echo "Non-version branch (${env.BRANCH_NAME}); continuing."
                    }

                    if (env.BUILD_ALLOWED == 'true') {
                        def deployPipelinePath = 'jenkins/dorfgefluester-staging-deploy.Jenkinsfile'
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

        // Run compile, lint, tests, and optional E2E from the Jenkins agent while executing
        // the Node-based workload itself in short-lived Docker containers. This keeps the
        // runtime consistent with dependency installation/build (Node 20) without relying on
        // a long-lived nested Docker agent wrapper, which has been unstable on these workers.
        stage('CI') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            stages {
                // Perform a resilient checkout and set a deterministic image tag from git SHA.
                stage('Checkout') {
                    steps {
                        script {
                            for (int attempt = 1; attempt <= 3; attempt++) {
                                try {
                                    def scmVars = checkout scm
                                    def resolvedSha = scmVars?.GIT_COMMIT?.trim()
                                    if (resolvedSha && resolvedSha != 'null') {
                                        resolvedSha = resolvedSha.take(7)
                                    }
                                    if (!resolvedSha) {
                                        resolvedSha = env.GIT_COMMIT?.trim()
                                        if (resolvedSha && resolvedSha != 'null') {
                                            resolvedSha = resolvedSha.take(7)
                                        }
                                    }
                                    if (!resolvedSha || resolvedSha == 'null') {
                                        error('Unable to resolve GIT_SHA during checkout.')
                                    }
                                    env.GIT_SHA = resolvedSha
                                    env.IMAGE_TAG = resolvedSha
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
                            mkdir -p "$(dirname "$JOB_CACHE_TOUCH_FILE")"
                            touch "$JOB_CACHE_TOUCH_FILE"
                            mkdir -p "$NPM_CACHE_DIR"
                            docker run --rm -u "$(id -u):$(id -g)" \
                              -v "$WORKSPACE:/work" -w /work \
                              -v "$NPM_CACHE_DIR:/tmp/npm-cache" \
                              -e HOME=/tmp \
                              node:20 \
                              sh -lc 'npm ci --cache /tmp/npm-cache --prefer-offline --no-audit --no-fund'
                        '''
                    }
                }

                stage('Database Migration Smoke Test') {
                    steps {
                        sh '''
                            migration_db_container="dorfgefluester-migration-smoke-${BUILD_NUMBER}"
                            migration_db_network="dorfgefluester-migration-smoke-net-${BUILD_NUMBER}"
                            cleanup() {
                              status=$?
                              if [ "$status" != "0" ]; then
                                echo "Migration smoke diagnostics for $migration_db_container"
                                docker ps -a --filter "name=$migration_db_container" || true
                                docker logs "$migration_db_container" || true
                                docker inspect "$migration_db_container" || true
                              fi
                              docker rm -f "$migration_db_container" >/dev/null 2>&1 || true
                              docker network rm "$migration_db_network" >/dev/null 2>&1 || true
                              exit "$status"
                            }
                            trap cleanup EXIT
                            docker rm -f "$migration_db_container" >/dev/null 2>&1 || true
                            docker network rm "$migration_db_network" >/dev/null 2>&1 || true
                            docker network create "$migration_db_network" >/dev/null
                            docker run -d --rm \
                              --name "$migration_db_container" \
                              --network "$migration_db_network" \
                              -e POSTGRES_DB=dorfgefluester \
                              -e POSTGRES_USER=dorfgefluester \
                              -e POSTGRES_PASSWORD=dorfgefluester-ci \
                              postgres:16-alpine >/dev/null
                            ready=0
                            for _ in $(seq 1 90); do
                              if ! docker ps --format '{{.Names}}' | grep -Fx "$migration_db_container" >/dev/null 2>&1; then
                                echo "ERROR: postgres migration smoke container exited before readiness."
                                docker ps -a --filter "name=$migration_db_container" || true
                                docker logs "$migration_db_container" || true
                                exit 1
                              fi
                              if docker run --rm --network "$migration_db_network" postgres:16-alpine \
                                pg_isready -h "$migration_db_container" -U dorfgefluester -d dorfgefluester \
                                >/dev/null 2>&1; then
                                ready=1
                                break
                              fi
                              sleep 2
                            done
                            if [ "$ready" != "1" ]; then
                              docker logs "$migration_db_container" || true
                              echo "ERROR: postgres migration smoke container did not become ready."
                              exit 1
                            fi
                            docker run --rm --network "$migration_db_network" -u "$(id -u):$(id -g)" \
                              -v "$WORKSPACE:/work" -w /work \
                              -e HOME=/tmp \
                              -e DATABASE_URL="postgres://dorfgefluester:dorfgefluester-ci@${migration_db_container}:5432/dorfgefluester" \
                              node:20 \
                              sh -lc 'node scripts/quality/api-migration-smoke.cjs'
                        '''
                    }
                }

                // Run the expensive CI checks in parallel once dependencies are installed.
                stage('CI Checks') {
                    parallel {
                        // Build production assets, archive them, and validate bundle-size budgets in one branch.
                        stage('Build & Bundle Budget') {
                            steps {
                                script {
                                    def isReleaseBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                                    def maxIndexKb = isReleaseBranch ? 450 : 550
                                    def maxPhaserKb = isReleaseBranch ? 1600 : 1700
                                    def maxTotalKb = isReleaseBranch ? 2100 : 2300
                                    sh """
                                        docker run --rm -u "\$(id -u):\$(id -g)" \\
                                          -v "\$WORKSPACE:/work" -w /work \\
                                          -e HOME=/tmp \\
                                          node:20 \\
                                          sh -lc 'npm run build && node scripts/quality/check-bundle-budget.cjs --max-index-kb ${maxIndexKb} --max-phaser-kb ${maxPhaserKb} --max-total-kb ${maxTotalKb}'
                                    """
                                }
                            }
                            post {
                                success {
                                    archiveArtifacts artifacts: 'dist/**/*', fingerprint: true, allowEmptyArchive: false
                                }
                            }
                        }

                        // Enforce lint rules before delivery to keep code quality consistent.
                        stage('Lint') {
                            steps {
                                sh '''
                                    docker run --rm -u "$(id -u):$(id -g)" \
                                      -v "$WORKSPACE:/work" -w /work \
                                      -e HOME=/tmp \
                                      node:20 \
                                      sh -lc 'npm run lint --if-present -- --max-warnings=0 && npm run format:check --if-present'
                                '''
                            }
                        }

                        // Execute tests once with coverage enabled so JUnit, coverage artifacts, and Sonar inputs
                        // are produced from a single Jest invocation.
                        stage('Test') {
                            steps {
                                script {
                                    def junitDir = 'tests/junit'
                                    def hasJunit = sh(script: '[ -d node_modules/jest-junit ]', returnStatus: true) == 0
                                    sh "mkdir -p ${junitDir}"
                                    if (hasJunit) {
                                        withEnv(["JEST_JUNIT_OUTPUT_DIR=${junitDir}", "JEST_JUNIT_OUTPUT_NAME=jest-junit.xml"]) {
                                            sh '''
                                                docker run --rm -u "$(id -u):$(id -g)" \
                                                  -v "$WORKSPACE:/work" -w /work \
                                                  -e HOME=/tmp \
                                                  -e JEST_JUNIT_OUTPUT_DIR="$JEST_JUNIT_OUTPUT_DIR" \
                                                  -e JEST_JUNIT_OUTPUT_NAME="$JEST_JUNIT_OUTPUT_NAME" \
                                                  node:20 \
                                                  sh -lc 'npm test -- --ci --coverage --reporters=default --reporters=jest-junit'
                                            '''
                                        }
                                    } else {
                                        sh '''
                                            docker run --rm -u "$(id -u):$(id -g)" \
                                              -v "$WORKSPACE:/work" -w /work \
                                              -e HOME=/tmp \
                                              node:20 \
                                              sh -lc 'npm test -- --ci --coverage --json --outputFile=tests/junit/jest.json && node scripts/jest-json-to-junit.cjs tests/junit/jest.json tests/junit/jest-junit.xml'
                                        '''
                                    }
                                }
                            }
                            post {
                                always {
                                    junit testResults: 'tests/junit/**/*.xml', allowEmptyResults: true
                                    archiveArtifacts artifacts: 'tests/coverage/**/*', fingerprint: true, allowEmptyArchive: true
                                }
                            }
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
	                            sh "${dockerRunBase} 'npx playwright test tests/e2e/user-click-paths.spec.js --project=chromium'"
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

        // Run the independent validation workstreams in parallel to shorten post-test feedback.
        stage('Validation & Analysis') {
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
                // Scan the repository filesystem for high/critical issues without failing the pipeline.
                stage('Trivy FS Scan') {
                    steps {
                        sh '''
                            mkdir -p "$(dirname "$JOB_CACHE_TOUCH_FILE")"
                            touch "$JOB_CACHE_TOUCH_FILE"
                            mkdir -p reports/trivy
                            mkdir -p "$TRIVY_FS_CACHE_DIR"
                            docker run --rm -u "$(id -u):$(id -g)" \
                              -v "$WORKSPACE:/src" \
                              -v "$TRIVY_FS_CACHE_DIR:/tmp/trivy-cache" \
                              "$TRIVY_IMAGE" fs /src \
                              --cache-dir /tmp/trivy-cache \
                              --format json --output /src/reports/trivy/fs.json \
                              --exit-code 0 --severity HIGH,CRITICAL --ignore-unfixed || true
                        '''
                        sh(
                            script: '''
                              docker run --rm -u "$(id -u):$(id -g)" \
                                -v "$WORKSPACE:/work" -w /work \
                                node:20 \
                                node scripts/quality/trivy-summary.cjs \
                                  --input reports/trivy/fs.json \
                                  --label "Trivy FS Scan" \
                                  --out-json reports/trivy/fs-summary.json \
                                  --out-md reports/trivy/fs-summary.md
                            '''.stripIndent()
                        )
                        sh 'echo "" && echo "Trivy FS summary (reports/trivy/fs-summary.md)" && sed -n "1,160p" reports/trivy/fs-summary.md || true'
                    }
                }
                // Run Semgrep SAST ruleset for fast pattern-based vulnerability detection.
                stage('Semgrep') {
                    steps {
                        retry(2) {
                            script {
                                def semgrepStatus = sh(
                                    script: '''
                                        docker run --rm -u "$(id -u):$(id -g)" -v "$WORKSPACE:/src" \
                                          returntocorp/semgrep semgrep scan /src \
                                          --config auto --error
                                    ''',
                                    returnStatus: true
                                )

                                if (semgrepStatus == 0) {
                                    echo 'Semgrep completed without findings.'
                                } else {
                                    echo "Semgrep reported findings or returned exit code ${semgrepStatus}. Review the log output above; build remains green by policy."
                                }
                            }
                        }
                    }
                }
                // Generate a CycloneDX SBOM and upload it to Dependency-Track for non-blocking SCA.
                stage('Dependency-Track SBOM') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            script {
                                if (!env.DEPENDENCY_TRACK_PROJECT_NAME?.trim()) {
                                    echo 'Dependency-Track SBOM skipped: DEPENDENCY_TRACK_PROJECT_NAME is not configured.'
                                    return
                                }
                            }

                            withCredentials([string(credentialsId: 'dependency-track-api-key', variable: 'DT_API_KEY')]) {
                                sh '''
                                    test -f package.json
                                    test -f package-lock.json
                                    mkdir -p reports/dependency-track
                                    rm -f reports/dependency-track/sbom.json reports/dependency-track/bom-post.txt

                                    docker run --rm \
                                      -u "$(id -u):$(id -g)" \
                                      -v "$WORKSPACE:/app" \
                                      -w /app \
                                      -e HOME=/tmp \
                                      node:20-slim \
                                      npx --yes @cyclonedx/cyclonedx-npm --package-lock-only --output-file reports/dependency-track/sbom.json

                                    test -s reports/dependency-track/sbom.json

                                    RESPONSE=$(curl -sS -o /tmp/dependency-track-response.txt -w "%{http_code}" \
                                      -X POST "${DEPENDENCY_TRACK_URL}/api/v1/bom" \
                                      -H "X-Api-Key: ${DT_API_KEY}" \
                                      -F "autoCreate=true" \
                                      -F "projectName=${DEPENDENCY_TRACK_PROJECT_NAME}" \
                                      -F "projectVersion=${BRANCH_NAME}" \
                                      -F "bom=@reports/dependency-track/sbom.json")

                                    echo "Dependency-Track upload HTTP status: ${RESPONSE}"
                                    echo 'Dependency-Track upload response body:'
                                    cat /tmp/dependency-track-response.txt | tee reports/dependency-track/bom-post.txt || true

                                    if [ "${RESPONSE}" != "200" ] && [ "${RESPONSE}" != "201" ]; then
                                      exit 1
                                    fi

                                    LOOKUP_CODE=$(curl -sS -o /tmp/dependency-track-project.json -w "%{http_code}" \
                                      -G "${DEPENDENCY_TRACK_URL}/api/v1/project/lookup" \
                                      -H "X-Api-Key: ${DT_API_KEY}" \
                                      --data-urlencode "name=${DEPENDENCY_TRACK_PROJECT_NAME}" \
                                      --data-urlencode "version=${BRANCH_NAME}")

                                    echo "Dependency-Track project lookup HTTP status: ${LOOKUP_CODE}"
                                    cat /tmp/dependency-track-project.json | tee reports/dependency-track/project-lookup.json || true

                                    if [ "${LOOKUP_CODE}" = "200" ]; then
                                      PROJECT_UUID=$(node <<'EOF'
const fs = require('fs');

try {
  const raw = fs.readFileSync('/tmp/dependency-track-project.json', 'utf8').trim();
  if (!raw) {
    process.exit(0);
  }
  const data = JSON.parse(raw);
  const uuid = typeof data.uuid === 'string' ? data.uuid.trim() : '';
  if (uuid) {
    process.stdout.write(uuid);
  }
} catch (error) {
  // Leave PROJECT_UUID empty if lookup JSON is missing or malformed.
}
EOF
                                      )

                                      if [ -n "${PROJECT_UUID}" ]; then
                                        echo "Dependency-Track resolved project UUID: ${PROJECT_UUID}"

                                        METRICS_CODE=$(curl -sS -o /tmp/dependency-track-metrics.json -w "%{http_code}" \
                                          -H "X-Api-Key: ${DT_API_KEY}" \
                                          "${DEPENDENCY_TRACK_URL}/api/v1/metrics/project/${PROJECT_UUID}/current")
                                        echo "Dependency-Track metrics HTTP status: ${METRICS_CODE}"
                                        cat /tmp/dependency-track-metrics.json | tee reports/dependency-track/metrics.json || true

                                        FINDINGS_CODE=$(curl -sS -o /tmp/dependency-track-findings.json -w "%{http_code}" \
                                          -H "X-Api-Key: ${DT_API_KEY}" \
                                          "${DEPENDENCY_TRACK_URL}/api/v1/finding/project/${PROJECT_UUID}")
                                        echo "Dependency-Track findings HTTP status: ${FINDINGS_CODE}"
                                        cat /tmp/dependency-track-findings.json > reports/dependency-track/findings.json || true

                                        node <<'EOF' | tee reports/dependency-track/summary.md
const fs = require('fs');

function readJson(path) {
  try {
    const raw = fs.readFileSync(path, 'utf8').trim();
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

const metrics = readJson('/tmp/dependency-track-metrics.json') || {};
const findings = readJson('/tmp/dependency-track-findings.json');
const findingList = Array.isArray(findings) ? findings : [];

const severityCounts = findingList.reduce((acc, finding) => {
  const severity = String(
    finding?.vulnerability?.severity ||
    finding?.severity ||
    'UNASSIGNED',
  ).toUpperCase();
  acc[severity] = (acc[severity] || 0) + 1;
  return acc;
}, {});

const topFindings = findingList
  .slice()
  .sort((a, b) => {
    const scoreA = Number(a?.vulnerability?.cvssV3BaseScore ?? a?.vulnerability?.cvssV2BaseScore ?? 0);
    const scoreB = Number(b?.vulnerability?.cvssV3BaseScore ?? b?.vulnerability?.cvssV2BaseScore ?? 0);
    return scoreB - scoreA;
  })
  .slice(0, 10);

const lines = [
  '# Dependency-Track Summary',
  '',
  `- Project: dorfgefluester / ${process.env.BRANCH_NAME}`,
  `- Components: ${metrics.components ?? 'n/a'}`,
  `- Vulnerable components: ${metrics.vulnerableComponents ?? 'n/a'}`,
  `- Findings: ${findingList.length}`,
  `- Critical findings: ${severityCounts.CRITICAL || 0}`,
  `- High findings: ${severityCounts.HIGH || 0}`,
  `- Medium findings: ${severityCounts.MEDIUM || 0}`,
  `- Low findings: ${severityCounts.LOW || 0}`,
  '',
  '## Top Findings',
];

if (topFindings.length === 0) {
  lines.push('', '- No findings returned by Dependency-Track.');
} else {
  for (const finding of topFindings) {
    const vulnId = finding?.vulnerability?.vulnId || finding?.vulnerability?.source || 'unknown-vuln';
    const severity = String(finding?.vulnerability?.severity || finding?.severity || 'UNASSIGNED').toUpperCase();
    const component = finding?.component?.name || finding?.component?.group || 'unknown-component';
    const version = finding?.component?.version ? `@${finding.component.version}` : '';
    const score = finding?.vulnerability?.cvssV3BaseScore ?? finding?.vulnerability?.cvssV2BaseScore ?? 'n/a';
    lines.push(`- ${severity} ${vulnId} in ${component}${version} (CVSS ${score})`);
  }
}

console.log(lines.join('\\n'));
EOF

                                        echo 'Dependency-Track summary:'
                                        cat reports/dependency-track/summary.md || true
                                      else
                                        echo 'Dependency-Track project lookup returned no UUID; skipping findings summary.'
                                      fi
                                    else
                                      echo 'Dependency-Track project lookup failed; skipping findings summary.'
                                    fi
                                '''
                            }
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/dependency-track/*', allowEmptyArchive: true
                        }
                    }
                }
                // Run npm audit as a dependency-risk signal while keeping delivery non-blocking.
                stage('npm Audit') {
                    steps {
                        script {
                            sh(
                                script: '''
mkdir -p reports/npm-audit
audit_status=0
npm audit --json --package-lock-only > reports/npm-audit/audit.json || audit_status=$?
printf '%s\n' "$audit_status" > reports/npm-audit/exit-code.txt
node - <<'EOF'
const fs = require('fs');
let critical = 0;
let high = 0;
try {
  const text = fs.readFileSync('reports/npm-audit/audit.json', 'utf8').trim();
  if (text) {
    const data = JSON.parse(text);
    const v = (data && data.metadata && data.metadata.vulnerabilities) || {};
    critical = Number.isFinite(v.critical) ? v.critical : 0;
    high = Number.isFinite(v.high) ? v.high : 0;
  }
} catch (e) {
  // leave critical/high as 0 on any error
}
try {
  fs.writeFileSync('reports/npm-audit/summary.txt', critical + ' ' + high + '\\n', 'utf8');
} catch (e) {
  // if we can't write the summary, there is nothing more we can do here
}
EOF
exit 0
                                '''.stripIndent()
                            )

                            def auditExitCode = readFile('reports/npm-audit/exit-code.txt').trim() as int
                            int criticalCount = 0
                            int highCount = 0

                            try {
                                def summaryText = readFile('reports/npm-audit/summary.txt').trim()
                                if (summaryText) {
                                    def parts = summaryText.tokenize(' \t')
                                    if (parts.size() >= 1) {
                                        criticalCount = (parts[0] ?: '0') as int
                                    }
                                    if (parts.size() >= 2) {
                                        highCount = (parts[1] ?: '0') as int
                                    }
                                }
                            } catch (Exception auditParseError) {
                                echo "Unable to read npm audit summary: ${auditParseError.message}"
                            }

                            if (criticalCount > 0 || highCount > 0) {
                                echo "npm audit found ${criticalCount} critical and ${highCount} high vulnerabilities from package-lock.json. Build remains green by policy."
                            } else if (auditExitCode != 0) {
                                echo "npm audit exited with code ${auditExitCode}, but no high/critical vulnerabilities were reported."
                            }
                        }
                    }
                }
                // Scan workspace files for leaked secrets while excluding generated artifacts.
                stage('Gitleaks') {
                    steps {
                        script {
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
                                      --exclude='./tests/jenkins' \
                                      --exclude='./tests/test-results' \
                                      --exclude='./reports' \
                                      -cf - . | tar -C "$TMPDIR/repo" -xf -

                                    docker run --rm -u "$(id -u):$(id -g)" \
                                      -v "$TMPDIR/repo:/repo" \
                                      -v "$WORKSPACE/reports/gitleaks:/reports" \
                                      -w /repo \
                                      zricethezav/gitleaks:v8.18.2 detect \
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
                    }
                }
                // Lint chart templates to catch syntax and schema issues before deployment.
                stage('Helm Lint') {
                    steps {
                        script {
                            def hasHelm = sh(script: 'command -v helm >/dev/null 2>&1', returnStatus: true) == 0
                            if (hasHelm) {
                                sh '''
                                  helm lint helm/dorfgefluester
                                  helm lint helm/dorfgefluester -f helm/dorfgefluester/values-staging.yaml
                                '''
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
                                    --set web.image.repository=${IMAGE_REPO} \
                                    --set web.image.tag=ci-dry-run \
                                    --set api.image.repository=${API_IMAGE_REPO} \
                                    --set api.image.tag=ci-dry-run \
                                    --set api.env.appOrigin=http://dorf.test \
                                    --set ingress.host=dorf.test > /tmp/${RELEASE}-rendered.yaml
                                  kubectl apply --dry-run=client -f /tmp/${RELEASE}-rendered.yaml
                                  helm template ${RELEASE}-staging helm/dorfgefluester \
                                    --namespace staging \
                                    -f helm/dorfgefluester/values.yaml \
                                    -f helm/dorfgefluester/values-staging.yaml \
                                    --set web.image.repository=${IMAGE_REPO} \
                                    --set web.image.tag=ci-dry-run \
                                    --set api.image.repository=${API_IMAGE_REPO} \
                                    --set api.image.tag=ci-dry-run \
                                    --set api.env.appOrigin=http://dorf.test \
                                    --set ingress.host=dorf.test > /tmp/${RELEASE}-staging-rendered.yaml
                                  kubectl apply --dry-run=client -f /tmp/${RELEASE}-staging-rendered.yaml
                                """
                            } else {
                                echo 'Helm or kubectl not found on agent; skipping Helm Render (Dry Run).'
                            }
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
                            if [ -f scripts/quality/sonarqube-export.cjs ] && [ -f scripts/quality/sonar-report.cjs ]; then
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

                              docker run --rm -u "$(id -u):$(id -g)" \
                                -v "$WORKSPACE:/work" -w /work \
                                node:20 \
                                node scripts/quality/sonar-plan-export.cjs \
                                  --issues-json reports/sonarqube/issues.json \
                                  --report-json reports/sonarqube/sonar-report.json \
                                  --out-json reports/sonarqube/planning-summary.json \
                                  --out-md reports/sonarqube/planning-summary.md

                              echo ""
                              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                              echo "SonarQube Report (from reports/sonarqube/sonar-report.md)"
                              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                              echo ""
                              sed -n '1,220p' reports/sonarqube/sonar-report.md || true

                              echo ""
                              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                              echo "SonarQube Investigation Snapshot"
                              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                              echo ""
                              node scripts/quality/print-sonar-investigation-snapshot.cjs --input reports/sonarqube/sonar-report.json

                              echo ""
                              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                              echo "SonarQube Planning Summary (for IMPLEMENTATION_PLAN input)"
                              echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                              echo ""
                              sed -n '1,220p' reports/sonarqube/planning-summary.md || true
                            else
                              echo "SonarQube export scripts not found (scripts/quality/sonarqube-export.cjs, scripts/quality/sonar-report.cjs)."
                              echo "Skipping Export Findings stage."
                            fi
                        '''
                    }
                }
            }
        }

        stage('PR Review Artifacts') {
            when {
                allOf {
                    expression { return env.BUILD_ALLOWED == 'true' }
                    expression { return env.CHANGE_ID?.trim() }
                }
            }
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    sh '''
                        set -e
                        mkdir -p reports/pr-review

                        target_ref="${CHANGE_TARGET:-master}"
                        git fetch --no-tags origin "$target_ref"

                        repo_id="$(git config --get remote.origin.url || printf '%s' "${JOB_NAME}")"
                        base_sha="$(git merge-base HEAD "origin/$target_ref")"
                        head_sha="$(git rev-parse HEAD)"
                        head_ref="${CHANGE_BRANCH:-${BRANCH_NAME}}"

                        docker run --rm -u "$(id -u):$(id -g)" \
                          -v "$WORKSPACE:/work" -w /work \
                          node:20 \
                          node scripts/quality/build-pr-review-assets.cjs \
                            --repo-root /work \
                            --prompt-template .github/codex/review-prompt.md \
                            --output-prompt reports/pr-review/codex-prompt.md \
                            --output-schema reports/pr-review/codex-schema.json \
                            --repository "$repo_id" \
                            --pr-number "${CHANGE_ID}" \
                            --base-ref "$target_ref" \
                            --head-ref "$head_ref" \
                            --base-sha "$base_sha" \
                            --head-sha "$head_sha"

                        docker run --rm -u "$(id -u):$(id -g)" \
                          -v "$WORKSPACE:/work" -w /work \
                          node:20 \
                          node scripts/quality/write-pr-review-checklist-reference.cjs

                        echo ""
                        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                        echo "PR Review Checklist Reference (reports/pr-review/checklist-reference.md)"
                        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                        echo ""
                        sed -n '1,220p' reports/pr-review/checklist-reference.md || true
                    '''
                }
            }
        }

        stage('Skill Gate') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                sh '''
                    mkdir -p reports/skill-gate
                    node scripts/quality/run-skill-gate.cjs \
                      --mode ci \
                      --out-json reports/skill-gate/skill-gate.json \
                      --out-md reports/skill-gate/skill-gate.md

                    echo ""
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo "Skill Gate Report (reports/skill-gate/skill-gate.md)"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo ""
                    sed -n '1,220p' reports/skill-gate/skill-gate.md || true
                '''
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

        // Build, scan, push, and archive metadata for the deployable container images.
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
                stage('Build Docker Images') {
                    steps {
                        script {
                            def isUnset = { value -> !value?.trim() || value.trim() == 'null' }
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

                            def deploymentEnvironment = env.BRANCH_NAME == 'master'
                                ? 'staging'
                                : ((env.BRANCH_NAME ?: 'development').trim())
                            def frontendBasePath = '/dorfgefluester/'
                            def buildxCacheDir = "${env.DOCKER_BUILDX_CACHE_DIR}"
                            echo "Using deployment environment ${deploymentEnvironment} for frontend telemetry."
                            echo "Using frontend base path ${frontendBasePath} for production assets."

                            sh """
                                set -eu
                                mkdir -p "\$(dirname '${env.JOB_CACHE_TOUCH_FILE}')"
                                touch '${env.JOB_CACHE_TOUCH_FILE}'
                                mkdir -p '${buildxCacheDir}'
                                if docker buildx version >/dev/null 2>&1; then
                                  export DOCKER_BUILDKIT=1
                                  if docker buildx inspect >/dev/null 2>&1 && docker buildx build \
                                    --load \
                                    --tag ${IMAGE_REPO}:${resolvedTag} \
                                    --build-arg VITE_DEPLOYMENT_ENVIRONMENT=${deploymentEnvironment} \
                                    --build-arg VITE_BASE_PATH=${frontendBasePath} \
                                    --cache-from type=local,src='${buildxCacheDir}' \
                                    --cache-to type=local,dest='${buildxCacheDir}-new',mode=max \
                                    .; then
                                    rm -rf '${buildxCacheDir}'
                                    mv '${buildxCacheDir}-new' '${buildxCacheDir}'
                                  else
                                    rm -rf '${buildxCacheDir}-new'
                                    echo 'docker buildx cache export unsupported on this agent; falling back to uncached docker build.'
                                    docker build --build-arg VITE_DEPLOYMENT_ENVIRONMENT=${deploymentEnvironment} --build-arg VITE_BASE_PATH=${frontendBasePath} -t ${IMAGE_REPO}:${resolvedTag} .
                                  fi
                                else
                                  echo 'docker buildx unavailable on agent; falling back to classic docker build.'
                                  docker build --build-arg VITE_DEPLOYMENT_ENVIRONMENT=${deploymentEnvironment} --build-arg VITE_BASE_PATH=${frontendBasePath} -t ${IMAGE_REPO}:${resolvedTag} .
                                fi
                                docker build -f Dockerfile.api -t ${API_IMAGE_REPO}:${resolvedTag} .
                            """
                        }
                    }
                }

                stage('Scan Docker Images') {
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
                            def trivyDbMetadata = "${trivyCacheDir}/db/metadata.json"
                            def trivyDbTimestamp = "${trivyCacheDir}/.db-updated-at"
                            def trivyDbTtlSeconds = 12 * 60 * 60
                            def trivyDbRefreshTimeoutSeconds = 180
                            def cachedDbAvailable = sh(
                                script: """
                                    set -eu
                                    [ -s '${trivyDbMetadata}' ]
                                """,
                                returnStatus: true
                            ) == 0
                            def shouldRefreshDb = sh(
                                script: """
                                    set -eu
                                    if [ ! -s '${trivyDbMetadata}' ] || [ ! -f '${trivyDbTimestamp}' ]; then
                                      exit 0
                                    fi
                                    now=\$(date +%s)
                                    updated=\$(cat '${trivyDbTimestamp}' 2>/dev/null || echo 0)
                                    age=\$((now - updated))
                                    [ "\$age" -ge '${trivyDbTtlSeconds}' ]
                                """,
                                returnStatus: true
                            ) == 0

                            if (shouldRefreshDb) {
                                def dbReady = false
                                for (def repo : dbRepos) {
                                    echo "Refreshing Trivy DB from ${repo} (timeout ${trivyDbRefreshTimeoutSeconds}s)..."
                                    def dbStatus = sh(
                                        script: """
                                            timeout '${trivyDbRefreshTimeoutSeconds}' \
                                              docker run --rm \
                                              -v '${trivyCacheDir}:/tmp/trivy-cache' \
                                              '${env.TRIVY_IMAGE}' image \
                                              --cache-dir /tmp/trivy-cache \
                                              --download-db-only \
                                              --db-repository ${repo}
                                        """,
                                        returnStatus: true
                                    )
                                    if (dbStatus == 0) {
                                        sh "date +%s > '${trivyDbTimestamp}'"
                                        dbReady = true
                                        break
                                    }
                                    echo "Trivy DB refresh from ${repo} failed with exit code ${dbStatus}."
                                }
                                if (!dbReady) {
                                    if (cachedDbAvailable) {
                                        echo 'Unable to refresh Trivy vulnerability DB from configured repositories; continuing with the previously cached DB.'
                                    } else {
                                        echo 'Unable to prepare a Trivy vulnerability DB; skipping image scan instead of blocking the whole pipeline.'
                                        writeFile file: 'reports/trivy/image-scan-skipped.md', text: 'Trivy image scan skipped because no vulnerability DB could be downloaded and no cached DB was available.\n'
                                        return
                                    }
                                }
                            } else {
                                echo 'Using cached Trivy DB (fresh enough for this build).'
                            }

                            def images = [
                                [name: 'web', repo: env.IMAGE_REPO],
                                [name: 'api', repo: env.API_IMAGE_REPO]
                            ]
                            def failedScans = []
                            for (def image in images) {
                                def slug = image.name
                                def jsonPath = "reports/trivy/image-${slug}.json"
                                def summaryJson = "reports/trivy/image-${slug}-summary.json"
                                def summaryMd = "reports/trivy/image-${slug}-summary.md"
                                def trivyCommand = """
                                    docker run --rm \
                                      -v /var/run/docker.sock:/var/run/docker.sock \
                                      -v '${trivyCacheDir}:/tmp/trivy-cache' \
                                      -v '${env.WORKSPACE}:/work' \
                                      '${env.TRIVY_IMAGE}' image \
                                      --cache-dir /tmp/trivy-cache \
                                      --skip-db-update \
                                      --format json --output /work/${jsonPath} \
                                      --exit-code 1 --severity ${isReleaseBranch ? 'CRITICAL' : 'HIGH,CRITICAL'} --ignore-unfixed \
                                      "${image.repo}:${imageTag}"
                                """
                                def trivyStatus = sh(script: trivyCommand, returnStatus: true)
                                writeFile file: "reports/trivy/image-${slug}-exit-code.txt", text: "${trivyStatus}\n"
                                if (fileExists(jsonPath)) {
                                    sh """
                                      docker run --rm -u "\$(id -u):\$(id -g)" \
                                        -v "${env.WORKSPACE}:/work" -w /work \
                                        node:20 \
                                        node scripts/quality/trivy-summary.cjs \
                                          --input ${jsonPath} \
                                          --label "Trivy ${slug.toUpperCase()} Image Scan" \
                                          --out-json ${summaryJson} \
                                          --out-md ${summaryMd}
                                    """
                                    sh "echo '' && echo 'Trivy ${slug} image summary (${summaryMd})' && sed -n '1,160p' ${summaryMd} || true"
                                } else {
                                    writeFile file: summaryMd, text: "Trivy ${slug} image scan did not produce ${jsonPath}.\n"
                                }
                                if (trivyStatus != 0) {
                                    failedScans << "${slug}:${trivyStatus}"
                                }
                            }

                            if (!failedScans.isEmpty()) {
                                def message = "Trivy image scan reported vulnerabilities above the configured threshold (${failedScans.join(', ')})."
                                if (isReleaseBranch) {
                                    error(message)
                                }
                                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                                    error(message)
                                }
                            }
                        }
                    }
                }

                stage('Push Docker Images') {
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
                            def tagsToPush = ([imageTag] + extraTags).unique()
                            def imageRepos = [env.IMAGE_REPO, env.API_IMAGE_REPO]

                            def pushRepo = { String repo ->
                                for (def tag : extraTags) {
                                    sh "docker tag ${repo}:${imageTag} ${repo}:${tag}"
                                }

                                def pushDirectAll = {
                                    def ok = true
                                    for (def tag : tagsToPush) {
                                        def status = sh(script: "docker push ${repo}:${tag}", returnStatus: true)
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
                                                docker-daemon:${repo}:${tag} \
                                                docker://${repo}:${tag}
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
                                    echo "Image pushed directly from Jenkins agent for ${repo} (${tagsToPush.join(', ')})."
                                    return
                                }
                                echo "Direct push failed for ${repo}. Trying skopeo HTTP push."
                                if (pushSkopeoAll()) {
                                    echo "Image pushed using skopeo HTTP fallback for ${repo} (${tagsToPush.join(', ')})."
                                    return
                                }
                                echo "Skopeo HTTP push failed for ${repo}. Falling back to push via ${DEPLOY_HOST}."
                                def imageArchive = "/tmp/${RELEASE}-${repo.tokenize('/').last()}-${imageTag}.tar.gz"
                                def sshCredCandidates = [env.SSH_CRED_ID, 'dev-env-01-ssh', 'deploy'].findAll { it?.trim() }.unique()
                                def pushedViaSsh = false
                                def lastSshError = null
                                for (def credId : sshCredCandidates) {
                                    try {
                                        withCredentials([sshUserPrivateKey(credentialsId: credId, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                                            def extraTagsCsv = extraTags.join(',')
                                            sh """
                                              set -e
                                              docker save ${repo}:${imageTag} | gzip > ${imageArchive}
                                              scp -i "\$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no ${imageArchive} \$SSH_USER@${DEPLOY_HOST}:/tmp/
                                              ssh -i "\$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \$SSH_USER@${DEPLOY_HOST} '
                                                set -e
                                                IMAGE_ARCHIVE=${imageArchive}
                                                IMAGE_TAG=${imageTag}
                                                IMAGE_REPO=${repo}
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
                                        echo "Image pushed via SSH using credential '${credId}' for ${repo} (${tagsToPush.join(', ')})."
                                        pushedViaSsh = true
                                        break
                                    } catch (err) {
                                        lastSshError = err
                                        echo "SSH push fallback failed with credential '${credId}' for ${repo}: ${err.getMessage()}"
                                    }
                                }
                                if (!pushedViaSsh) {
                                    throw lastSshError ?: new RuntimeException("SSH push fallback failed for ${repo} using all configured credentials.")
                                }
                            }

                            for (def repo : imageRepos) {
                                pushRepo(repo)
                            }

                            catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                                for (def repo : imageRepos) {
                                    sh """
                                      set -e
                                      image_name='${repo.tokenize('/').last()}'
                                      url="http://${REGISTRY}/v2/\$image_name/tags/list"
                                      if ! tags_json=\$(curl -fsS "\$url"); then
                                        echo "WARN: unable to query registry tags at \$url"
                                        exit 0
                                      fi
                                      for t in ${tagsToPush.join(' ')}; do
                                        echo "\$tags_json" | grep -Fq "\"\$t\"" || { echo "WARN: registry tag missing after push for \$image_name: \$t"; exit 1; }
                                      done
                                      echo "Registry tags verified for \$image_name: ${tagsToPush.join(', ')}"
                                    """
                                }
                            }
                        }
                    }
                }

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
                        sh 'node scripts/quality/write-build-meta.cjs'
                        archiveArtifacts artifacts: 'build-meta.json,build-meta.md', allowEmptyArchive: false
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
                        echo "Images published: ${env.IMAGE_REPO}:${publishedTag ?: 'unknown'} and ${env.API_IMAGE_REPO}:${publishedTag ?: 'unknown'}"
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
	            // Keep the current job cache outside the workspace root, but prune stale sibling caches
	            // so multibranch jobs do not keep accumulating npm/trivy/buildx data forever.
	            sh '''
	                set +e
	                mkdir -p "$CACHE_ROOT"
	                touch "$JOB_CACHE_TOUCH_FILE"
	                find "$CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d ! -path "$JOB_CACHE_DIR" -mtime +7 -print | while read -r stale_dir; do
	                  [ -n "$stale_dir" ] || continue
	                  rm -rf "$stale_dir"
	                done
	            '''
	            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
        }
    }
}
